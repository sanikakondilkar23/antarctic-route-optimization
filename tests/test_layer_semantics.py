"""
Regression tests for environmental-layer semantics in the route API.

The failure these guard against: an OPTIONAL cost layer with incomplete
spatial coverage (the SIC uncertainty artifact is 101x361 on a 173x369
routing grid) was treated as mandatory, so every route crossing the extension
band was rejected with ``unsafe_route_layers`` -- including the project's own
verified baseline.

Contract under test
-------------------
* SIC is a REQUIRED navigation layer: NaN SIC, non-navigable cells,
  out-of-bounds cells and non-8-connected geometry still reject the route.
* Optional cost layers may be real-but-partially-covered. Partial coverage is
  reported as ``PARTIAL`` with explicit counts, never as ``REAL``.
* An optional layer only becomes mandatory when its weight is non-zero. With
  ``w_unc == 0`` a partial layer must not reject the route; with ``w_unc > 0``
  insufficient coverage must fail explicitly, and must never be filled in.
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "backend" / "cache"
SIC_PATH = CACHE / "routing_sic_2026.npy"
UNC_PATH = CACHE / "uncertainty_2026.npy"

pytestmark = pytest.mark.skipif(
    not (SIC_PATH.exists() and UNC_PATH.exists()),
    reason="real SIC / uncertainty artifacts not present",
)

#: The project's own verified real-SIC baseline. These values were produced by
#: the pre-regression pipeline and must not drift.
BASELINE = {
    "start_lat": -32.0, "start_lon": 82.0,
    "goal_lat": -70.0, "goal_lon": 10.5, "timestep": 0,
}
BASELINE_WAYPOINTS = 287
BASELINE_LENGTH = 348.96046148071116
BASELINE_MEAN_SIC = 0.007517961639525995
BASELINE_MAX_SIC = 0.754126250743866


@pytest.fixture(scope="module")
def client():
    from backend.api.main import create_app
    app = create_app()
    app.config.update(TESTING=True)
    with app.test_client() as c:
        yield c


def _plan(client, **over):
    body = dict(BASELINE)
    body.update(over)
    r = client.post("/api/route/optimize", json=body)
    return r


def _layer(body, name):
    return next((l for l in body["layer_status"]["layers"] if l["name"] == name), None)


# ---------------------------------------------------------------------------
# 1. the regression itself
# ---------------------------------------------------------------------------

class TestBaselineRouteRegression:

    def test_baseline_route_is_returned(self, client):
        r = _plan(client)
        assert r.status_code == 200, r.get_data(as_text=True)[:400]
        assert r.get_json()["success"] is True

    def test_baseline_matches_historical_verified_values(self, client):
        b = _plan(client).get_json()
        assert b["waypoints"] == BASELINE_WAYPOINTS
        assert b["route_length"] == pytest.approx(BASELINE_LENGTH, abs=1e-9)
        assert b["mean_sic"] == pytest.approx(BASELINE_MEAN_SIC, abs=1e-12)
        assert b["max_sic"] == pytest.approx(BASELINE_MAX_SIC, abs=1e-12)
        assert b["nan_cells"] == 0
        assert b["non_navigable_cells"] == 0

    def test_baseline_path_matches_the_committed_artifact(self, client):
        """Cell-for-cell agreement with outputs/final_demo/final_route.json."""
        import json
        artifact = ROOT / "outputs" / "final_demo" / "final_route.json"
        if not artifact.is_file():
            pytest.skip("verified route artifact not present")
        b = _plan(client).get_json()
        expected = [[int(c[0]), int(c[1])]
                    for c in json.loads(artifact.read_text())["final_route_cells"]]
        assert [list(p) for p in b["path"]] == expected

    def test_sic_safety_validation_is_not_weakened(self, client):
        v = _plan(client).get_json()["validation"]
        assert v["all_cells_in_bounds"] is True
        assert v["reaches_goal"] is True
        assert v["contiguous_8_connected"] is True
        assert v["max_step_cells"] <= 1
        assert v["nan_cells"] == 0
        assert v["non_navigable_cells"] == 0

    def test_every_timestep_still_routes(self, client):
        """The regression rejected the baseline; spot-check that it was not
        a one-off and that no day is left unroutable."""
        for t in (0, 30, 100, 150, 166):
            r = _plan(client, timestep=t)
            assert r.status_code == 200, f"t={t}: {r.get_data(as_text=True)[:200]}"
            b = r.get_json()
            assert b["nan_cells"] == 0
            assert b["non_navigable_cells"] == 0
            assert b["validation"]["reaches_goal"] is True


# ---------------------------------------------------------------------------
# 2. layer status semantics
# ---------------------------------------------------------------------------

class TestLayerStatus:

    def test_sic_is_reported_real(self, client):
        sic = _layer(_plan(client).get_json(), "sic_mean")
        assert sic["status"] == "REAL"
        assert sic["in_cost"] is True

    def test_partial_layer_is_never_reported_real(self, client):
        unc = _layer(_plan(client).get_json(), "sic_uncertainty")
        assert unc["status"] == "PARTIAL"
        assert unc["status"] != "REAL"
        assert "PARTIAL" not in _plan(client).get_json()["layer_status"]["real"]
        assert "sic_uncertainty" in _plan(client).get_json()["layer_status"]["partial"]

    def test_partial_layer_reports_explicit_coverage(self, client):
        unc = _layer(_plan(client).get_json(), "sic_uncertainty")
        assert unc["covered_required_cells"] < unc["required_cells"]
        assert unc["covered_required_cells"] > 0
        assert "NaN" in (unc["reason"] or "")

    def test_absent_layers_stay_not_available(self, client):
        body = _plan(client).get_json()
        for name in ("wind_cost", "iceberg_risk", "depth", "current_uo"):
            rec = _layer(body, name)
            assert rec is not None, name
            assert rec["status"] == "NOT_AVAILABLE", name
            assert rec["in_cost"] is False, name
            assert rec["reason"], name

    def test_only_enabled_layers_reach_the_cost(self, client):
        cb = _plan(client).get_json()["cost_breakdown"]
        assert "sic_mean" in cb["layers_in_cost"]
        assert "sic_uncertainty" not in cb["layers_in_cost"]

    def test_status_semantics_are_documented(self, client):
        sem = _plan(client).get_json()["layer_status"]["status_semantics"]
        assert "PARTIAL" in sem
        assert "NaN" in sem["PARTIAL"]


# ---------------------------------------------------------------------------
# 3. the w_unc rule
# ---------------------------------------------------------------------------

class TestUncertaintyWeightRule:

    def test_zero_weight_does_not_reject_a_route(self, client, monkeypatch):
        monkeypatch.delenv("SIH_W_UNC", raising=False)
        r = _plan(client)
        assert r.status_code == 200
        v = r.get_json()["validation"]
        assert v["layers_in_cost"] == ["sic_mean"]
        assert "sic_uncertainty" not in v["layers_in_cost"]

    def test_zero_weight_still_reports_the_coverage_gap(self, client, monkeypatch):
        monkeypatch.delenv("SIH_W_UNC", raising=False)
        cov = _plan(client).get_json()["validation"]["layer_coverage"]["sic_uncertainty"]
        assert cov["in_cost"] is False
        assert cov["uncovered_route_cells"] > 0
        assert cov["covered_route_cells"] > 0
        assert cov["covered_route_cells"] + cov["uncovered_route_cells"] == BASELINE_WAYPOINTS

    def test_positive_weight_fails_explicitly(self, client, monkeypatch):
        monkeypatch.setenv("SIH_W_UNC", "0.5")
        r = _plan(client)
        assert r.status_code == 400
        b = r.get_json()
        assert b["reason"] == "insufficient_enabled_layer_coverage"
        assert b["layers"]["sic_uncertainty"] > 0
        assert "path" not in b, "a route must not be returned when a required term is unpriced"
        assert b["enabled_weights"]["w_unc"] == 0.5

    def test_positive_weight_error_does_not_claim_fabrication(self, client, monkeypatch):
        monkeypatch.setenv("SIH_W_UNC", "0.5")
        b = _plan(client).get_json()
        assert "fabricated" in b["error"]
        assert "NaN" in b["error"] or "gap" in b["error"]


# ---------------------------------------------------------------------------
# 4. no fabricated uncertainty
# ---------------------------------------------------------------------------

class TestNoFabricatedUncertainty:

    def test_artifact_shape_and_dtype_untouched(self):
        unc = np.load(UNC_PATH, mmap_mode="r")
        assert unc.shape == (167, 3, 101, 361)
        assert unc.dtype == np.float32
        band = np.asarray(unc[0, 0], dtype=np.float64)
        assert np.isfinite(band).all(), "the artifact must stay gapless inside its own domain"

    def test_out_of_domain_cells_remain_nan(self):
        """The extension band is outside the model domain; it must stay NaN
        rather than being zero/mean filled to make a route validate."""
        unc = np.load(UNC_PATH, mmap_mode="r")
        n_mlat, n_mlon = unc.shape[2], unc.shape[3]
        assert (n_mlat, n_mlon) == (101, 361)
        # SIC artifact is 173x369; anything at row 101+ has no uncertainty.
        full = np.full((173, 369), np.nan)
        full[0:n_mlat, 0:n_mlon] = np.asarray(unc[0, 0], dtype=np.float64)
        assert np.isnan(full[101:, :]).all()
        assert np.isnan(full[:, 361:]).all()

    def test_route_coverage_matches_the_artifact_domain(self, client):
        v = _plan(client).get_json()["validation"]
        unc = np.load(UNC_PATH, mmap_mode="r")
        in_domain = sum(1 for r, c in
                        [(p[0], p[1]) for p in _plan(client).get_json()["path"]]
                        if r < unc.shape[2] and c < unc.shape[3])
        assert v["layer_coverage"]["sic_uncertainty"]["covered_route_cells"] == in_domain


# ---------------------------------------------------------------------------
# 5. rerouting must obey the same rules
# ---------------------------------------------------------------------------

class TestRerouteLayerSemantics:

    def _reroute(self, client, new_timestep=100, weights_env=None):
        """Plan first under the default weights, then (optionally) enable
        uncertainty and ask for the re-plan. The environment is read inside
        each request, so the original plan must be built before it changes."""
        plan = _plan(client).get_json()
        assert "path" in plan, plan
        saved = {}
        for k, v in (weights_env or {}).items():
            saved[k] = os.environ.get(k)
            os.environ[k] = v
        try:
            r = client.post("/api/route/reroute", json={
                "original_route": {"path": plan["path"], "start": plan["start"],
                                   "goal": plan["goal"], "timestep": plan["timestep"],
                                   "mean_sic": plan["mean_sic"],
                                   "max_sic": plan["max_sic"]},
                "new_timestep": new_timestep,
            })
            return r
        finally:
            for k, v in saved.items():
                if v is None:
                    os.environ.pop(k, None)
                else:
                    os.environ[k] = v

    def test_reroute_succeeds_with_default_weights(self, client):
        r = self._reroute(client)
        assert r.status_code == 200, r.get_data(as_text=True)[:300]
        b = r.get_json()
        assert b["original_route"]["path"]
        assert b["updated_route"]["path"]
        assert b["updated_route"]["nan_cells"] == 0
        assert b["updated_route"]["non_navigable_cells"] == 0
        assert b["updated_route"]["validation"]["reaches_goal"] is True
        assert "changed_cells" in b["route_comparison"]
        assert b["route_comparison"]["jaccard_overlap"] is not None

    def test_reroute_keeps_original_route_unsafe_free(self, client):
        b = self._reroute(client).get_json()
        assert b["original_route"]["nan_cells"] == 0

    def test_reroute_refuses_when_uncertainty_is_required(self, client):
        r = self._reroute(client, weights_env={"SIH_W_UNC": "0.5"})
        assert r.status_code == 400
        assert r.get_json()["reason"] == "insufficient_enabled_layer_coverage"

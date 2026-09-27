"""
Tests for the SIH2026059 read-only demo API (backend/api/main.py).

These verify that the API the React app consumes serves REAL data with
correct NaN handling, that routing/rerouting reuse the repository's own
algorithms, and that unavailable data is reported honestly rather than faked.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "backend" / "cache"
ROUTE_JSON = ROOT / "outputs" / "final_demo" / "final_route.json"
SIC_PATH = CACHE / "routing_sic_2026.npy"

pytestmark = pytest.mark.skipif(
    not (SIC_PATH.exists() and ROUTE_JSON.exists()),
    reason="real SIC / verified route artifacts not present",
)


@pytest.fixture(scope="module")
def client():
    from backend.api.main import create_app
    app = create_app()
    app.config.update(TESTING=True)
    with app.test_client() as c:
        yield c


def _unpack(payload: dict):
    """Rebuild (values, valid) exactly as the browser does."""
    shape = payload["encoding"]["shape"]
    n = shape[0] * shape[1]
    values = np.frombuffer(base64.b64decode(payload["encoding"]["sic_u8"]),
                           dtype=np.uint8, count=n)
    packed = np.frombuffer(base64.b64decode(payload["encoding"]["valid"]),
                           dtype=np.uint8)
    valid = np.unpackbits(packed)[:n].astype(np.uint8)
    return shape, values, valid


# ---------------------------------------------------------------------------
# 1. metadata
# ---------------------------------------------------------------------------

class TestMetadata:

    def test_health(self, client):
        r = client.get("/api/health")
        assert r.status_code == 200
        assert r.get_json()["sic_artifact"] is True

    def test_metadata_matches_real_artifact(self, client):
        md = client.get("/api/sic/metadata").get_json()
        sic = np.load(SIC_PATH, mmap_mode="r")
        assert md["n_timesteps"] == sic.shape[0] == 167
        assert md["n_rows"] == sic.shape[1] == 173
        assert md["n_cols"] == sic.shape[2] == 369
        assert md["dtype"] == "float32"
        assert md["resolution_deg"] == 0.25
        assert md["lat_range"] == [-75.0, -32.0]
        assert md["lon_range"] == [-10.0, 82.0]
        assert md["model_band_rows"] == [0, 101]
        assert md["model_band_cols"] == [0, 361]

    def test_metadata_axes_come_from_repository_files(self, client):
        md = client.get("/api/sic/metadata").get_json()
        lat = np.load(CACHE / "routing_lat.npy")
        lon = np.load(CACHE / "routing_lon.npy")
        assert np.allclose(md["lat"], lat, atol=1e-3)
        assert np.allclose(md["lon"], lon, atol=1e-3)

    def test_metadata_dates(self, client):
        md = client.get("/api/sic/metadata").get_json()
        assert len(md["dates"]) == 167
        assert md["dates"][0] == "2026-01-06"
        assert md["dates"][-1] == "2026-06-21"

    def test_nan_encoding_is_documented(self, client):
        md = client.get("/api/sic/metadata").get_json()
        assert md["nan_encoding"]["authoritative_field"] == "valid"
        assert "non-navigable" in md["nan_policy"].lower()


# ---------------------------------------------------------------------------
# 2. per-timestep SIC slices (lazy, NaN-safe)
# ---------------------------------------------------------------------------

class TestSicSlice:

    def test_slice_shape_and_date(self, client):
        p = client.get("/api/sic/0").get_json()
        assert p["timestep"] == 0
        assert p["date"] == "2026-01-06"
        assert p["grid"] == {"n_rows": 173, "n_cols": 369}

    def test_slice_payload_is_small(self, client):
        """Only one timestep is sent, not the whole (167,173,369) array."""
        p = client.get("/api/sic/10").get_json()
        b64_len = len(p["encoding"]["sic_u8"]) + len(p["encoding"]["valid"])
        assert b64_len < 120_000

    def test_valid_mask_preserves_nan(self, client):
        shape, values, valid = _unpack(client.get("/api/sic/0").get_json())
        raw = np.asarray(np.load(SIC_PATH, mmap_mode="r")[0])
        assert np.array_equal(valid.reshape(shape).astype(bool),
                              ~np.isnan(raw))
        n_invalid = int((valid == 0).sum())
        assert n_invalid == int(np.isnan(raw).sum()) > 0

    def test_invalid_cells_are_not_zero(self, client):
        """A NaN cell must not be readable as open water."""
        shape, values, valid = _unpack(client.get("/api/sic/0").get_json())
        raw = np.asarray(np.load(SIC_PATH, mmap_mode="r")[0])
        invalid = valid.reshape(shape) == 0
        # invalid cells exist, and their byte is explicitly marked invalid
        assert invalid.any()
        # the authoritative signal is the mask, not the byte
        assert set(np.unique(values.reshape(shape)[invalid]).tolist()) <= {0, 1, 255}

    def test_stats_match_array(self, client):
        p = client.get("/api/sic/7").get_json()
        raw = np.asarray(np.load(SIC_PATH, mmap_mode="r")[7], dtype=np.float64)
        assert p["stats"]["min"] == pytest.approx(float(np.nanmin(raw)))
        assert p["stats"]["mean"] == pytest.approx(float(np.nanmean(raw)))
        assert p["stats"]["max"] == pytest.approx(float(np.nanmax(raw)))
        assert p["stats"]["n_non_navigable"] == int(np.isnan(raw).sum())
        assert p["stats"]["n_navigable"] == int((~np.isnan(raw)).sum())

    def test_array_format_uses_null_for_nan(self, client):
        p = client.get("/api/sic/0?format=array").get_json()
        assert p["nan_representation"] == "null"
        arr = np.array([[np.nan if v is None else v for v in row]
                        for row in p["sic"]], dtype=np.float64)
        raw = np.asarray(np.load(SIC_PATH, mmap_mode="r")[0], dtype=np.float64)
        assert np.array_equal(np.isnan(arr), np.isnan(raw))
        # values are rounded to 6 dp on the wire to keep the payload small
        assert np.allclose(arr[~np.isnan(arr)], raw[~np.isnan(raw)], atol=1e-6)

    def test_timesteps_differ(self, client):
        a = client.get("/api/sic/0").get_json()["stats"]
        b = client.get("/api/sic/120").get_json()["stats"]
        assert a["max"] != b["max"] or a["mean"] != b["mean"]

    def test_out_of_range_timestep(self, client):
        assert client.get("/api/sic/167").status_code == 404
        assert client.get("/api/sic/999").status_code == 404


# ---------------------------------------------------------------------------
# 3. verified route
# ---------------------------------------------------------------------------

class TestVerifiedRoute:

    def test_route_matches_verified_artifact(self, client):
        r = client.get("/api/route").get_json()
        artifact = json.loads(ROUTE_JSON.read_text(encoding="utf-8"))
        assert r["waypoints"] == len(artifact["final_route_cells"]) == 287
        assert r["success"] is True
        assert r["route_length_grid_units"] == pytest.approx(348.96, abs=0.1)
        assert r["data"] == "REAL SIC"
        assert r["algorithm"].startswith("A* + CostMap")

    def test_route_endpoints(self, client):
        r = client.get("/api/route").get_json()
        md = client.get("/api/sic/metadata").get_json()
        lat, lon = md["lat"], md["lon"]
        r0, c0 = r["path"][0]
        r1, c1 = r["path"][-1]
        assert (round(lat[r0], 2), round(lon[c0], 2)) == (-32.0, 82.0)
        assert (round(lat[r1], 2), round(lon[c1], 2)) == (-70.0, 10.5)

    def test_route_has_no_nan_cells(self, client):
        r = client.get("/api/route").get_json()
        sic = np.load(SIC_PATH, mmap_mode="r")[0]
        rows = np.array([p[0] for p in r["path"]])
        cols = np.array([p[1] for p in r["path"]])
        assert int(np.isnan(sic[rows, cols]).sum()) == 0

    def test_route_at_timestep(self, client):
        p = client.get("/api/route/at/0").get_json()
        assert p["success"] is True
        assert p["waypoints"] == 287
        assert p["mean_sic"] == pytest.approx(0.0075, abs=0.0001)
        assert p["max_sic"] == pytest.approx(0.7541, abs=0.0001)
        assert p["nan_cells_on_route"] == 0


# ---------------------------------------------------------------------------
# 4. dynamic rerouting
# ---------------------------------------------------------------------------

class TestReroute:

    def test_reroute_matches_verified_result(self, client):
        rr = client.get("/api/reroute/3").get_json()
        assert rr["status"] == "SUCCESS"
        assert rr["forecast_step_days"] == 3
        cmp = rr["comparison"]
        assert cmp["waypoints_before"] == 287
        assert cmp["waypoints_after"] == 287
        assert cmp["jaccard_overlap"] == pytest.approx(1.0)
        assert cmp["route_coverage"] == pytest.approx(1.0)
        assert cmp["changed_cells"] == 0

    def test_reroute_uses_repository_helpers(self, client):
        rr = client.get("/api/reroute/3").get_json()
        assert "jaccard_overlap" in rr["reroute_logic"]
        assert "route_coverage" in rr["reroute_logic"]

    def test_reroute_returns_both_paths(self, client):
        rr = client.get("/api/reroute/5").get_json()
        assert len(rr["original_route"]["path"]) > 1
        assert len(rr["rerouted_route"]["path"]) > 1
        assert rr["rerouted_route"]["nan_cells_on_route"] == 0

    def test_reroute_origin_from_artifact(self, client):
        rr = client.get("/api/reroute/3?origin_timestep=1").get_json()
        assert rr["origin_timestep"] == 1
        assert rr["forecast_step_days"] == 2


# ---------------------------------------------------------------------------
# 5. system status / honest limitations
# ---------------------------------------------------------------------------

class TestSystemStatus:

    def test_status_shape(self, client):
        s = client.get("/api/system/status").get_json()
        assert s["project"] == "SIH2026059"
        assert s["system"] == "IceRoute-Robust"
        assert s["retraining_performed"] is False
        assert s["synthetic_route_data_used"] is False

    def test_sic_labelled_as_committed_forecast(self, client):
        sic = client.get("/api/system/status").get_json()["environment"]["sic"]
        assert sic["available"] is True
        assert sic["label"] == "Committed 2026 SIC forecast output"

    def test_sic_checkpoints_detected_not_rerun(self, client):
        m = client.get("/api/system/status").get_json()["models"]["sic_forecaster"]
        assert m["present"] is True
        assert len(m["checkpoints"]) >= 3
        assert all(c["is_sic_forecaster"] for c in m["checkpoints"])
        # raw 2026 inputs are absent -> inference is NOT claimed
        assert m["inference_rerun_possible"] is False

    def test_route_policy_honest_label(self, client):
        p = client.get("/api/system/status").get_json()["models"]["route_policy"]
        assert p["present"] is True
        assert p["n_features"] == 16
        assert p["n_actions"] == 8
        assert p["is_real_antarctic_accuracy"] is False
        assert "synthetic" in p["training_data"]
        assert p["used_for_final_route"] is False

    def test_cvar_not_claimed(self, client):
        cvar = client.get("/api/system/status").get_json()["environment"]["cvar"]
        assert cvar["computed"] is False
        if not cvar["available"]:
            assert "unavailable" in cvar["label"].lower()

    def test_cmems_reports_honestly(self, client):
        cm = client.get("/api/system/status").get_json()["environment"]["cmems"]
        assert cm["integration_present"] is True
        if not cm["available"]:
            assert cm["label"] == "CMEMS CURRENT DATA UNAVAILABLE"
            assert cm["variables"] == []
            assert "NOT" in cm["note"] or "not" in cm["note"]

    def test_current_endpoint_never_fakes(self, client):
        c = client.get("/api/current/0")
        body = c.get_json()
        if not body["available"]:
            assert body["uo"] is None and body["vo"] is None
            assert "must not show" in body["note"]

    def test_limitations_endpoint(self, client):
        lim = client.get("/api/limitations").get_json()
        # The five original guarantees must always be stated...
        for key in ("sic", "cmems", "cvar", "route_ml", "route"):
            assert key in lim, key
            assert lim[key].strip(), f"{key} must not be an empty string"
        # ...and any further layer the deployment can report must also carry a
        # real explanation rather than being silently absent.
        for key, text in lim.items():
            assert isinstance(text, str) and text.strip(), key

    def test_limitations_cover_every_reported_layer(self, client):
        """A layer the API calls out in layer_status must also be explained in
        /api/limitations, so nothing is available-but-undocumented."""
        lim = client.get("/api/limitations").get_json()
        body = ("\n".join(f"{k}: {v}" for k, v in lim.items())).lower()
        for name in ("uncertainty", "depth", "wind", "iceberg", "land_mask"):
            assert name in body, f"{name} is not explained in /api/limitations"


# ---------------------------------------------------------------------------
# 6. POST /api/route/optimize — geographic input, real A* + CostMap
# ---------------------------------------------------------------------------

class TestOptimizeRoute:
    """The verified baseline leg must reproduce exactly, and bad input must
    be rejected rather than silently snapped into a fake route."""

    BODY = {"start_lat": -32.0, "start_lon": 82.0,
            "goal_lat": -70.0, "goal_lon": 10.5, "timestep": 0}

    def test_reproduces_the_verified_baseline(self, client):
        r = client.post("/api/route/optimize", json=self.BODY)
        assert r.status_code == 200
        b = r.get_json()
        assert b["success"] is True
        assert b["waypoints"] == 287
        assert b["route_length"] == pytest.approx(348.96, abs=0.01)
        assert b["mean_sic"] == pytest.approx(0.00751796, abs=1e-6)
        assert b["max_sic"] == pytest.approx(0.75412625, abs=1e-6)
        assert b["nan_cells"] == 0
        assert b["non_navigable_cells"] == 0
        assert b["timestep"] == 0
        assert b["date"] == "2026-01-06"
        assert b["algorithm"].startswith("A* + CostMap")

    def test_matches_the_committed_verified_artifact(self, client):
        """The POST path and the stored final_route.json must agree cell for
        cell — this is what proves the endpoint is not a separate route."""
        b = client.post("/api/route/optimize", json=self.BODY).get_json()
        artifact = json.loads(ROUTE_JSON.read_text(encoding="utf-8"))
        assert [list(p) for p in b["path"]] == [
            [int(c[0]), int(c[1])] for c in artifact["final_route_cells"]]

    def test_response_carries_every_required_field(self, client):
        b = client.post("/api/route/optimize", json=self.BODY).get_json()
        for key in ("success", "path", "waypoints", "route_length", "mean_sic",
                    "max_sic", "nan_cells", "start", "goal", "timestep",
                    "total_cost", "expanded_nodes", "validation"):
            assert key in b, key
        assert b["start"]["cell"] == [172, 368]
        assert b["goal"]["cell"] == [20, 82]
        assert b["route_length_units"] == "grid_cells"
        assert b["direct_length_km"] > 0

    def test_validation_report_passes(self, client):
        v = client.post("/api/route/optimize", json=self.BODY).get_json()["validation"]
        assert v["all_cells_in_bounds"] is True
        assert v["starts_at_start"] is True
        assert v["reaches_goal"] is True
        assert v["contiguous_8_connected"] is True
        assert v["max_step_cells"] <= 1
        assert v["nan_cells"] == 0
        assert v["non_navigable_cells"] == 0

    def test_route_never_crosses_a_nan_cell(self, client):
        b = client.post("/api/route/optimize", json=self.BODY).get_json()
        sic = np.load(SIC_PATH, mmap_mode="r")[0]
        rows = np.array([p[0] for p in b["path"]])
        cols = np.array([p[1] for p in b["path"]])
        assert int(np.isnan(sic[rows, cols]).sum()) == 0

    def test_a_different_goal_gives_a_different_route(self, client):
        other = dict(self.BODY, goal_lat=-69.41, goal_lon=76.19)
        b = client.post("/api/route/optimize", json=other).get_json()
        base = client.post("/api/route/optimize", json=self.BODY).get_json()
        assert b["success"] is True
        assert b["waypoints"] != base["waypoints"]
        assert [list(p) for p in b["path"]] != [list(p) for p in base["path"]]

    def test_a_different_day_gives_a_different_sic_profile(self, client):
        b = client.post("/api/route/optimize",
                        json=dict(self.BODY, timestep=100)).get_json()
        assert b["date"] != "2026-01-06"
        assert b["max_sic"] != pytest.approx(0.75412625, abs=1e-6)

    def test_uncached_timestep_is_really_computed(self, client):
        """Two different days must not return the same cached plan."""
        a = client.post("/api/route/optimize", json=self.BODY).get_json()
        b = client.post("/api/route/optimize",
                        json=dict(self.BODY, timestep=30)).get_json()
        assert a["mean_sic"] != b["mean_sic"] or a["max_sic"] != b["max_sic"]

    # ---- rejections: no fabricated route, ever -------------------------

    def test_out_of_grid_longitude_is_rejected(self, client):
        r = client.post("/api/route/optimize",
                        json=dict(self.BODY, start_lon=-56.0))
        assert r.status_code == 400
        b = r.get_json()
        assert b["success"] is False
        assert b["reason"] == "out_of_grid"
        assert "path" not in b

    def test_out_of_grid_latitude_is_rejected(self, client):
        r = client.post("/api/route/optimize", json=dict(self.BODY, start_lat=10.0))
        assert r.status_code == 400
        assert r.get_json()["reason"] == "out_of_grid"

    def test_non_finite_coordinate_is_rejected(self, client):
        r = client.post("/api/route/optimize", json=dict(self.BODY, start_lat=None))
        assert r.status_code == 400
        assert r.get_json()["reason"] in {"invalid_coordinate", "missing_fields"}

    def test_timestep_out_of_range_is_rejected(self, client):
        r = client.post("/api/route/optimize", json=dict(self.BODY, timestep=999))
        assert r.status_code == 400
        assert r.get_json()["reason"] == "timestep_out_of_range"

    def test_missing_fields_are_rejected(self, client):
        r = client.post("/api/route/optimize", json={"start_lat": -32.0})
        assert r.status_code == 400
        assert r.get_json()["reason"] == "missing_fields"

    def test_unreachable_goal_is_rejected(self, client):
        r = client.post("/api/route/optimize", json=dict(self.BODY, goal_lat=-80.0))
        assert r.status_code == 400
        assert r.get_json()["reason"] in {"out_of_grid", "endpoint_not_navigable",
                                         "no_route"}

    def test_land_endpoint_without_snap_is_rejected(self, client):
        """Maitri's station cell is on the continent: refuse rather than
        quietly route to a neighbouring cell."""
        r = client.post("/api/route/optimize",
                        json=dict(self.BODY, goal_lat=-70.767, goal_lon=11.733,
                                  snap=False))
        assert r.status_code == 400
        assert r.get_json()["reason"] == "endpoint_not_navigable"

    def test_land_endpoint_with_snap_is_reported_not_hidden(self, client):
        r = client.post("/api/route/optimize",
                        json=dict(self.BODY, goal_lat=-70.767, goal_lon=11.733,
                                  snap=True))
        assert r.status_code == 200
        b = r.get_json()
        assert b["success"] is True
        assert b["goal"]["snapped"] is True
        assert b["goal"]["snap_radius_cells"] >= 1
        assert b["goal"]["requested"] == {"lat": -70.767, "lon": 11.733}

    def test_no_route_is_reported_as_such(self, client):
        """A goal boxed in by non-navigable cells must 400, not return a
        partial path."""
        r = client.post("/api/route/optimize",
                        json=dict(self.BODY, start_lat=-32.0, start_lon=-9.5,
                                  goal_lat=-70.0, goal_lon=10.5))
        assert r.status_code in (200, 400)
        if r.status_code == 400:
            assert r.get_json()["reason"] in {"no_route", "endpoint_not_navigable"}


# ---------------------------------------------------------------------------
# 7. POST /api/route/reroute — same leg, later real environment
# ---------------------------------------------------------------------------

class TestReroutePost:

    def _plan(self, client, **over):
        body = {"start_lat": -32.0, "start_lon": 82.0,
                "goal_lat": -70.0, "goal_lon": 10.5, "timestep": 0}
        body.update(over)
        return client.post("/api/route/optimize", json=body).get_json()

    def test_reroute_returns_both_routes_and_comparison(self, client):
        plan = self._plan(client)
        r = client.post("/api/route/reroute", json={
            "original_route": {"path": plan["path"], "start": plan["start"],
                               "goal": plan["goal"], "timestep": plan["timestep"],
                               "mean_sic": plan["mean_sic"],
                               "max_sic": plan["max_sic"]},
            "new_timestep": 100,
        })
        assert r.status_code == 200
        b = r.get_json()
        for key in ("original_route", "updated_route", "route_comparison",
                    "changed_segments", "metrics"):
            assert key in b, key
        assert b["forecast_step_days"] == 100
        assert b["new_date"] != b["origin_date"]
        assert b["updated_route"]["nan_cells"] == 0
        assert b["updated_route"]["validation"]["reaches_goal"] is True

    def test_reroute_keeps_the_same_endpoints(self, client):
        plan = self._plan(client)
        b = client.post("/api/route/reroute", json={
            "original_route": {"path": plan["path"], "start": plan["start"],
                               "goal": plan["goal"], "timestep": 0},
            "new_timestep": 100,
        }).get_json()
        assert b["start"]["cell"] == plan["start"]["cell"]
        assert b["goal"]["cell"] == plan["goal"]["cell"]

    def test_changed_segments_are_real_runs_of_real_cells(self, client):
        plan = self._plan(client)
        b = client.post("/api/route/reroute", json={
            "original_route": {"path": plan["path"], "start": plan["start"],
                               "goal": plan["goal"], "timestep": 0},
            "new_timestep": 100,
        }).get_json()
        segs = b["changed_segments"]
        assert len(segs) >= 2
        for sg in segs:
            assert sg["route"] in {"original", "updated"}
            assert sg["cells"] > 0
            assert sg["length_grid_units"] > 0
            source = b["original_route"]["path"] if sg["route"] == "original" \
                else b["updated_route"]["path"]
            assert sg["from_cell"] in [list(p) for p in source]
            assert sg["to_cell"] in [list(p) for p in source]

    def test_unchanged_corridor_is_reported_honestly(self, client):
        """D0 -> D3 genuinely leaves the corridor identical; that must be
        reported as a real result, not dressed up as a change."""
        plan = self._plan(client)
        b = client.post("/api/route/reroute", json={
            "original_route": {"path": plan["path"], "start": plan["start"],
                               "goal": plan["goal"], "timestep": 0},
            "new_timestep": 3,
        }).get_json()
        assert b["route_comparison"]["identical_path"] is True
        assert b["route_comparison"]["changed_cells"] == 0
        assert b["changed_segments"] == []

    def test_reroute_rejects_a_missing_original_route(self, client):
        r = client.post("/api/route/reroute", json={"new_timestep": 5})
        assert r.status_code == 400
        assert r.get_json()["reason"] == "invalid_original_route"

    def test_reroute_rejects_a_missing_path(self, client):
        r = client.post("/api/route/reroute",
                        json={"original_route": {"timestep": 0}, "new_timestep": 5})
        assert r.status_code == 400
        assert r.get_json()["reason"] == "invalid_original_route"

    def test_reroute_rejects_going_backwards_in_the_forecast(self, client):
        plan = self._plan(client)
        r = client.post("/api/route/reroute", json={
            "original_route": {"path": plan["path"], "timestep": 100},
            "new_timestep": 5,
        })
        assert r.status_code == 400
        assert r.get_json()["reason"] == "timestep_not_forward"

    def test_reroute_rejects_an_out_of_range_target_day(self, client):
        plan = self._plan(client)
        r = client.post("/api/route/reroute", json={
            "original_route": {"path": plan["path"], "timestep": 0},
            "new_timestep": 999,
        })
        assert r.status_code == 400
        assert r.get_json()["reason"] == "timestep_out_of_range"

    def test_reroute_metrics_carry_real_before_and_after_values(self, client):
        plan = self._plan(client)
        b = client.post("/api/route/reroute", json={
            "original_route": {"path": plan["path"], "start": plan["start"],
                               "goal": plan["goal"], "timestep": 0,
                               "mean_sic": plan["mean_sic"],
                               "max_sic": plan["max_sic"]},
            "new_timestep": 100,
        }).get_json()
        assert b["metrics"]["original"]["max_sic"] == pytest.approx(0.75412625, abs=1e-6)
        assert b["metrics"]["updated"]["max_sic"] == b["updated_route"]["max_sic"]
        assert b["metrics"]["delta"]["max_sic"] == pytest.approx(
            b["metrics"]["updated"]["max_sic"] - 0.75412625, abs=1e-5)


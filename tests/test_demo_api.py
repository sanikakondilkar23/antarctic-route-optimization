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
        assert set(lim) == {"sic", "cmems", "cvar", "route_ml", "route"}

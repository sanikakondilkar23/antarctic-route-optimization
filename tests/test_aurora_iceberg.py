"""
AURORA iceberg consolidation tests.

Coverage (adapted from the audited source repository's 13-test suite):
  1. checkpoint availability + byte identity (SHA256)
  2. model loading / status
  3. image preprocessing
  4. inference on a real SAR tile
  5. zero-detection (blank image) handling
  6. detection output format
  7. bounding-box validity (pixel space, clipped)
  8. confidence range
  9. risk adapter never fabricates coordinates or risk
 10. route integration honesty (iceberg_risk stays null)
 11. API response contract (multipart + JSON + errors)
 12. missing-georeferencing handling
"""

from __future__ import annotations

import base64
import hashlib
import io
import json
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.aurora.iceberg import paths as ice_paths            # noqa: E402
from backend.aurora.iceberg import risk as ice_risk              # noqa: E402
from backend.aurora.iceberg.inference import (                    # noqa: E402
    AuroraIcebergDetector,
    DetectorUnavailable,
)

FIXTURES = ice_paths.fixture_tiles()


@pytest.fixture(scope="module")
def det() -> AuroraIcebergDetector:
    return AuroraIcebergDetector()


@pytest.fixture(scope="module")
def sample_image() -> Path:
    if not FIXTURES:
        pytest.skip("no SAR fixture tiles committed")
    return FIXTURES[0]


@pytest.fixture(scope="module")
def blank_image(tmp_path_factory) -> Path:
    p = tmp_path_factory.mktemp("img") / "blank.png"
    Image.fromarray(np.zeros((512, 512), dtype=np.uint8)).save(p)
    return p


@pytest.fixture(scope="module")
def client():
    from backend.api.main import create_app
    app = create_app()
    app.config.update(TESTING=True)
    with app.test_client() as c:
        yield c


# --- 1. checkpoint availability + byte identity --------------------------------
def test_checkpoint_available():
    assert ice_paths.model_path().exists()
    assert ice_paths.model_path().stat().st_size > 1_000_000


def test_checkpoint_sha256_byte_identical():
    h = hashlib.sha256(ice_paths.model_path().read_bytes()).hexdigest()
    assert h == ice_paths.EXPECTED_SHA256


# --- 2. model loading ------------------------------------------------------------
def test_model_loads_and_status(det):
    st = det.status()
    assert st["classes"] == ["iceberg"]
    assert st["parameters"] == ice_paths.EXPECTED_PARAM_COUNT
    assert st["status"] == "READY"


def test_missing_checkpoint_raises(tmp_path):
    with pytest.raises(DetectorUnavailable):
        AuroraIcebergDetector(model_path=tmp_path / "nope.pt")


# --- 3. preprocessing -------------------------------------------------------------
def test_image_preprocessing(sample_image, blank_image):
    from backend.aurora.iceberg.inference import load_image
    for img in (sample_image, blank_image):
        size, mode = load_image(img)
        assert size[0] > 0 and size[1] > 0
        assert mode in ("L", "RGB", "RGBA")


def test_missing_image_raises(det, tmp_path):
    with pytest.raises(FileNotFoundError):
        det.detect(tmp_path / "does_not_exist.png")


# --- 4. inference ------------------------------------------------------------------
def test_inference_runs(det, sample_image):
    res = det.detect(sample_image)
    assert res["model"] == "best_sar_iceberg_model.pt"
    assert res["detection_count"] == len(res["icebergs"])
    assert isinstance(res["detected_at"], str) and res["detected_at"]
    json.dumps(res)


# --- 5. zero-detection -------------------------------------------------------------
def test_empty_image_zero_detections(det, blank_image):
    res = det.detect(blank_image)
    assert res["detection_count"] == 0
    assert res["icebergs"] == []


# --- 6. output format ----------------------------------------------------------------
def test_output_format(det, sample_image):
    res = det.detect(sample_image)
    for key in ("icebergs", "detection_count", "image_width", "image_height",
                "model", "detected_at", "confidence_threshold", "georeferencing"):
        assert key in res
    for d in res["icebergs"]:
        assert set(d) >= {"bbox", "confidence", "class", "location"}


# --- 7. bounding-box validity ---------------------------------------------------------
def test_bbox_validity(det, sample_image, blank_image):
    for img in (sample_image, blank_image):
        res = det.detect(img)
        for d in res["icebergs"]:
            x1, y1, x2, y2 = d["bbox"]
            assert 0 <= x1 < x2 <= res["image_width"]
            assert 0 <= y1 < y2 <= res["image_height"]


# --- 8. confidence range -----------------------------------------------------------------
def test_confidence_range(det, sample_image):
    res = det.detect(sample_image, conf=0.01)
    for d in res["icebergs"]:
        assert 0.0 <= d["confidence"] <= 1.0
        assert d["class"] == "iceberg"
    high = det.detect(sample_image, conf=0.99)
    assert high["detection_count"] == 0


# --- 9. risk adapter never fabricates ------------------------------------------------------
def _fake_detection(n: int = 1) -> dict:
    return {
        "icebergs": [{"bbox": [10.0, 10.0, 50.0, 50.0], "confidence": 0.4,
                      "class": "iceberg", "location": None}] * n,
        "detection_count": n,
        "image_width": 512,
        "image_height": 512,
        "model": "best_sar_iceberg_model.pt",
        "detected_at": None,
    }


def test_risk_adapter_status_inintegration_ready():
    out = ice_risk.for_route_optimizer(_fake_detection())
    assert out["integration_status"] == ice_risk.INTEGRATION_READY
    assert out["risk"]["risk_field"] is None
    assert out["locations"]["icebergs"][0]["location"] is None
    assert out["locations"]["icebergs"][0]["location_source"] == "pixel_only"


def test_affine_georeference_is_caller_supplied_only():
    geo = {"type": "affine", "pixel_to_lonlat": [[0.01, 0.0, -60.0],
                                                 [0.0, -0.01, -67.0]]}
    loc = ice_risk.detections_to_locations(_fake_detection(), geo)
    assert loc["icebergs"][0]["location"] is not None
    without = ice_risk.detections_to_locations(_fake_detection(), None)
    assert without["icebergs"][0]["location"] is None


# --- 10. route integration honesty ----------------------------------------------------------
def test_route_layers_keep_risk_null():
    layers = ice_risk.to_route_layers(_fake_detection())
    assert layers["iceberg_risk"] is None
    assert layers["iceberg_uncertainty"] is None
    assert layers["status"] == ice_risk.INTEGRATION_READY
    assert layers["detection_count"] == 1


def test_route_optimizer_does_not_claim_iceberg_consumption():
    from backend.api.main import discover_iceberg
    found = discover_iceberg()
    assert found["available"] is False, (
        "route side must keep reporting iceberg risk unavailable until a real "
        "risk field is wired and tested")


# --- 11. API contract ----------------------------------------------------------------------
def test_api_status(client):
    r = client.get("/api/icebergs/status")
    assert r.status_code == 200
    body = r.get_json()
    assert body["model_status"] == "ready"
    assert body["checkpoint_present"] is True
    assert body["georeferencing"]["available"] is False
    assert body["route_consumes_iceberg_risk"] is False
    assert body["risk_status"] == ice_risk.INTEGRATION_READY


def test_api_model(client):
    r = client.get("/api/icebergs/model")
    assert r.status_code == 200
    body = r.get_json()
    assert body["model_status"] == "ready"
    assert body["classes"] == ["iceberg"]
    assert body["checkpoint_sha256"] == ice_paths.EXPECTED_SHA256


def test_api_detect_json_path(client, sample_image):
    r = client.post("/api/icebergs/detect", json={"image_path": str(sample_image)})
    assert r.status_code == 200
    body = r.get_json()
    assert body["model_status"] == "ready"
    assert body["detection_count"] == len(body["detections"])
    assert body["image_width"] > 0 and body["image_height"] > 0
    assert body["georeferencing"]["available"] is False
    assert body["risk_status"] == ice_risk.INTEGRATION_READY
    for d in body["detections"]:
        assert d["coordinate_space"] == "pixel"
        assert d["location"] is None
        x1, y1, x2, y2 = d["bbox"]
        assert 0 <= x1 < x2 <= body["image_width"]
        assert 0 <= y1 < y2 <= body["image_height"]
        assert 0.0 <= d["confidence"] <= 1.0
    json.dumps(body)


def test_api_detect_blank_image_zero_detections(client, blank_image):
    b64 = base64.b64encode(blank_image.read_bytes()).decode()
    r = client.post("/api/icebergs/detect", json={"image_base64": b64})
    assert r.status_code == 200
    body = r.get_json()
    assert body["detection_count"] == 0
    assert body["detections"] == []
    assert body["model_status"] == "ready"


def test_api_detect_missing_image_404(client):
    r = client.post("/api/icebergs/detect", json={"image_path": "/no/such/file.png"})
    assert r.status_code == 404


def test_api_detect_bad_request_400(client):
    r = client.post("/api/icebergs/detect", json={})
    assert r.status_code == 400


def test_api_detect_multipart(client, sample_image):
    r = client.post("/api/icebergs/detect",
                    data={"image": (io.BytesIO(sample_image.read_bytes()),
                                    sample_image.name)},
                    content_type="multipart/form-data")
    assert r.status_code == 200
    assert r.get_json()["model_status"] == "ready"


def test_api_unsupported_content_type(client):
    r = client.post("/api/icebergs/detect", data="raw",
                    content_type="text/plain")
    assert r.status_code == 415


# --- 12. georeferencing handling -------------------------------------------------------------
def test_georeferencing_unavailable_is_reported_not_faked():
    assert ice_paths.GEOREFERENCING["available"] is False
    assert "Georeferencing unavailable" in ice_paths.GEOREFERENCING["status"]
    res = AuroraIcebergDetector().detect(FIXTURES[0]) if FIXTURES else None
    if res is not None:
        assert res["georeferencing"]["available"] is False
        for d in res["icebergs"]:
            assert d["location"] is None

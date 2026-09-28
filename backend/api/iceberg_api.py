"""
iceberg_api.py — AURORA iceberg endpoints (Flask blueprint).

POST /api/icebergs/detect
    multipart/form-data field ``image``  OR  JSON:
        {"image_path": "..."}  /  {"image_base64": "<data uri or b64>",
                                   "conf": 0.25}
    -> {
         "detections": [{"bbox": [x1,y1,x2,y2], "confidence": 0.0,
                          "class": "iceberg", "location": null,
                          "coordinate_space": "pixel"}],
         "detection_count": int,
         "image_width": int, "image_height": int,
         "model": str, "detected_at": str,
         "model_status": "ready",
         "georeferencing": {"available": false, "status": "Georeferencing unavailable"},
         "risk_status": "INTEGRATION READY"
       }

GET  /api/icebergs/model   -> checkpoint identity + verified facts
GET  /api/icebergs/status  -> detector / georeferencing / risk status

Only real information is returned: no coordinates without georeference, no
risk values without a risk model, and 0 detections is a normal response.
"""

from __future__ import annotations

import base64
import binascii
import tempfile
from pathlib import Path

from flask import Blueprint, jsonify, request

from backend.aurora.iceberg import paths, risk as risk_layer

bp = Blueprint("icebergs", __name__)

_MAX_INLINE_BYTES = 25 * 1024 * 1024


def _detector(conf: float | None = None):
    from backend.aurora.iceberg.inference import (AuroraIcebergDetector,
                                                  DetectorUnavailable)
    try:
        return AuroraIcebergDetector(conf=conf or paths.DEFAULT_CONF)
    except DetectorUnavailable as exc:
        raise _http(503, "model unavailable", str(exc))


def _http(code: int, status: str, detail: str):
    from werkzeug.exceptions import HTTPException

    class _E(HTTPException):
        description = detail

        def get_body(self, *a, **k):
            return ""

    _E.code = code
    _E.name = status
    return _E


def _payload(result: dict, conf: float) -> dict:
    detections = [
        {
            "bbox": d["bbox"],
            "confidence": d["confidence"],
            "class": d["class"],
            "location": d.get("location"),
            "coordinate_space": "pixel" if d.get("location") is None else "lonlat",
        }
        for d in result["icebergs"]
    ]
    route_view = risk_layer.to_route_layers(result)
    return {
        "detections": detections,
        "detection_count": result["detection_count"],
        "image_width": result["image_width"],
        "image_height": result["image_height"],
        "model": result["model"],
        "detected_at": result["detected_at"],
        "confidence_threshold": conf,
        "model_status": "ready",
        "georeferencing": dict(paths.GEOREFERENCING),
        "risk_status": route_view["status"],
        "iceberg_risk": route_view["iceberg_risk"],
    }


@bp.get("/api/icebergs/model")
def model_info():
    try:
        det = _detector()
    except Exception as exc:  # noqa: BLE001 - reported honestly, never a 500
        return jsonify({"model_status": "unavailable", "detail": str(exc)}), 503
    st = det.status()
    st["checkpoint_sha256"] = paths.EXPECTED_SHA256
    st["model_status"] = "ready"
    return jsonify(st)


@bp.get("/api/icebergs/status")
def status():
    checkpoint = paths.model_path()
    return jsonify({
        "component": "iceberg_detection",
        "checkpoint_present": checkpoint.exists(),
        "checkpoint_path": str(checkpoint),
        "checkpoint_sha256": paths.EXPECTED_SHA256,
        "model_status": "ready" if checkpoint.exists() else "unavailable",
        "georeferencing": dict(paths.GEOREFERENCING),
        "risk_status": risk_layer.INTEGRATION_READY,
        "route_consumes_iceberg_risk": False,
        "route_note": ("The route optimizer does not consume iceberg risk yet: "
                       "georeferencing is unavailable, so iceberg_risk stays null."),
        "dataset_status": "unavailable in this repository (inference-only import)",
    })


@bp.post("/api/icebergs/detect")
def detect():
    ctype = (request.content_type or "").split(";")[0].strip().lower()
    tmp: Path | None = None
    try:
        if ctype == "multipart/form-data":
            upload = request.files.get("image")
            if upload is None or not upload.filename:
                return jsonify({"error": "multipart field 'image' required"}), 400
            suffix = Path(upload.filename).suffix or ".png"
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as fh:
                upload.save(fh.name)
                tmp = Path(fh.name)
            source, conf = tmp, request.form.get("conf", type=float)
        elif ctype == "application/json":
            data = request.get_json(silent=True) or {}
            conf = data.get("conf")
            if data.get("image_path"):
                source = Path(data["image_path"])
                if not source.exists():
                    return jsonify({"error": f"image not found: {source}"}), 404
            elif data.get("image_base64"):
                raw = data["image_base64"].split(",", 1)[-1]
                try:
                    blob = base64.b64decode(raw, validate=True)
                except (binascii.Error, ValueError):
                    return jsonify({"error": "invalid base64 image"}), 400
                if len(blob) > _MAX_INLINE_BYTES:
                    return jsonify({"error": "image too large"}), 413
                with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as fh:
                    fh.write(blob)
                    tmp = Path(fh.name)
                source = tmp
            else:
                return jsonify(
                    {"error": "send multipart 'image', JSON 'image_path' "
                              "or JSON 'image_base64'"}), 400
        else:
            return jsonify({"error": "unsupported content type"}), 415

        det = _detector(conf)
        try:
            result = det.detect(source, conf=conf)
        except FileNotFoundError as exc:
            return jsonify({"error": str(exc)}), 404
        except Exception as exc:  # unreadable/corrupt image -> 422, never 500
            return jsonify({"error": f"inference failed: {exc}"}), 422
        return jsonify(_payload(result, result["confidence_threshold"]))
    finally:
        if tmp is not None:
            tmp.unlink(missing_ok=True)

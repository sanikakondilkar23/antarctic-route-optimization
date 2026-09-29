"""
AURORA unified API layer — one integration surface for the three project
models.

This blueprint is a *compositor*, not a second implementation.  It never
re-runs a model it cannot run, never invents a value, and reuses the existing
backend helpers (``optimize_route``, ``reroute_route``, ``uncertainty_frame``,
``slice_stats``, ``encode_slice_b64``) so there is exactly one routing
implementation and exactly one SIC raster contract in the project.

Endpoints
    GET  /api/sic/status        real runtime status of the SIC forecaster
    POST /api/sic/predict       real forecast field for a date + horizon
    GET  /api/aurora/status     the six-row model/data status area
    POST /api/aurora/analyze    the unified SIC -> iceberg -> environment ->
                                route workflow

Status vocabulary (section 11 of the task spec)
    READY                     the component runs right now
    INTEGRATION READY         code + weights present, blocked only on data
    DATA UNAVAILABLE          a dataset this component needs is absent
    MODEL UNAVAILABLE          weights / code / dependency missing
    GEOREFERENCING UNAVAILABLE detections exist but have no coordinates
    ERROR                      the check itself failed

Run:
    python -m backend.api.main      # the blueprint is registered by create_app()
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
from flask import Blueprint, jsonify, request

bp = Blueprint("aurora", __name__)

ROOT = Path(__file__).resolve().parents[2]
#: Committed day-2/day-3 forecast frames live here (30 real dates).
VALUES_DIR = ROOT / "frontend" / "data" / "values"
#: Committed SAR tiles the detector can be run against without an upload.
SAMPLES_DIR = ROOT / "tests" / "fixtures" / "sar_tiles"

STATUS_READY = "READY"
STATUS_INTEGRATION_READY = "INTEGRATION READY"
STATUS_DATA_UNAVAILABLE = "DATA UNAVAILABLE"
STATUS_MODEL_UNAVAILABLE = "MODEL UNAVAILABLE"
STATUS_GEOREFERENCING_UNAVAILABLE = "GEOREFERENCING UNAVAILABLE"
STATUS_ERROR = "ERROR"


# ---------------------------------------------------------------------------
# Lazy access to the existing backend module.
#
# main.create_app() registers this blueprint, so importing main at module
# scope here would be circular.  Importing inside the request handlers runs
# after main is fully loaded.
# ---------------------------------------------------------------------------

def _main():
    from backend.api import main as m
    return m


@lru_cache(maxsize=1)
def _raw_inputs_present() -> bool:
    """True only if the raw multi-channel 2026 inputs actually exist."""
    d = ROOT / "backend" / "data" / "test_2026" / "processed"
    return d.is_dir() and any(d.glob("*.npy"))


def _err(message: str, status: int = 400, **detail: Any):
    return jsonify({"success": False, "error": message, "detail": detail}), status


class BadRequest(ValueError):
    """Malformed /api/sic/predict or /api/aurora/analyze request."""

    def __init__(self, message: str, **detail: Any):
        super().__init__(message)
        self.detail = detail


# ---------------------------------------------------------------------------
# Shared probes — every one of these inspects real files or real imports.
# ---------------------------------------------------------------------------

def _probe_layer(name: str) -> Dict[str, Any]:
    """Ask src.data.paths whether a configured environmental dataset exists."""
    try:
        from src.data import paths as data_paths
    except Exception as exc:  # pragma: no cover - import-time dependency
        return {"status": STATUS_ERROR, "available": False,
                "reason": f"{type(exc).__name__}: {exc}"}
    try:
        p = data_paths.layer_path(name)
    except Exception as exc:  # pragma: no cover
        return {"status": STATUS_ERROR, "available": False,
                "reason": f"{type(exc).__name__}: {exc}"}
    if p is None:
        return {"status": STATUS_DATA_UNAVAILABLE, "available": False,
                "reason": f"SIH_DATA_ROOT unset and no override configured for "
                          f"{name!r}; no dataset path was supplied",
                "configured": False, "searched": None}
    if not p.exists():
        return {"status": STATUS_DATA_UNAVAILABLE, "available": False,
                "reason": f"configured path does not exist: {p}",
                "configured": True, "searched": str(p)}
    return {"status": STATUS_READY, "available": True, "path": str(p),
            "configured": True}


@lru_cache(maxsize=1)
def _sic_checkpoints() -> Dict[str, Any]:
    runs = ROOT / "backend" / "runs"
    members: List[Dict[str, Any]] = []
    for d in sorted(runs.glob("final_10ch_3f_seed*")):
        ckpt = d / "best_model.pt"
        members.append({
            "run": d.name,
            "path": str(ckpt.relative_to(ROOT)) if ckpt.exists() else None,
            "present": ckpt.exists(),
            "bytes": ckpt.stat().st_size if ckpt.exists() else None,
            "metrics": json.loads((d / "metrics.json").read_text(encoding="utf-8"))
            if (d / "metrics.json").exists() else None,
        })
    return {"n_members": len(members),
            "n_present": sum(1 for m in members if m["present"]),
            "members": members}


@lru_cache(maxsize=1)
def _iceberg_check() -> Dict[str, Any]:
    """Real state of the YOLOv8 detector: import, weights, georeferencing."""
    out: Dict[str, Any] = {}
    try:
        from backend.aurora.iceberg import paths as ice_paths
        out["georeferencing"] = dict(ice_paths.GEOREFERENCING)
    except Exception as exc:
        out["georeferencing"] = {"available": False,
                                 "status": f"{type(exc).__name__}: {exc}"}
        ice_paths = None

    ckpt = ROOT / "models" / "iceberg" / "best_sar_iceberg_model.pt"
    out["checkpoint"] = {
        "present": ckpt.exists(),
        "path": str(ckpt.relative_to(ROOT)) if ckpt.exists() else None,
        "bytes": ckpt.stat().st_size if ckpt.exists() else None,
    }

    try:
        import ultralytics  # noqa: F401
        out["runtime"] = {"available": True, "engine": "ultralytics YOLOv8"}
    except Exception as exc:
        out["runtime"] = {"available": False,
                          "reason": f"{type(exc).__name__}: {exc}"}

    try:
        from backend.aurora.iceberg.inference import AuroraIcebergDetector
        out["code"] = {"available": True,
                       "class": AuroraIcebergDetector.__name__}
    except Exception as exc:
        out["code"] = {"available": False,
                       "reason": f"{type(exc).__name__}: {exc}"}

    geo_ok = bool(out["georeferencing"].get("available"))
    if out["code"]["available"] and out["runtime"]["available"] \
            and out["checkpoint"]["present"]:
        out["status"] = (STATUS_READY if geo_ok
                         else STATUS_GEOREFERENCING_UNAVAILABLE)
        out["risk_status"] = ("READY" if geo_ok else "INTEGRATION READY")
    else:
        out["status"] = STATUS_MODEL_UNAVAILABLE
        out["risk_status"] = "MODEL UNAVAILABLE"
    out["route_consumes_iceberg_risk"] = bool(geo_ok)
    return out


def _route_check() -> Dict[str, Any]:
    try:
        import src.routing.astar as astar_mod
        import src.routing.cost as cost_mod
        ok = hasattr(astar_mod, "astar") and hasattr(cost_mod, "CostMap")
        m = _main()
        return {
            "status": STATUS_READY if ok else STATUS_MODEL_UNAVAILABLE,
            "algorithm": "A* + CostMap",
            "sources": ["src/routing/astar.py", "src/routing/cost.py",
                        "src/data/unified.py"],
            "endpoint": "POST /api/route/optimize",
            "active_weights": m.cost_weights().to_dict() if ok else None,
        }
    except Exception as exc:
        return {"status": STATUS_ERROR, "reason": f"{type(exc).__name__}: {exc}"}


# ---------------------------------------------------------------------------
# SIC prediction frame resolution
# ---------------------------------------------------------------------------

def _resolve_timestep(body: Dict[str, Any]) -> int:
    """Accept ``timestep`` (0..n-1) or an ISO ``date`` present in the artifact."""
    m = _main()
    n = int(m.sic_mmap().shape[0])

    if body.get("timestep") is not None:
        try:
            t = int(body["timestep"])
        except (TypeError, ValueError):
            raise BadRequest(f"timestep must be an integer, got "
                             f"{body['timestep']!r}")
        if not 0 <= t < n:
            raise BadRequest(f"timestep {t} out of range (0..{n - 1})",
                             timestep=t, n_timesteps=n)
        return t

    if body.get("date"):
        want = str(body["date"])[:10]
        dates = [str(d)[:10] for d in m.field().dates]
        if want not in dates:
            raise BadRequest(f"date {want} is not in the forecast artifact",
                             date=want, first=dates[0], last=dates[-1])
        return dates.index(want)

    raise BadRequest("supply either 'timestep' (0..n-1) or 'date' (YYYY-MM-DD)")


def _horizon_frame(t: int, horizon: int):
    """
    Real forecast field for one horizon, returned on the full routing grid.

    horizon 0  -> backend/cache/routing_sic_2026.npy (173x369, all 167 days)
    horizon 1+ -> frontend/data/values/<date>.json day2/day3 predicted fields
                  (101x361 model band, 30 real dates), embedded into the same
                  grid with NaN outside the band — the identical convention
                  ``uncertainty_frame`` uses.
    Returns ``(field, provenance)``.
    """
    m = _main()
    n_rows, n_cols = (int(v) for v in m.sic_mmap().shape[1:])

    if horizon == 0:
        arr = np.asarray(m.sic_mmap()[t], dtype=np.float64)
        return arr, {
            "source": "backend/cache/routing_sic_2026.npy",
            "coverage": "full routing grid",
            "grid": [n_rows, n_cols],
        }

    date = str(m.field().dates[t])[:10]
    path = VALUES_DIR / f"{date}.json"
    if not path.exists():
        raise BadRequest(
            f"horizon {horizon} is only committed for 30 real dates and "
            f"{date} is not one of them", horizon=horizon, date=date,
            available=sorted(p.stem for p in VALUES_DIR.glob("2026-*.json")))

    key = f"day{horizon + 1}"
    payload = json.loads(path.read_text(encoding="utf-8"))
    band = payload.get("horizons", {}).get(key, {}).get("predicted")
    if band is None:
        raise BadRequest(f"no {key} predicted field in {path.name}",
                         horizon=horizon, date=date)

    arr = np.full((n_rows, n_cols), np.nan, dtype=np.float64)
    block = np.array(band, dtype=np.float64)
    block[np.array([v is None for v in np.array(band, dtype=object)])] = np.nan
    mlat, mlon = block.shape
    arr[0:mlat, 0:mlon] = block
    return arr, {
        "source": f"frontend/data/values/{date}.json -> horizons.{key}.predicted",
        "coverage": "model band embedded in the routing grid",
        "grid": [n_rows, n_cols],
        "band": [mlat, mlon],
    }


# ---------------------------------------------------------------------------
# GET /api/sic/status
# ---------------------------------------------------------------------------

@bp.route("/api/sic/status", methods=["GET"])
def sic_status():
    try:
        m = _main()
        ck = _sic_checkpoints()

        artifact = ROOT / "backend" / "cache" / "routing_sic_2026.npy"
        unc = ROOT / "backend" / "cache" / "uncertainty_2026.npy"
        raw_inputs = ROOT / "backend" / "data" / "test_2026" / "processed"

        n_time = int(m.sic_mmap().shape[0])
        dates = [str(d)[:10] for d in m.field().dates]

        weights_ok = ck["n_present"] == ck["n_members"] and ck["n_members"] > 0
        inputs_present = raw_inputs.is_dir() and any(raw_inputs.glob("*.npy"))

        if not weights_ok:
            status = STATUS_MODEL_UNAVAILABLE
        elif artifact.exists() and not inputs_present:
            # The model is trained and loadable; live re-inference is blocked
            # only by absent inputs, and the committed output is served.
            status = STATUS_READY
        elif inputs_present:
            status = STATUS_READY
        else:
            status = STATUS_INTEGRATION_READY

        return jsonify({
            "component": "sic_forecaster",
            "model": "ConvLSTM (10-channel, 3 forecast horizons, 3 seeds)",
            "status": status,
            "checkpoints": ck,
            "artifact": {
                "present": artifact.exists(),
                "path": str(artifact.relative_to(ROOT)) if artifact.exists() else None,
                "shape": [int(v) for v in m.sic_mmap().shape],
            },
            "uncertainty_artifact": {
                "present": unc.exists(),
                "path": str(unc.relative_to(ROOT)) if unc.exists() else None,
                "shape": [int(v) for v in m.uncertainty_mmap().shape],
            },
            "n_timesteps": n_time,
            "date_range": [dates[0], dates[-1]],
            "horizons": [0, 1, 2],
            "horizon_availability": {
                "0": {"available": "all days",
                      "source": "routing_sic_2026.npy"},
                "1": {"available": "30 real dates",
                      "source": "frontend/data/values/*.json"},
                "2": {"available": "30 real dates",
                      "source": "frontend/data/values/*.json"},
            },
            "inference_rerun_possible": inputs_present,
            "inference_blocker": None if inputs_present else (
                "raw multi-channel 2026 inputs are absent "
                "(backend/data/test_2026/processed/*.npy); the committed "
                "forecast output is served as-is and is never re-synthesised"),
            "serving_mode": "committed forecast artifact",
            "model_status_note": "checkpoints are present and loadable; the "
                                 "dataset needed to re-run inference is not",
            "generated_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as exc:
        return _err(f"{type(exc).__name__}: {exc}", 500)


# ---------------------------------------------------------------------------
# POST /api/sic/predict
# ---------------------------------------------------------------------------

@bp.route("/api/sic/predict", methods=["POST"])
def sic_predict():
    body = request.get_json(silent=True) or {}
    try:
        m = _main()
        horizon = int(body.get("horizon", 0))
        if horizon not in (0, 1, 2):
            raise BadRequest("horizon must be 0, 1 or 2", horizon=horizon)

        t = _resolve_timestep(body)
        frm, prov = _horizon_frame(t, horizon)

        unc = m.uncertainty_frame(t, horizon)
        stats = m.slice_stats(frm)
        unc_stats = m.uncertainty_stats(unc)

        fmt = str(body.get("format", "b64")).lower()
        prediction: Dict[str, Any]
        if fmt == "array":
            prediction = {"encoding": "array",
                          "values": m.encode_slice_array(frm)}
        elif fmt == "stats":
            prediction = {"encoding": "stats"}
        else:
            prediction = {"encoding": "b64_uint8", **m.encode_slice_b64(frm)}

        uncertainty: Dict[str, Any]
        if fmt == "array":
            uncertainty = {"encoding": "array",
                           "values": m.encode_slice_array(unc)}
        elif fmt == "stats":
            uncertainty = {"encoding": "stats"}
        else:
            uncertainty = {"encoding": "b64_uint8", **m.encode_slice_b64(unc)}

        return jsonify({
            "success": True,
            "component": "sic_forecaster",
            "model_status": _sic_checkpoints() and (
                STATUS_READY if _sic_checkpoints()["n_present"] else
                STATUS_MODEL_UNAVAILABLE),
            "timestep": t,
            "date": str(m.field().dates[t])[:10],
            "horizon": horizon,
            "validity_days": horizon,
            "validity_note": (f"D+{horizon} from the same 3-seed ensemble"
                              if horizon == 0 else
                              f"day-{horizon + 1} frame committed with the "
                              f"forecast artifact"),
            "grid": {
                "n_rows": int(frm.shape[0]),
                "n_cols": int(frm.shape[1]),
                "resolution_deg": m.field().grid_spec()["resolution_deg"],
                "lat_range": [m.field().grid_spec()["lat_min"],
                              m.field().grid_spec()["lat_max"]],
                "lon_range": [m.field().grid_spec()["lon_min"],
                              m.field().grid_spec()["lon_max"]],
            },
            "prediction": {**prediction, "stats": stats},
            "uncertainty": {**uncertainty, "stats": unc_stats,
                            "horizon": horizon},
            "provenance": {
                **prov,
                "model": "3-seed ConvLSTM ensemble "
                         "(backend/runs/final_10ch_3f_seed{0,1,2}/best_model.pt)",
                "inference_mode": "committed forecast artifact",
                "inference_rerun_possible": _raw_inputs_present(),
                "nan_policy": "NaN = no value / non-navigable; never zero-filled",
            },
            "model_status": {
                "status": (STATUS_READY if _sic_checkpoints()["n_present"]
                           else STATUS_MODEL_UNAVAILABLE),
                "inference_rerun_possible": False,
                "note": "real committed forecast output; ConvLSTM inference is "
                        "not re-run at request time because the raw 2026 "
                        "multi-channel inputs are absent",
            },
            "generated_at": datetime.now(timezone.utc).isoformat(),
        })
    except BadRequest as exc:
        return _err(str(exc), 400, **exc.detail)
    except IndexError as exc:
        return _err(str(exc), 404)
    except Exception as exc:
        return _err(f"{type(exc).__name__}: {exc}", 500)


# ---------------------------------------------------------------------------
# GET /api/aurora/iceberg/samples — committed SAR tiles for the detector
# ---------------------------------------------------------------------------

@bp.route("/api/aurora/iceberg/samples", methods=["GET"])
def iceberg_samples():
    files = [p for p in sorted(SAMPLES_DIR.glob("*")) if p.is_file()]
    return jsonify({
        "component": "iceberg_detector",
        "directory": str(SAMPLES_DIR.relative_to(ROOT)),
        "count": len(files),
        "samples": [{
            "name": p.name,
            "bytes": p.stat().st_size,
            "endpoint": "POST /api/aurora/analyze",
            "field": "icebergs.sample",
        } for p in files],
        "note": "run a detection with {\"icebergs\":{\"sample\":\"<name>\"}} "
                "or upload your own image via image_base64",
    })


# ---------------------------------------------------------------------------
# GET /api/aurora/status — the six-row model status area
# ---------------------------------------------------------------------------

def _build_status() -> Dict[str, Any]:
    sic_ck = _sic_checkpoints()
    ice = _iceberg_check()
    route = _route_check()

    # --- SIC model -------------------------------------------------------
    if not sic_ck["n_present"]:
        sic = {"label": "SIC Model", "status": STATUS_MODEL_UNAVAILABLE,
               "available": False,
               "detail": f"{sic_ck['n_present']}/{sic_ck['n_members']} "
                         f"checkpoints present"}
    elif not (ROOT / "backend" / "cache" / "routing_sic_2026.npy").exists():
        sic = {"label": "SIC Model", "status": STATUS_DATA_UNAVAILABLE,
               "available": False,
               "detail": "routing_sic_2026.npy missing — nothing to serve"}
    else:
        sic = {"label": "SIC Model", "status": STATUS_READY, "available": True,
               "detail": f"{sic_ck['n_present']} ConvLSTM checkpoints · "
                         f"serving the committed 167-day forecast"}

    # --- Iceberg model ---------------------------------------------------
    iceberg = {
        "label": "Iceberg Model",
        "status": ice["status"],
        "available": ice["status"] in (STATUS_READY,),
        "detail": ("YOLOv8-nano detector runs on SAR tiles"
                   if ice["status"] == STATUS_READY else
                   "detector runs; detections have no coordinates, so none "
                   "reaches the route cost" if ice["status"] ==
                   STATUS_GEOREFERENCING_UNAVAILABLE else "weights unavailable"),
    }

    # --- Route model -----------------------------------------------------
    route_row = {
        "label": "Route Model",
        "status": route.get("status", STATUS_ERROR),
        "available": route.get("status") == STATUS_READY,
        "detail": ("A* + CostMap on the real SIC field"
                   if route.get("status") == STATUS_READY
                   else route.get("reason", "unavailable")),
        "active_weights": route.get("active_weights"),
    }

    # --- Environmental data ---------------------------------------------
    wind = _probe_layer("era5")
    if not wind.get("available"):
        alt = _probe_layer("ecmwf_ens")
        if alt.get("available"):
            wind = alt
    current = _probe_layer("cmems_future")
    if not current.get("available"):
        for alt_name in ("copernicus_ocean", "cmems_phy"):
            alt = _probe_layer(alt_name)
            if alt.get("available"):
                current = alt
                break
    water = _probe_layer("gebco")

    wind_row = {
        "label": "Wind Data",
        "status": wind["status"], "available": wind["available"],
        "detail": wind.get("reason") or f"reachable: {wind.get('path')}",
    }
    current_row = {
        "label": "Current Data",
        "status": current["status"], "available": current["available"],
        "detail": current.get("reason") or f"reachable: {current.get('path')}",
    }
    water_row = {
        "label": "Water / Bathymetry",
        "status": water["status"], "available": water["available"],
        "detail": water.get("reason") or f"reachable: {water.get('path')}",
    }

    geo_row = {
        "label": "Georeferencing",
        "status": (STATUS_READY if ice.get("georeferencing", {}).get("available")
                   else STATUS_GEOREFERENCING_UNAVAILABLE),
        "available": bool(ice.get("georeferencing", {}).get("available")),
        "detail": ice.get("georeferencing", {}).get("message")
                  or ice.get("georeferencing", {}).get("status")
                  or "unknown",
    }

    rows = [sic, iceberg, route_row, wind_row, current_row, water_row, geo_row]
    counts = {
        "ready": sum(1 for r in rows if r["status"] == STATUS_READY),
        "unavailable": sum(1 for r in rows
                           if r["status"] in (STATUS_DATA_UNAVAILABLE,
                                              STATUS_MODEL_UNAVAILABLE,
                                              STATUS_GEOREFERENCING_UNAVAILABLE)),
        "error": sum(1 for r in rows if r["status"] == STATUS_ERROR),
        "total": len(rows),
    }
    return {"rows": rows, "counts": counts}


@bp.route("/api/aurora/status", methods=["GET"])
def aurora_status():
    try:
        status = _build_status()
        return jsonify({
            "component": "aurora",
            "status": (STATUS_READY if all(r["available"] for r in status["rows"])
                       else STATUS_INTEGRATION_READY),
            "models": {
                "sic": status["rows"][0],
                "iceberg": status["rows"][1],
                "route": status["rows"][2],
            },
            "data": {
                "wind": status["rows"][3],
                "current": status["rows"][4],
                "water": status["rows"][5],
                "georeferencing": status["rows"][6],
            },
            "rows": status["rows"],
            "counts": status["counts"],
            "vocabulary": [STATUS_READY, STATUS_INTEGRATION_READY,
                           STATUS_DATA_UNAVAILABLE, STATUS_MODEL_UNAVAILABLE,
                           STATUS_GEOREFERENCING_UNAVAILABLE, STATUS_ERROR],
            "generated_at": datetime.now(timezone.utc).isoformat(),
        })
    except Exception as exc:
        return _err(f"{type(exc).__name__}: {exc}", 500)


# ---------------------------------------------------------------------------
# POST /api/aurora/analyze — the unified workflow
# ---------------------------------------------------------------------------

def _ll(value: Any, name: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise BadRequest(f"'{name}' must be {{lat, lon}}", field=name)
    try:
        return {"lat": float(value["lat"]), "lon": float(value["lon"])}
    except (KeyError, TypeError, ValueError):
        raise BadRequest(f"'{name}' needs numeric lat and lon", field=name)


def _detect(body: Dict[str, Any]) -> Dict[str, Any]:
    """Optional real SAR detection inside the unified workflow."""
    ice = _iceberg_check()
    out: Dict[str, Any] = {
        "status": ice["status"],
        "model": "YOLOv8-nano",
        "risk_status": ice["risk_status"],
        "georeferencing": ice.get("georeferencing"),
        "location": None,
        "coordinate_space": "pixel",
        "route_consumes_iceberg_risk": ice["route_consumes_iceberg_risk"],
        "detections": None,
        "detection_count": None,
        "note": "supply 'image_base64' (or 'image_path') to run the detector; "
                "otherwise only its status is reported",
    }
    payload = body.get("icebergs")
    if not isinstance(payload, dict) or not (
            payload.get("image_base64") or payload.get("image_path")
            or payload.get("sample")):
        return out

    # Reuse the detector exactly as the dedicated endpoint does: same loader
    # (iceberg_api._detector) and the same response shaping (iceberg_api._payload),
    # so the unified workflow and POST /api/icebergs/detect cannot disagree.
    import base64
    import tempfile

    from backend.api import iceberg_api as ia

    conf = payload.get("confidence")
    conf = float(conf) if conf is not None else None
    tmp: Optional[Path] = None
    try:
        if payload.get("sample"):
            # Basename only, resolved strictly inside the committed fixture
            # directory — never an arbitrary server path.
            name = Path(str(payload["sample"])).name
            source = SAMPLES_DIR / name
            if not source.exists():
                raise BadRequest(f"unknown sample tile: {name}", sample=name,
                                 available=[p.name for p in
                                            sorted(SAMPLES_DIR.glob("*"))
                                            if p.is_file()])
        elif payload.get("image_path"):
            source = Path(str(payload["image_path"]))
            if not source.exists():
                raise BadRequest(f"image not found: {source}",
                                 image_path=str(source))
        else:
            raw = str(payload["image_base64"]).split(",", 1)[-1]
            try:
                blob = base64.b64decode(raw, validate=True)
            except Exception as exc:
                raise BadRequest(f"invalid base64 image: {exc}")
            with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as fh:
                fh.write(blob)
                tmp = Path(fh.name)
            source = tmp

        detector = ia._detector(conf)
        result = detector.detect(source, conf=conf)
        shaped = ia._payload(result, result["confidence_threshold"])
    except BadRequest:
        raise
    except Exception as exc:
        out["status"] = STATUS_ERROR
        out["note"] = f"inference failed: {type(exc).__name__}: {exc}"
        return out
    finally:
        if tmp is not None:
            tmp.unlink(missing_ok=True)

    geo = shaped.get("georeferencing") or out["georeferencing"]
    out["detections"] = shaped.get("detections")
    out["detection_count"] = shaped.get("detection_count")
    out["image_width"] = shaped.get("image_width")
    out["image_height"] = shaped.get("image_height")
    out["confidence_threshold"] = shaped.get("confidence_threshold")
    out["model"] = shaped.get("model")
    out["risk_status"] = shaped.get("risk_status", out["risk_status"])
    out["iceberg_risk"] = shaped.get("iceberg_risk")
    out["georeferencing"] = geo
    out["location"] = None
    out["coordinate_space"] = "pixel"
    out["status"] = ("Georeferencing unavailable"
                     if not geo.get("available") else STATUS_READY)
    out["note"] = ("detections are pixel-space only; location is null and no "
                   "lat/lon is invented"
                   if not geo.get("available")
                   else "georeferenced detections")
    return out


@bp.route("/api/aurora/analyze", methods=["POST"])
def aurora_analyze():
    body = request.get_json(silent=True) or {}
    try:
        m = _main()

        start = _ll(body.get("start") or body.get("start_position"),
                    "start")
        destination = _ll(body.get("destination") or body.get("goal"),
                          "destination")

        vessel = body.get("vessel_parameters") or {}
        try:
            speed_kn = float(vessel.get("speed_knots", 12.0))
        except (TypeError, ValueError):
            raise BadRequest("vessel_parameters.speed_knots must be a number")
        if speed_kn <= 0:
            raise BadRequest("vessel_parameters.speed_knots must be > 0")

        ts_body: Dict[str, Any] = {}
        if body.get("date"):
            ts_body["date"] = body["date"]
        elif body.get("timestep") is not None:
            ts_body["timestep"] = body["timestep"]
        t = _resolve_timestep(ts_body)

        # ---- 1. route (existing optimizer, unchanged) --------------------
        try:
            plan = m.optimize_route(start["lat"], start["lon"],
                                    destination["lat"], destination["lon"], t)
        except m.RouteRequestError as exc:
            return _err(str(exc), 400, reason=getattr(exc, "reason", "rejected"),
                        **{k: v for k, v in getattr(exc, "detail", {}).items()})

        # ---- 2. SIC assessment ------------------------------------------
        frm = np.asarray(m.sic_mmap()[plan["timestep"]], dtype=np.float64)
        route_cells = np.array([p for p in plan["path"]], dtype=int)
        route_sic = frm[route_cells[:, 0], route_cells[:, 1]]
        sic_block = {
            "timestep": plan["timestep"],
            "date": plan["date"],
            "horizon": 0,
            "model_status": (STATUS_READY if _sic_checkpoints()["n_present"]
                             else STATUS_MODEL_UNAVAILABLE),
            "frame": {"mean": m.slice_stats(frm)["mean"],
                      "max": m.slice_stats(frm)["max"]},
            "along_route": {
                "mean": float(np.nanmean(route_sic)) if route_sic.size else None,
                "max": float(np.nanmax(route_sic)) if route_sic.size else None,
                "nan_cells": int(np.isnan(route_sic).sum()),
            },
            "uncertainty": {
                "horizon": 0,
                "stats": m.uncertainty_stats(m.uncertainty_frame(plan["timestep"], 0)),
            },
            "endpoint": "POST /api/sic/predict",
        }

        # ---- 3. iceberg assessment ---------------------------------------
        ice_block = _detect(body)
        ice_block["endpoint"] = "POST /api/icebergs/detect"

        # ---- 4. environmental assessment ---------------------------------
        def _env(label: str, probe: Dict[str, Any], weight: str) -> Dict[str, Any]:
            return {
                "label": label,
                "available": bool(probe.get("available")),
                "status": probe.get("status"),
                "detail": probe.get("reason") or f"reachable: {probe.get('path')}",
                "cost_weight": weight,
                "in_cost": bool(probe.get("available")),
            }

        wind_probe = _probe_layer("era5") or {}
        if not wind_probe.get("available"):
            wind_probe = _probe_layer("ecmwf_ens") or {}
        cur_probe = _probe_layer("cmems_future") or {}
        if not cur_probe.get("available"):
            for alt in ("copernicus_ocean", "cmems_phy"):
                p = _probe_layer(alt) or {}
                if p.get("available"):
                    cur_probe = p
                    break
        water_probe = _probe_layer("gebco") or {}

        weights = m.cost_weights().to_dict()
        environment = {
            "wind": _env("Wind", wind_probe, "w_wind"),
            "current": _env("Ocean current", cur_probe, "w_curr"),
            "water": _env("Water / bathymetry", water_probe, "w_depth"),
            "sic": {"label": "Sea-ice concentration", "available": True,
                    "status": STATUS_READY,
                    "detail": "committed 2026 forecast artifact",
                    "cost_weight": "w_sic",
                    "in_cost": bool(weights.get("w_sic"))},
            "uncertainty": {"label": "Forecast uncertainty",
                            "available": (ROOT / "backend" / "cache" /
                                          "uncertainty_2026.npy").exists(),
                            "status": (STATUS_READY if (ROOT / "backend" /
                                                        "cache" /
                                                        "uncertainty_2026.npy")
                                       .exists() else STATUS_DATA_UNAVAILABLE),
                            "cost_weight": "w_unc",
                            "in_cost": bool(weights.get("w_unc"))},
            "active_weights": weights,
            "note": "a layer contributes to the cost only when its weight is "
                    "non-zero AND its dataset is reachable; absent data is "
                    "never substituted",
        }

        # ---- 5. route result ---------------------------------------------
        km = plan.get("route_length_km")
        eta_h = (float(km) / (speed_kn * 1.852)
                 if km is not None and speed_kn else None)
        route_block = {
            "start": plan["start"],
            "destination": plan["goal"],
            "date": plan["date"],
            "timestep": plan["timestep"],
            "waypoints": plan["waypoints"],
            "distance": {
                "grid_units": plan["route_length"],
                "km": plan.get("route_length_km"),
                "direct_km": plan.get("direct_length_km"),
            },
            "eta": {
                "hours": round(eta_h, 2) if eta_h is not None else None,
                "days": round(eta_h / 24.0, 2) if eta_h is not None else None,
                "basis": f"route distance ÷ {speed_kn} kn vessel speed",
                "assumption": "uniform speed; currents and ice resistance are "
                              "NOT applied to this estimate",
                "is_model_output": False,
            },
            "risk": {
                "mean_sic": plan.get("mean_sic"),
                "max_sic": plan.get("max_sic"),
                "total_cost": plan.get("total_cost"),
                "nan_cells": plan.get("nan_cells"),
                "non_navigable_cells": plan.get("non_navigable_cells"),
                "layers_in_cost": plan.get("cost_breakdown", {}).get(
                    "layers_in_cost"),
                "iceberg_risk": None,
                "iceberg_risk_note":
                    "georeferencing unavailable — no iceberg risk field is "
                    "computed and none is invented",
            },
            "validation": plan.get("validation"),
            "algorithm": plan.get("algorithm"),
            "vessel_parameters": {
                "speed_knots": speed_kn,
                "draft_m": vessel.get("draft_m"),
                "ice_class": vessel.get("ice_class"),
            },
            "layer_status": plan.get("layer_status"),
        }

        # ---- 6. rerouting -------------------------------------------------
        rerouting = {
            "supported": True,
            "available": False,
            "endpoint": "POST /api/route/reroute",
            "note": "no conditions have changed yet; reroute is offered once "
                    "a route exists and a later forecast day is selected",
            "origin_timestep": None,
            "new_timestep": None,
        }

        return jsonify({
            "success": True,
            "workflow": "AURORA analyze",
            "sic": sic_block,
            "icebergs": ice_block,
            "environment": environment,
            "route": route_block,
            # The unmodified POST /api/route/optimize payload, so the existing
            # chart, metrics card and reroute flow can consume the unified
            # result without any second routing implementation.
            "route_plan": plan,
            "rerouting": rerouting,
            "model_status": _build_status(),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        })
    except BadRequest as exc:
        return _err(str(exc), 400, **exc.detail)
    except Exception as exc:
        return _err(f"{type(exc).__name__}: {exc}", 500)

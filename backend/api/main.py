"""
Read-only API for the SIH2026059 IceRoute-Robust interactive demo (Flask).

Serves the REAL committed artifacts already in this repository:

    backend/cache/routing_sic_2026.npy     real SIC forecast (167, 173, 369)
    backend/cache/routing_metadata.json    routing grid / band definition
    backend/cache/dates_2026.npy           forecast timestamps
    outputs/final_demo/final_route.json    verified A* route on real SIC

No model is trained, no artifact is modified, and no synthetic data is ever
returned.  Routing reuses the repository's existing code
(``src.data.sic_forecast``, ``src.routing.astar``,
``src.routing.scenario_router``) rather than reimplementing the algorithm.

Endpoints
    GET /api/health
    GET /api/sic/metadata
    GET /api/sic/<timestep>[?format=b64|array]
    GET /api/route
    GET /api/route/at/<timestep>
    GET /api/route/profile/<timestep>
    GET /api/uncertainty/<timestep>[?horizon=0..2]
    GET /api/uncertainty/summary
    GET /api/models/ensemble
    GET /api/reroute/<timestep>[?origin_timestep=0]
    GET /api/limitations
    GET /                     built React app (frontend/route_demo/dist)

NaN encoding
------------
JSON has no NaN literal, so a raw ``NaN`` would silently become ``null`` (or
break strict parsers) and the browser could not tell "SIC = 0" from
"invalid cell".  Therefore each timestep is returned as:

    sic_u8  : base64 uint8, ``round(SIC * 255)``, NaN written as 0
    valid   : base64 packed bitmask, 1 = real measurement, 0 = INVALID
              (non-navigable land / ice shelf / outside the model domain)

``valid == 0`` is authoritative: such a cell is non-navigable and its
``sic_u8`` byte carries NO meaning.  It must never be rendered or routed as
open water.  ``?format=array`` returns the same field with explicit ``null``
for invalid cells, for inspection and testing.

Run:
    python -m backend.api.main              # http://127.0.0.1:8000
"""

from __future__ import annotations

import base64
import json
import math
import os
import sys
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS  # type: ignore

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from src.data.builder import build_grid_template           # noqa: E402
from src.data.sic_forecast import SICForecastField        # noqa: E402
from src.routing.astar import astar                        # noqa: E402
from src.routing.cost import CostWeights                   # noqa: E402
from src.routing.scenario_router import (                  # noqa: E402
    jaccard_overlap, route_coverage,
)

CACHE = ROOT / "backend" / "cache"
ROUTE_JSON = ROOT / "outputs" / "final_demo" / "final_route.json"
FRONTEND_DIST = ROOT / "frontend" / "route_demo" / "dist"

# ---------------------------------------------------------------------------
# Configurable data root (Windows repo / Colab / cloud)
#
#   SIH_DATA_ROOT=/content/drive/MyDrive/SIH_26_Sanika   (Colab)
#   SIH_DATA_ROOT=C:\...\SIH_2026\antarctic_route_optimization   (Windows)
#
# When unset, the committed in-repository artifacts are used.  The browser
# never talks to Google Drive: only this backend does.
# ---------------------------------------------------------------------------
DATA_ROOT = Path(os.environ.get("SIH_DATA_ROOT") or ROOT)
CMEMS_ROOT = os.environ.get("ARCTIC_CMEMS_ROOT") or os.environ.get(
    "SIH_CMEMS_ROOT") or None
CMEMS_DATE_AWARE_ROOT = (
    str(DATA_ROOT / "dataset" / "Copernicus_Ocean") if CMEMS_ROOT is None
    else CMEMS_ROOT
)
ICEBERG_CANDIDATES = [
    Path(os.environ["SIH_ICEBERG_PATH"]) if os.environ.get("SIH_ICEBERG_PATH")
    else None,
    DATA_ROOT / "dataset" / "iceberg",
    DATA_ROOT / "iceberg",
    ROOT / "backend" / "cache" / "iceberg_risk.npy",
]

ROUTE_START = datetime(2026, 1, 6, tzinfo=timezone.utc)
DEFAULT_START = (172, 368)   # Cape Town, from the verified route artifact
DEFAULT_GOAL = (20, 82)      # Maitri, from the verified route artifact

LIMITATIONS: Dict[str, str] = {
    "sic": "REAL committed forecast output (backend/cache/routing_sic_2026.npy). "
           "NaN cells are non-navigable and are never zero-filled.",
    "cmems": "Unavailable in the current Windows demo environment "
             "(Google Drive not mounted). No currents are shown or faked.",
    "cvar": "Unavailable - iceberg risk / uncertainty layers are not present, "
            "so no CVaR value is computed or claimed.",
    "route_ml": "Policy checkpoint present (outputs/ml/route_policy.pt), "
                "trained on synthetic 20x25 smoke data; not used as a "
                "real-world accuracy claim and not used to produce this route.",
    "route": "Deterministic A* + CostMap on the real SIC field.",
}


# ---------------------------------------------------------------------------
# Lazily-initialised real data (memory-mapped; nothing is rewritten)
# ---------------------------------------------------------------------------

_FIELD: Optional[SICForecastField] = None
_SIC_MMAP: Optional[np.ndarray] = None
_UNC_MMAP: Optional[np.ndarray] = None


def field() -> SICForecastField:
    global _FIELD
    if _FIELD is None:
        if not (CACHE / "routing_sic_2026.npy").exists():
            raise FileNotFoundError(
                "real SIC artifact backend/cache/routing_sic_2026.npy missing")
        _FIELD = SICForecastField(cache_dir=str(CACHE),
                                  route_start_datetime=ROUTE_START)
    return _FIELD


def sic_mmap() -> np.ndarray:
    global _SIC_MMAP
    if _SIC_MMAP is None:
        _SIC_MMAP = np.load(str(CACHE / "routing_sic_2026.npy"), mmap_mode="r")
    return _SIC_MMAP


def uncertainty_mmap() -> np.ndarray:
    """
    Memory-map the committed SIC forecast-uncertainty artifact.

    Shape (n_time, 3, 101, 361): 3 lead-time horizons on the ConvLSTM model
    band only (lat -75..-50, lon -10..80).  Never modified, never regenerated.
    """
    global _UNC_MMAP
    if _UNC_MMAP is None:
        _UNC_MMAP = np.load(str(CACHE / "uncertainty_2026.npy"), mmap_mode="r")
    return _UNC_MMAP


def native_grid():
    spec = field().grid_spec()
    return build_grid_template(lat_min=spec["lat_min"], lat_max=spec["lat_max"],
                               lon_min=spec["lon_min"], lon_max=spec["lon_max"],
                               resolution_deg=spec["resolution_deg"])


def load_route_artifact() -> Dict[str, Any]:
    if not ROUTE_JSON.exists():
        raise FileNotFoundError(
            f"verified route artifact {ROUTE_JSON.name} is not available")
    return json.loads(ROUTE_JSON.read_text(encoding="utf-8"))


def check_timestep(t: int) -> int:
    n = int(sic_mmap().shape[0])
    if t < 0 or t >= n:
        raise IndexError(
            f"timestep {t} out of range; the real artifact has {n} forecast "
            f"timesteps (0..{n - 1})")
    return t


# ---------------------------------------------------------------------------
# Encoders
# ---------------------------------------------------------------------------

def encode_slice_b64(sic2d: np.ndarray) -> Dict[str, Any]:
    """uint8 value array + packed validity bitmask, both base64."""
    valid = ~np.isnan(sic2d)
    values = np.zeros(sic2d.shape, dtype=np.uint8)
    values[valid] = np.round(
        np.clip(sic2d[valid], 0.0, 1.0) * 255.0).astype(np.uint8)
    packed = np.packbits(valid.reshape(-1))  # row-major
    return {
        "shape": [int(sic2d.shape[0]), int(sic2d.shape[1])],
        "sic_u8": base64.b64encode(values.tobytes()).decode("ascii"),
        "valid": base64.b64encode(packed.tobytes()).decode("ascii"),
        "value_scale": 255,
    }


def encode_slice_array(sic2d: np.ndarray) -> List[List[Optional[float]]]:
    """Explicit ``null`` for every invalid cell (inspection / testing)."""
    return [[None if not np.isfinite(v) else round(float(v), 6) for v in row]
            for row in sic2d]


def slice_stats(sic2d: np.ndarray) -> Dict[str, Any]:
    finite = sic2d[np.isfinite(sic2d)]
    n_total = int(sic2d.size)
    return {
        "min": float(finite.min()) if finite.size else None,
        "mean": float(finite.mean()) if finite.size else None,
        "max": float(finite.max()) if finite.size else None,
        "n_cells": n_total,
        "n_navigable": int(finite.size),
        "n_non_navigable": int(n_total - finite.size),
    }


# ---------------------------------------------------------------------------
# Caching (per-timestep payloads and per-route plans)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=48)
def cached_slice_b64(t: int) -> Dict[str, Any]:
    return encode_slice_b64(np.asarray(sic_mmap()[t], dtype=np.float64))


@lru_cache(maxsize=48)
def cached_stats(t: int) -> Dict[str, Any]:
    return slice_stats(np.asarray(sic_mmap()[t], dtype=np.float64))


@lru_cache(maxsize=16)
def plan_route(t: int, start_row: int, start_col: int,
               goal_row: int, goal_col: int) -> Dict[str, Any]:
    """Run the repository's existing A* + CostMap on one real SIC timestep."""
    f = field()
    grid = f.load(t_hours=float(t) * 24.0, grid_template=native_grid())
    result = astar(grid, (start_row, start_col), (goal_row, goal_col),
                   weights=CostWeights())
    path = [[int(r), int(c)] for r, c in result.path]
    stats: Dict[str, Any] = {"mean_sic": None, "max_sic": None,
                             "nan_cells_on_route": None}
    if path:
        rows = np.array([p[0] for p in path])
        cols = np.array([p[1] for p in path])
        route_sic = grid.sic_mean[rows, cols]
        stats = {
            "mean_sic": float(np.nanmean(route_sic)),
            "max_sic": float(np.nanmax(route_sic)),
            "nan_cells_on_route": int(np.isnan(route_sic).sum()),
        }
    return {
        "timestep": t,
        "success": bool(result.success),
        "waypoints": int(result.num_waypoints),
        "route_length_grid_units": float(result.route_length),
        "total_cost": float(result.total_cost),
        "expanded_nodes": int(result.expanded_nodes),
        "path": path,
        **stats,
    }


# ---------------------------------------------------------------------------
# Availability discovery (never optimistic, never fabricated)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def discover_cmems() -> Tuple[bool, str, Tuple[str, ...]]:
    """
    Look for real CMEMS GLORYS files under the configured data root.

    Returns (available, description, sample_files).  Uses the same layout
    the existing loader expects, so nothing is re-implemented.
    """
    root = Path(CMEMS_DATE_AWARE_ROOT)
    if not root.is_dir():
        return False, f"{root} (not mounted / not configured)", ()
    found: List[str] = []
    for pattern in ("*/*.nc", "**/*.nc"):
        for p in sorted(root.glob(pattern)):
            found.append(str(p))
            if len(found) >= 8:
                break
        if found:
            break
    if not found:
        return False, f"{root} (present but contains no .nc files)", ()
    return True, str(root), tuple(found)


@lru_cache(maxsize=1)
def discover_sic_checkpoints() -> Tuple[Dict[str, Any], ...]:
    """Locate independently trained SIC forecasting checkpoints (read-only)."""
    out: List[Dict[str, Any]] = []
    search_roots = [ROOT / "backend" / "runs", DATA_ROOT / "models",
                    DATA_ROOT / "models" / "RL_final"]
    seen: set = set()
    for base in search_roots:
        if not base.is_dir():
            continue
        for p in sorted(base.rglob("*.pt")):
            rp = p.resolve()
            if rp in seen:
                continue
            seen.add(rp)
            entry: Dict[str, Any] = {
                "path": str(p.relative_to(ROOT)) if str(p).startswith(str(ROOT))
                        else str(p),
                "is_sic_forecaster": False,
            }
            try:  # inspect the state dict without executing anything
                import torch
                sd = torch.load(str(p), map_location="cpu", weights_only=True)
                keys = list(sd.keys()) if isinstance(sd, dict) else []
                entry["is_sic_forecaster"] = (
                    any(k.startswith("cells.") for k in keys)
                    and "head.weight" in keys
                )
                entry["n_tensors"] = len(keys)
            except Exception as exc:
                entry["error"] = f"{type(exc).__name__}"
            out.append(entry)
    return tuple(out)


@lru_cache(maxsize=1)
def discover_iceberg() -> Dict[str, Any]:
    """Look for iceberg risk / uncertainty layers needed by CVaR."""
    for cand in ICEBERG_CANDIDATES:
        if cand is not None and Path(cand).exists():
            return {
                "available": True,
                "path": str(cand),
                "label": "Iceberg risk data available",
            }
    return {
        "available": False,
        "path": None,
        "label": "Iceberg risk data NOT available",
        "searched": [str(c) for c in ICEBERG_CANDIDATES if c is not None],
        "note": ("src/data/adapters.py::IcebergAdapter is an empty stub and "
                 "routing_metadata.json marks the iceberg standoff cost term "
                 "as deferred."),
    }


@lru_cache(maxsize=1)
def discover_route_policy() -> Dict[str, Any]:
    """
    Describe the route ML policy checkpoint (never as a real-accuracy claim).
    """
    path = ROOT / "outputs" / "ml" / "route_policy.pt"
    if not path.exists():
        return {"present": False, "label": "Route ML policy: MISSING"}
    info: Dict[str, Any] = {
        "present": True,
        "path": "outputs/ml/route_policy.pt",
        "architecture": "Linear(16->64) ReLU Dropout(0.15) "
                        "Linear(64->32) ReLU Linear(32->8)",
        "n_features": None,
        "n_actions": None,
        "training_data": "synthetic 20x25 smoke-test dataset "
                         "(outputs/ml/route_training_dataset.npz)",
        "is_real_antarctic_accuracy": False,
        "label": "Route ML policy: available (trained on synthetic smoke data)",
        "used_for_final_route": False,
        "note": "The final route is produced by A* + CostMap on real SIC. The "
                "policy is safety-constrained by the expert route; its score "
                "is not presented as real-world accuracy.",
    }
    try:
        import torch
        ck = torch.load(str(path), map_location="cpu", weights_only=False)
        info["n_features"] = int(ck.get("n_features", 0)) or None
        info["n_actions"] = int(ck.get("n_actions", 0)) or None
        info["training_val_accuracy"] = float(ck.get("best_val_accuracy", 0.0))
    except Exception as exc:
        info["error"] = f"{type(exc).__name__}: {exc}"
    return info


# ---------------------------------------------------------------------------
# Forecast-uncertainty, ensemble and route-profile helpers (read-only)
# ---------------------------------------------------------------------------

def uncertainty_frame(timestep: int, horizon: int) -> np.ndarray:
    """
    Expand one ``uncertainty_2026.npy`` slice to the full routing grid.

    The artifact is (n_time, 3, 101, 361): the ConvLSTM model band only.
    Rows 101..172 (lat -49.75..-32) and columns 361..368 (lon 80.25..82) were
    never inside the model domain, so they are returned as NaN — exactly the
    same convention ``SICForecastField.uncertainty_at_time`` uses, and the same
    "NaN means no value" contract the SIC endpoint already follows.
    """
    unc = uncertainty_mmap()
    n_time, n_h, n_mlat, n_mlon = (int(v) for v in unc.shape)
    if not 0 <= horizon < n_h:
        raise IndexError(
            f"horizon {horizon} out of range; the artifact has {n_h} horizons "
            f"(0..{n_h - 1})")
    check_timestep(timestep)
    n_rows, n_cols = (int(v) for v in sic_mmap().shape[1:])
    out = np.full((n_rows, n_cols), np.nan, dtype=np.float64)
    out[0:n_mlat, 0:n_mlon] = np.asarray(unc[timestep, horizon], dtype=np.float64)
    return out


def uncertainty_stats(unc2d: np.ndarray) -> Dict[str, Any]:
    """Descriptive statistics of one uncertainty frame (finite cells only)."""
    finite = unc2d[np.isfinite(unc2d)]
    n_total = int(unc2d.size)
    out: Dict[str, Any] = {
        "n_cells": n_total,
        "n_within_model_domain": int(finite.size),
        "n_outside_model_domain": int(n_total - finite.size),
        "min": None, "mean": None, "median": None, "max": None,
        "p90": None, "p99": None,
    }
    if finite.size:
        out.update({
            "min": float(finite.min()),
            "mean": float(finite.mean()),
            "median": float(np.median(finite)),
            "max": float(finite.max()),
            "p90": float(np.percentile(finite, 90)),
            "p99": float(np.percentile(finite, 99)),
        })
    return out


@lru_cache(maxsize=1)
def discover_ensemble() -> Dict[str, Any]:
    """
    Read the three independently trained SIC ConvLSTM checkpoints' own
    training metrics (read-only JSON written by the training run).

    Nothing is re-run here and no accuracy figure is recomputed; the numbers
    are exactly what ``backend/runs/*/metrics.json`` recorded.
    """
    runs_dir = ROOT / "backend" / "runs"
    members: List[Dict[str, Any]] = []
    for d in sorted(runs_dir.glob("final_10ch_3f_seed*")):
        metrics_path = d / "metrics.json"
        ckpt_path = d / "best_model.pt"
        entry: Dict[str, Any] = {
            "run": d.name,
            "seed": int(d.name.rsplit("seed", 1)[-1]) if "seed" in d.name else None,
            "checkpoint": str(ckpt_path.relative_to(ROOT)) if ckpt_path.exists() else None,
            "checkpoint_present": ckpt_path.is_file(),
        }
        if metrics_path.is_file():
            try:
                entry["metrics"] = json.loads(metrics_path.read_text(encoding="utf-8"))
            except Exception as exc:
                entry["metrics_error"] = f"{type(exc).__name__}"
        members.append(entry)
    verification: Dict[str, Any] = {}
    val_path = ROOT / "outputs" / "final_demo" / "final_system_validation.json"
    if val_path.is_file():
        try:
            val = json.loads(val_path.read_text(encoding="utf-8"))
            verification = {
                "source": "outputs/final_demo/final_system_validation.json",
                "tests_passed": val.get("tests_passed"),
                "tests_failed": val.get("tests_failed"),
                "tests_status": val.get("tests_status"),
                "overall_status": val.get("overall_status"),
                "warnings": val.get("warnings"),
                "cvar_computed": val.get("cvar_computed"),
            }
        except Exception as exc:
            verification = {"error": f"{type(exc).__name__}"}
    return {
        "available": bool(members),
        "n_members": len(members),
        "members": members,
        "verification": verification,
        "architecture": "ConvLSTMCell(10ch x3frame -> 32) k3p1 -> "
                        "ConvLSTMCell(32 -> 64) k3p1 -> Dropout2d(0.1) -> "
                        "Conv2d(64 -> 3, k1) + sigmoid",
        "param_count": 270147,
        "param_count_source": "outputs/final_demo/final_system_validation.json",
        "horizons": 3,
        "inference_rerun_possible": False,
        "note": "The committed 2026 forecast artifact (routing_sic_2026.npy / "
                "uncertainty_2026.npy) is what the routing pipeline consumes. "
                "The raw 2026 multi-channel inference inputs (SIC, ERA5, CMEMS) "
                "are not present in this deployment, so ConvLSTM inference is "
                "NOT re-run by this API. These are the checkpoints' own recorded "
                "training metrics.",
    }


@lru_cache(maxsize=1)
def discover_uncertainty_summary() -> Dict[str, Any]:
    """The committed uncertainty distribution summary (read-only JSON)."""
    p = CACHE / "uncertainty_stats.json"
    if not p.is_file():
        return {"available": False}
    d = json.loads(p.read_text(encoding="utf-8"))
    hist = d.get("histogram") or {}
    return {
        "available": True,
        "source": "backend/cache/uncertainty_stats.json",
        "miz_mean_std": d.get("miz_mean_std"),
        "miz_median_std": d.get("miz_median_std"),
        "miz_p10_std": d.get("miz_p10_std"),
        "miz_p90_std": d.get("miz_p90_std"),
        "full_mean_std": d.get("full_mean_std"),
        "histogram_bins": hist.get("bins"),
        "histogram_counts": hist.get("counts"),
        "units": "SIC fraction (dimensionless, 0-1); the artifact provides no "
                 "physical unit beyond the SIC scale",
    }


@lru_cache(maxsize=8)
def route_profile(t: int, start_row: int, start_col: int,
                  goal_row: int, goal_col: int) -> Dict[str, Any]:
    """
    SIC encountered *along* the real A* route, sample by sample.

    Each sample carries the real grid cell, its real SIC at that timestep and
    the cumulative geodesic distance from the start, computed with the same
    great-circle cell sizes the repository builds (``routing_dx`` /
    ``routing_dy``, i.e. 0.25 deg at the cell's own latitude).  No value here
    is synthesised — if a cell is NaN the sample is reported as null and is
    never filled in.
    """
    f = field()
    grid = f.load(t_hours=float(t) * 24.0, grid_template=native_grid())
    result = astar(grid, (start_row, start_col), (goal_row, goal_col),
                   weights=CostWeights())
    path = [(int(r), int(c)) for r, c in result.path]
    lat = np.asarray(grid.lat)
    lon = np.asarray(grid.lon)
    R_KM = 6371.0
    samples: List[Dict[str, Any]] = []
    cum = 0.0
    max_idx = -1
    max_val = -np.inf
    for i, (r, c) in enumerate(path):
        if i:
            la0, lo0 = math.radians(float(lat[path[i - 1][0]])), math.radians(float(lon[path[i - 1][1]]))
            la1, lo1 = math.radians(float(lat[r])), math.radians(float(lon[c]))
            x = math.cos(la0) * math.cos(lo0) * math.cos(la1) * math.cos(lo1) \
                + math.cos(la0) * math.sin(lo0) * math.cos(la1) * math.sin(lo1) \
                + math.sin(la0) * math.sin(la1)
            cum += R_KM * math.acos(max(-1.0, min(1.0, x)))
        v = float(grid.sic_mean[r, c])
        v = v if math.isfinite(v) else None
        if v is not None and v > max_val:
            max_val, max_idx = v, i
        samples.append({
            "i": i,
            "row": r,
            "col": c,
            "lat": round(float(lat[r]), 4),
            "lon": round(float(lon[c]), 4),
            "cum_km": round(cum, 2),
            "sic": None if v is None else round(v, 6),
        })
    return {
        "timestep": t,
        "success": bool(result.success),
        "date": str(f.dates[t])[:10],
        "waypoints": int(result.num_waypoints),
        "route_length_grid_units": float(result.route_length),
        "total_cost": float(result.total_cost),
        "great_circle_length_km": round(cum, 2),
        "samples": samples,
        "max_sic_index": max_idx,
        "max_sic": None if max_idx < 0 else round(float(max_val), 6),
        "mean_sic": float(np.nanmean(grid.sic_mean[[p[0] for p in path],
                                                     [p[1] for p in path]]))
                     if path else None,
        "min_sic": float(np.nanmin(grid.sic_mean[[p[0] for p in path],
                                                  [p[1] for p in path]]))
                   if path else None,
        "nan_cells_on_route": int(np.isnan(grid.sic_mean[[p[0] for p in path],
                                                          [p[1] for p in path]]).sum())
                              if path else None,
        "note": "cum_km uses a great-circle approximation on the real 0.25 deg "
                "grid; route_length_grid_units is the repository's own A* cost.",
    }


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

def create_app() -> Flask:
    app = Flask(__name__, static_folder=None)
    CORS(app)

    # ---------------- health ----------------

    @app.get("/api/health")
    def health():
        return jsonify({
            "status": "ok",
            "sic_artifact": (CACHE / "routing_sic_2026.npy").exists(),
            "route_artifact": ROUTE_JSON.exists(),
        })

    # ---------------- metadata ----------------

    @app.get("/api/sic/metadata")
    def sic_metadata():
        f = field()
        info = f.describe()
        spec = f.grid_spec()
        lat = np.load(str(CACHE / "routing_lat.npy"))
        lon = np.load(str(CACHE / "routing_lon.npy"))
        return jsonify({
            "project": "SIH2026059",
            "system": "IceRoute-Robust",
            "title": "Antarctic Ocean Route Optimization",
            "data_source": "REAL",
            "artifact": "backend/cache/routing_sic_2026.npy",
            "n_timesteps": info["n_time_steps"],
            "n_rows": spec["n_rows"],
            "n_cols": spec["n_cols"],
            "dtype": info["sic_dtype"],
            "resolution_deg": info["resolution_deg"],
            "lat_range": [spec["lat_min"], spec["lat_max"]],
            "lon_range": [spec["lon_min"], spec["lon_max"]],
            "lat": [round(float(v), 4) for v in lat],
            "lon": [round(float(v), 4) for v in lon],
            "lat_count": int(lat.size),
            "lon_count": int(lon.size),
            "model_band_rows": info["model_band_rows"],
            "model_band_cols": info["model_band_cols"],
            "extension_band_rows": info["extension_band_rows"],
            "lon_extension_cols": info["lon_extension_cols"],
            "date_range": info["date_range"],
            "dates": [str(d)[:10] for d in f.dates],
            "uncertainty_shape": info["uncertainty_shape"],
            "uncertainty_horizons": info["n_horizons"],
            "nan_policy": "NaN means INVALID / NON-NAVIGABLE. Never converted to "
                          "zero and never routed through.",
            "nan_encoding": {
                "format": "base64",
                "sic_u8": "uint8 SIC*255; NaN stored as 0 but meaningless",
                "valid": "packed bitmask, 1=valid measurement, 0=non-navigable",
                "authoritative_field": "valid",
            },
            "array_format_note": "GET /api/sic/<t>?format=array returns the "
                                 "field with explicit null for invalid cells.",
        })

    # ---------------- one SIC timestep ----------------

    @app.get("/api/sic/<int:timestep>")
    def sic_slice(timestep: int):
        check_timestep(timestep)
        sic2d = np.asarray(sic_mmap()[timestep], dtype=np.float64)
        payload: Dict[str, Any] = {
            "timestep": timestep,
            "day": timestep,
            "date": str(field().dates[timestep])[:10],
            "grid": {"n_rows": int(sic2d.shape[0]), "n_cols": int(sic2d.shape[1])},
            "stats": cached_stats(timestep),
            "provenance": "REAL (backend/cache/routing_sic_2026.npy)",
        }
        if request.args.get("format") == "array":
            payload["format"] = "array"
            payload["nan_representation"] = "null"
            payload["sic"] = encode_slice_array(sic2d)
        else:
            payload["format"] = "b64"
            payload["encoding"] = cached_slice_b64(timestep)
            payload["nan_encoding"] = {
                "sic_u8": "uint8 SIC*255, NaN written as 0",
                "valid": "packed bits, 1=valid, 0=NON-NAVIGABLE (authoritative)",
            }
        return jsonify(payload)

    # ---------------- verified route ----------------

    @app.get("/api/route")
    def verified_route():
        artifact = load_route_artifact()
        cells = artifact.get("final_route_cells")
        if not cells:
            return jsonify({"error": "route artifact has no final_route_cells"}), 500
        expert = artifact.get("expert_route", {})
        return jsonify({
            "source": "outputs/final_demo/final_route.json",
            "algorithm": "A* + CostMap (src/routing/astar.py, src/routing/cost.py)",
            "data": "REAL SIC",
            "success": bool(expert.get("waypoints", 0) > 0),
            "leg": artifact.get("leg", {}),
            "waypoints": int(expert.get("waypoints", 0)),
            "route_length_grid_units": expert.get("route_length_cells"),
            "total_cost": expert.get("total_cost"),
            "path": [[int(c[0]), int(c[1])] for c in cells],
            "dynamic_rerouting": artifact.get("dynamic_rerouting", {}),
            "limitations": LIMITATIONS,
        })

    @app.get("/api/route/at/<int:timestep>")
    def route_at(timestep: int):
        check_timestep(timestep)
        a = request.args
        plan = plan_route(
            timestep,
            int(a.get("start_row", DEFAULT_START[0])),
            int(a.get("start_col", DEFAULT_START[1])),
            int(a.get("goal_row", DEFAULT_GOAL[0])),
            int(a.get("goal_col", DEFAULT_GOAL[1])),
        )
        return jsonify({
            "date": str(field().dates[timestep])[:10],
            "algorithm": "A* + CostMap",
            "data": "REAL SIC",
            "nan_policy": "NaN cells excluded from routing (non-navigable)",
            **plan,
        })

    # ---------------- dynamic rerouting ----------------

    @app.get("/api/reroute/<int:timestep>")
    def reroute(timestep: int):
        a = request.args
        origin = int(a.get("origin_timestep", 0))
        check_timestep(timestep)
        check_timestep(origin)
        sr = int(a.get("start_row", DEFAULT_START[0]))
        sc = int(a.get("start_col", DEFAULT_START[1]))
        gr = int(a.get("goal_row", DEFAULT_GOAL[0]))
        gc = int(a.get("goal_col", DEFAULT_GOAL[1]))

        original = plan_route(origin, sr, sc, gr, gc)
        new = plan_route(timestep, sr, sc, gr, gc)
        orig_cells = [tuple(p) for p in original["path"]]
        new_cells = [tuple(p) for p in new["path"]]
        both = bool(orig_cells and new_cells)

        return jsonify({
            "origin_timestep": origin,
            "reroute_timestep": timestep,
            "forecast_step_days": int(timestep - origin),
            "origin_date": str(field().dates[origin])[:10],
            "reroute_date": str(field().dates[timestep])[:10],
            "status": "SUCCESS" if new["success"] else "FAILED",
            "algorithm": "A* + CostMap on real SIC (src/routing/astar.py)",
            "reroute_logic": "src/routing/scenario_router.jaccard_overlap / "
                             "route_coverage",
            "original_route": {
                "success": original["success"],
                "waypoints": original["waypoints"],
                "route_length_grid_units": original["route_length_grid_units"],
                "mean_sic": original["mean_sic"],
                "max_sic": original["max_sic"],
                "nan_cells_on_route": original["nan_cells_on_route"],
                "path": original["path"],
            },
            "rerouted_route": {
                "success": new["success"],
                "waypoints": new["waypoints"],
                "route_length_grid_units": new["route_length_grid_units"],
                "mean_sic": new["mean_sic"],
                "max_sic": new["max_sic"],
                "nan_cells_on_route": new["nan_cells_on_route"],
                "path": new["path"],
            },
            "comparison": {
                "jaccard_overlap": float(jaccard_overlap(orig_cells, new_cells))
                if both else None,
                "route_coverage": float(route_coverage(orig_cells, new_cells))
                if both else None,
                "changed_cells": len(set(orig_cells) ^ set(new_cells))
                if both else None,
                "waypoints_before": original["waypoints"],
                "waypoints_after": new["waypoints"],
            },
            "limitations": LIMITATIONS,
        })

    @app.get("/api/limitations")
    def limitations():
        return jsonify(LIMITATIONS)

    # ---------------- system status / data availability ----------------

    @app.get("/api/system/status")
    def system_status():
        """What is genuinely available for this run. No optimistic claims."""
        sic_mmap()  # raises 503 if the real artifact is missing
        f = field()
        info = f.describe()
        spec = f.grid_spec()

        # --- CMEMS: discover, never fabricate ---
        cmems_available, cmems_note, cmems_files = discover_cmems()
        # --- SIC forecasting checkpoints (teammate's ConvLSTM) ---
        ckpts = discover_sic_checkpoints()
        # --- raw inference inputs ---
        raw_inputs = [p for p in (
            ROOT / "backend" / "data" / "test_2026",
            ROOT / "backend" / "data" / "processed",
            DATA_ROOT / "dataset" / "test_2026",
        ) if p.is_dir() and any(p.iterdir())]
        # --- iceberg / CVaR inputs ---
        iceberg = discover_iceberg()
        # --- route ML policy ---
        policy = discover_route_policy()

        return jsonify({
            "project": "SIH2026059",
            "system": "IceRoute-Robust",
            "title": "Antarctic Ocean Route Optimization",
            "data_root": str(DATA_ROOT),
            "generated_utc": datetime.now(timezone.utc).isoformat(),
            "environment": {
                "sic": {
                    "available": True,
                    "label": "Committed 2026 SIC forecast output",
                    "artifact": "backend/cache/routing_sic_2026.npy",
                    "n_timesteps": info["n_time_steps"],
                    "grid": [spec["n_rows"], spec["n_cols"]],
                    "resolution_deg": spec["resolution_deg"],
                    "lat_range": [spec["lat_min"], spec["lat_max"]],
                    "lon_range": [spec["lon_min"], spec["lon_max"]],
                    "date_range": info["date_range"],
                    "uncertainty_shape": info["uncertainty_shape"],
                    "uncertainty_horizons": info["n_horizons"],
                    "nan_policy": "NaN = non-navigable; never zero-filled",
                },
                "cmems": {
                    "available": cmems_available,
                    "label": ("CMEMS current data available"
                              if cmems_available else
                              "CMEMS CURRENT DATA UNAVAILABLE"),
                    "root": cmems_note,
                    "sample_files": cmems_files[:5],
                    "variables": ["uo", "vo"] if cmems_available else [],
                    "integration_present": True,
                    "note": ("Currents were NOT part of the route for this run; "
                             "no currents are faked."
                             if not cmems_available else
                             "Currents available; current_cost/uo/vo populated "
                             "on the EnvironmentalGrid."),
                },
                "iceberg": iceberg,
                "cvar": {
                    "available": bool(iceberg.get("available")),
                    "label": ("CVaR available" if iceberg.get("available") else
                              "CVaR unavailable \u2014 iceberg risk/uncertainty "
                              "data not available"),
                    "computed": False,
                    "note": "No CVaR value is computed or claimed in this demo.",
                },
            },
            "models": {
                "sic_forecaster": {
                    "present": any(c["is_sic_forecaster"] for c in ckpts),
                    "checkpoints": ckpts,
                    "role": "upstream inference component (teammate-owned)",
                    "inference_rerun_possible": bool(raw_inputs),
                    "label": ("Raw 2026 inference inputs present"
                              if raw_inputs else
                              "Committed 2026 SIC forecast output (raw inputs "
                              "absent; inference not re-run)"),
                    "raw_input_dirs": [str(p) for p in raw_inputs],
                },
                "route_policy": policy,
            },
            "routing": {
                "algorithm": "A* + CostMap (src/routing/astar.py, cost.py)",
                "safety": "NaN SIC cells marked non-navigable",
                "reroute": "A* replan on later real SIC forecast + "
                           "jaccard_overlap / route_coverage comparison",
                "verified_artifact": "outputs/final_demo/final_route.json",
            },
            "retraining_performed": False,
            "synthetic_route_data_used": False,
            "limitations": LIMITATIONS,
        })

    @app.get("/api/current/<int:timestep>")
    def current_slice(timestep: int):
        """
        CMEMS uo/vo for the requested forecast date, if real CMEMS data is
        reachable from the configured data root.  Never fabricates currents.
        """
        check_timestep(timestep)
        available, note, _files = discover_cmems()
        payload: Dict[str, Any] = {
            "timestep": timestep,
            "date": str(field().dates[timestep])[:10],
            "available": available,
            "label": ("CMEMS current data available" if available
                      else "CMEMS CURRENT DATA UNAVAILABLE"),
            "root": note,
            "integration": "src/data/cmems_loader.py (CMEMSDateAwareLoader)",
        }
        if not available:
            payload["uo"] = None
            payload["vo"] = None
            payload["note"] = ("No currents are returned. The UI must not show "
                               "current arrows and the route for this run did "
                               "not include current cost.")
            return jsonify(payload)

        # Real data path: reuse the existing loader (no reimplementation).
        try:
            from src.data.cmems_loader import CMEMSDateAwareLoader
            query_dt = datetime.combine(
                datetime.fromisoformat(payload["date"]), datetime.min.time(),
                tzinfo=timezone.utc,
            )
            loader = CMEMSDateAwareLoader(cmems_root=CMEMS_DATE_AWARE_ROOT,
                                          route_start_datetime=query_dt)
            uo, vo, _lat, _lon = loader.load_uo_vo(t_hours=0.0)
            payload.update({
                "uo": encode_slice_b64(np.asarray(uo, dtype=np.float64)),
                "vo": encode_slice_b64(np.asarray(vo, dtype=np.float64)),
                "grid": {"n_rows": int(uo.shape[0]), "n_cols": int(uo.shape[1])},
                "note": "Real CMEMS GLORYS surface currents.",
            })
        except Exception as exc:  # honest failure, never fake values
            payload.update({"available": False,
                            "label": "CMEMS CURRENT DATA UNAVAILABLE",
                            "uo": None, "vo": None,
                            "note": f"{type(exc).__name__}: {exc}"})
        return jsonify(payload)

    # ---------------- forecast uncertainty (real artifact) ----------------

    @app.get("/api/uncertainty/summary")
    def uncertainty_summary():
        return jsonify(discover_uncertainty_summary())

    @app.get("/api/uncertainty/<int:timestep>")
    def uncertainty_slice(timestep: int):
        """
        One forecast-uncertainty frame from the committed
        ``uncertainty_2026.npy`` artifact, expanded to the full routing grid
        and encoded with the same value/validity contract as the SIC endpoint.

        The artifact's 3 channels are lead-time horizons; no unit is invented
        beyond the SIC fraction itself.
        """
        horizon = int(request.args.get("horizon", 0))
        frame = uncertainty_frame(timestep, horizon)
        st = uncertainty_stats(frame)
        return jsonify({
            "timestep": timestep,
            "date": str(field().dates[timestep])[:10],
            "horizon": horizon,
            "horizon_days": horizon + 1,
            "n_horizons": int(uncertainty_mmap().shape[1]),
            "source": "backend/cache/uncertainty_2026.npy",
            "model_band_rows": [0, int(uncertainty_mmap().shape[2])],
            "model_band_cols": [0, int(uncertainty_mmap().shape[3])],
            "interpretation": "Higher value = less confidence in the forecast "
                              "SIC for that cell at this lead time.",
            "quantity": "SIC forecast spread (SIC fraction, 0-1); the artifact "
                        "carries no physical unit beyond the SIC scale",
            "stats": st,
            "encoding": encode_slice_b64(frame),
        })

    # ---------------- SIC forecast ensemble (checkpoints) ----------------

    @app.get("/api/models/ensemble")
    def models_ensemble():
        return jsonify(discover_ensemble())

    # ---------------- route risk profile ----------------

    @app.get("/api/route/profile/<int:timestep>")
    def route_profile_endpoint(timestep: int):
        """
        Real SIC encountered along the real A* route, one sample per
        waypoint, with cumulative great-circle distance.
        """
        sr = int(request.args.get("start_row", DEFAULT_START[0]))
        sc = int(request.args.get("start_col", DEFAULT_START[1]))
        gr = int(request.args.get("goal_row", DEFAULT_GOAL[0]))
        gc = int(request.args.get("goal_col", DEFAULT_GOAL[1]))
        check_timestep(timestep)
        return jsonify(route_profile(timestep, sr, sc, gr, gc))

    # ---------------- built React app ----------------

    @app.get("/")
    def index():
        if FRONTEND_DIST.is_dir() and (FRONTEND_DIST / "index.html").exists():
            return send_from_directory(str(FRONTEND_DIST), "index.html")
        return jsonify({
            "status": "backend running",
            "hint": "build the React app with: cd frontend/route_demo && "
                    "npm install && npm run build  (or use npm run dev)",
            "endpoints": ["/api/health", "/api/sic/metadata",
                          "/api/sic/<timestep>", "/api/route",
                          "/api/route/at/<timestep>",
                          "/api/route/profile/<timestep>",
                          "/api/uncertainty/<timestep>?horizon=0..2",
                          "/api/uncertainty/summary",
                          "/api/models/ensemble",
                          "/api/reroute/<timestep>", "/api/limitations"],
        })

    @app.get("/<path:filename>")
    def static_files(filename: str):
        if FRONTEND_DIST.is_dir():
            candidate = FRONTEND_DIST / filename
            if candidate.is_file():
                return send_from_directory(str(FRONTEND_DIST), filename)
        return jsonify({"error": "not found"}), 404

    @app.errorhandler(404)
    def not_found(_exc):
        return jsonify({"error": "not found"}), 404

    @app.errorhandler(IndexError)
    def bad_index(exc):
        return jsonify({"error": str(exc)}), 404

    @app.errorhandler(FileNotFoundError)
    def missing_file(exc):
        return jsonify({"error": str(exc)}), 503

    return app


app = create_app()


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description="SIH2026059 read-only SIC API")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()

    print(f"SIH2026059 IceRoute-Robust API  ->  http://{args.host}:{args.port}")
    print(f"  real SIC : {CACHE / 'routing_sic_2026.npy'}")
    print(f"  route    : {ROUTE_JSON}")
    app.run(host=args.host, port=args.port, debug=args.debug, threaded=True)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
dataset_audit.py — machine-readable audit of every dataset the full-Antarctic
route-optimization system depends on.

Design rules (from the project brief):

* NEVER claim a dataset is complete because a directory exists. Coverage is
  measured from the files themselves.
* NEVER fabricate, fill, extrapolate or resize. A dataset that cannot cover
  the routing region is reported with the region it actually covers.
* Every dataset carries an explicit status from a fixed vocabulary.
* The output is ``dataset_audit.json`` plus one manifest entry per file, with
  SHA-256, so any later claim of "available" is checkable.

Root resolution order
    1. ``--root`` argument
    2. ``$SIH_DATA_ROOT``
    3. the Google-Colab path ``/content/drive/MyDrive/SIH_26_Sanika/dataset``
    4. a local ``dataset/raw`` directory

If no root resolves, the Drive-hosted datasets are reported ``NOT_AVAILABLE``
with the reason, and the committed in-repository artifacts are still audited
for real. That is a truthful report, not a failed run.

Usage
    python dataset/audit/dataset_audit.py
    python dataset/audit/dataset_audit.py --root /content/drive/MyDrive/SIH_26_Sanika/dataset
    python dataset/audit/dataset_audit.py --no-hash     # skip SHA-256 (fast)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
DATASET_DIR = ROOT / "dataset"
OUT_JSON = DATASET_DIR / "audit" / "dataset_audit.json"
MANIFEST_DIR = DATASET_DIR / "manifests"

# --------------------------------------------------------------------------
# Target region — the routing domain the system must cover
# --------------------------------------------------------------------------
TARGET_LAT = (-75.0, -32.0)
TARGET_LON = (-10.0, 82.0)
TARGET_PERIOD = ("2021-01-01", "2025-12-31")
ROUTING_GRID = (173, 369)
ROUTING_RESOLUTION_DEG = 0.25

#: Datasets the Drive root is expected to contain, with what each must supply.
EXPECTED: Dict[str, Dict[str, Any]] = {
    "SIC": {
        "provider": "NSIDC / OSI SAF / AMSR2",
        "role": "sea-ice concentration",
        "layer": "sic_mean",
        "kind": "gridded",
    },
    "OSI_SAF": {
        "provider": "EUMETSAT OSI SAF",
        "role": "sea-ice concentration / ice edge",
        "layer": "sic_mean",
        "kind": "gridded",
    },
    "AMSR2": {
        "provider": "JAXA AMSR2",
        "role": "sea-ice concentration",
        "layer": "sic_mean",
        "kind": "gridded",
    },
    "Copernicus_Ocean": {
        "provider": "Copernicus Marine (GLORYS12V1)",
        "role": "ocean currents uo/vo",
        "layer": "current_uo/current_vo",
        "kind": "gridded",
        "must_preserve_vectors": ["uo", "vo"],
    },
    "CMEMS_PHY": {
        "provider": "Copernicus Marine",
        "role": "ocean physical fields",
        "layer": "current_uo/current_vo",
        "kind": "gridded",
        "must_preserve_vectors": ["uo", "vo"],
    },
    "CMEMS_Future_Forecast": {
        "provider": "Copernicus Marine forecasts",
        "role": "future ocean currents for forecast routing",
        "layer": "current_uo/current_vo",
        "kind": "gridded",
        "must_preserve_vectors": ["uo", "vo"],
    },
    "ERA5": {
        "provider": "ECMWF / Copernicus CDS",
        "role": "atmospheric forcing u10/v10/t2m",
        "layer": "wind_cost",
        "kind": "gridded",
    },
    "ECMWF_ENS": {
        "provider": "ECMWF ensemble",
        "role": "ensemble wind / uncertainty",
        "layer": "wind_cost",
        "kind": "gridded",
    },
    "ICEBERGS": {
        "provider": "national ice services / iceberg databases",
        "role": "iceberg risk observations",
        "layer": "iceberg_risk",
        "kind": "point_observations",
        "uncertainty_required": False,
    },
    "GEBCO": {
        "provider": "GEBCO",
        "role": "bathymetry + land mask",
        "layer": "depth",
        "kind": "static",
    },
    "AIS": {
        "provider": "AIS vessel tracking",
        "role": "observational vessel tracks",
        "layer": "validation_only",
        "kind": "point_observations",
    },
    "Vessel": {
        "provider": "project",
        "role": "static vessel metadata (draft, ice class)",
        "layer": "constraint",
        "kind": "static_metadata",
    },
}

STATUS_AVAILABLE = "AVAILABLE"
STATUS_PARTIAL = "PARTIAL"
STATUS_MISSING = "MISSING"
STATUS_NOT_AVAILABLE = "NOT_AVAILABLE"
STATUS_STATIC = "STATIC"
STATUS_IRREGULAR = "IRREGULAR"
STATUS_READY = "READY_FOR_INTEGRATION"
STATUS_BLOCKED = "BLOCKED"
#: A file was found and identified, but this environment has no reader for its
#: format. This is an honest statement about the AUDIT, never about the data:
#: the file is not assumed to be complete, empty or invalid.
STATUS_NOT_READABLE = "NOT_READABLE_WITH_CURRENT_ENVIRONMENT"

NETCDF_EXT = {".nc", ".nc4", ".cdf"}

#: Which authentication each dataset needs from an official source. Used by the
#: download script to report AUTH_REQUIRED instead of guessing.
AUTH_REQUIREMENT = {
    "SIC": "earthdata login (NASA NSIDC)",
    "OSI_SAF": "none (open)",
    "AMSR2": "none / JAXA registration",
    "Copernicus_Ocean": "Copernicus Marine account",
    "CMEMS_PHY": "Copernicus Marine account",
    "CMEMS_Future_Forecast": "Copernicus Marine account",
    "ERA5": "CDS API key (~/.cdsapirc)",
    "ECMWF_ENS": "ECMWF / CDS credentials",
    "ICEBERGS": "varies by national ice service",
    "GEBCO": "none (open)",
    "AIS": "provider-dependent",
    "Vessel": "none (project metadata)",
}


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def sha256(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def resolve_root(explicit: Optional[str]) -> Tuple[Optional[Path], str]:
    candidates: List[Tuple[str, Optional[Path]]] = []
    if explicit:
        candidates.append((f"--root {explicit}", Path(explicit)))
    if os.environ.get("SIH_DATA_ROOT"):
        candidates.append(("$SIH_DATA_ROOT", Path(os.environ["SIH_DATA_ROOT"])))
    candidates.append((
        "colab /content/drive/MyDrive/SIH_26_Sanika/dataset",
        Path("/content/drive/MyDrive/SIH_26_Sanika/dataset"),
    ))
    candidates.append(("local dataset/raw", DATASET_DIR / "raw"))
    for label, path in candidates:
        if path and path.is_dir():
            return path, label
    tried = "; ".join(f"{label} ({p})" for label, p in candidates)
    return None, tried


def _coord_name(ds, kind: str) -> Optional[str]:
    """Find a latitude/longitude coordinate, tolerating common aliases."""
    lat_aliases = ("lat", "latitude", "LAT", "Latitude", "y", "nav_lat")
    lon_aliases = ("lon", "longitude", "LON", "Longitude", "x", "nav_lon")
    want = lat_aliases if kind == "lat" else lon_aliases
    for n in want:
        if n in ds.coords or n in ds.variables:
            return n
    return None


def _as_decimal(arr) -> Tuple[float, float, float, str]:
    """Return (min, max, spacing, unit) handling 0..360 and 0..N index grids."""
    vals = np.asarray(arr, dtype=np.float64).ravel()
    vals = vals[np.isfinite(vals)]
    if vals.size == 0:
        return (float("nan"),) * 2 + (float("nan"), "unknown")
    lo, hi = float(vals.min()), float(vals.max())
    unit = "unknown"
    attrs = getattr(arr, "attrs", {}) or {}
    unit = str(attrs.get("units", "unknown"))
    if hi > 180.0:  # 0..360 convention
        return lo, hi, _spacing(vals), unit + " (0..360)"
    return lo, hi, _spacing(vals), unit


def _spacing(vals: np.ndarray) -> float:
    u = np.unique(vals)
    if u.size < 2:
        return float("nan")
    d = np.diff(u)
    d = d[d > 0]
    return float(np.median(d)) if d.size else float("nan")


def _time_info(ds) -> Dict[str, Any]:
    for name in ("time", "TIME", "t", "valid_time", "datetime"):
        if name in ds.coords or name in ds.variables:
            v = ds[name]
            try:
                decoded = xarray_time(v)
            except Exception:
                return {"present": True, "readable": False, "coord": name}
            vals = np.atleast_1d(decoded.values.ravel())
            t = pd_index(vals)
            out: Dict[str, Any] = {
                "present": True, "readable": True, "coord": name,
                "n_timestamps": int(vals.size),
                "earliest": t[0], "latest": t[1],
                "native_resolution": t[2], "frequency": t[3],
            }
            return out
    return {"present": False, "readable": False,
            "note": "no time coordinate found"}


def xarray_time(v):
    import xarray as xr
    if np.issubdtype(np.asarray(v.values).dtype, np.datetime64):
        return v
    try:
        return xr.decode_cf(v)
    except Exception:
        return v


def pd_index(vals: np.ndarray) -> Tuple[str, str, str, str]:
    import pandas as pd
    idx = pd.DatetimeIndex(vals)
    idx = idx.sort_values()
    earliest = str(idx[0])[:19]
    latest = str(idx[-1])[:19]
    if idx.size < 2:
        return earliest, latest, "single timestamp", "irregular"
    deltas = np.diff(idx.values).astype("timedelta64[s]").astype(np.int64)
    deltas = deltas[deltas > 0]
    if deltas.size == 0:
        return earliest, latest, "single distinct timestamp", "irregular"
    med = int(np.median(deltas))
    uniq = sorted(set(deltas.tolist()))

    # Named cadences FIRST: a perfectly regular daily series has exactly one
    # distinct delta, so any "few distinct values" shortcut would mislabel it.
    named = {86400: ("1 day", "daily"),
             43200: ("12 hours", "12-hourly"),
             21600: ("6 hours", "6-hourly"),
             10800: ("3 hours", "3-hourly"),
             3600: ("1 hour", "hourly"),
             1800: ("30 minutes", "30-minutely"),
             900: ("15 minutes", "15-minutely")}
    if med in named and len(uniq) == 1:
        res, freq = named[med]
        return earliest, latest, res, freq

    note = f"{med}s median"
    if len(uniq) > 1:
        note += f"; {len(uniq)} distinct intervals -> irregular"
    if len(uniq) == 1:
        note += "; regular"
    return earliest, latest, f"{med}s", note


def covers_target(lat: Tuple[float, float], lon: Tuple[float, float]) -> Dict[str, Any]:
    lat_ok = (not np.isnan(lat[0])) and lat[0] <= TARGET_LAT[0] + 1e-6 and lat[1] >= TARGET_LAT[1] - 1e-6
    lon_ok = (not np.isnan(lon[0])) and lon[0] <= TARGET_LON[0] + 1e-6 and lon[1] >= TARGET_LON[1] - 1e-6
    return {
        "lat_covers_target": bool(lat_ok),
        "lon_covers_target": bool(lon_ok),
        "full_target_coverage": bool(lat_ok and lon_ok),
    }


# --------------------------------------------------------------------------
# per-file inspection
# --------------------------------------------------------------------------
def inspect_netcdf(path: Path) -> Dict[str, Any]:
    import xarray as xr
    out: Dict[str, Any] = {"file": str(path), "format": "netcdf", "readable": False}
    try:
        # Decode times: this pass only reads metadata (coords, shapes), and a
        # readable calendar is exactly what the coverage report needs.
        ds = xr.open_dataset(path, decode_times=True, mask_and_scale=False)
    except Exception as exc:
        out["error"] = f"{type(exc).__name__}: {exc}"
        # The extension may lie (a .nc4 that is really HDF5, say). Report the
        # format the CONTENT indicates and do not claim a netCDF was read.
        actual = identify_format(path)
        if actual != "netcdf":
            out["format"] = actual
            out["status"] = STATUS_NOT_READABLE
            out["note"] = (f"extension suggested netCDF but the content is "
                           f"{actual}; not read in this environment")
        return out
    try:
        out["readable"] = True
        out["variables"] = sorted(str(v) for v in ds.variables)
        out["dimensions"] = {str(k): int(v) for k, v in ds.sizes.items()}
        latn = _coord_name(ds, "lat")
        lonn = _coord_name(ds, "lon")
        if latn:
            out["lat"] = _as_decimal(ds[latn].values)
            out["lat_coord"] = latn
        if lonn:
            out["lon"] = _as_decimal(ds[lonn].values)
            out["lon_coord"] = lonn
        if latn and lonn:
            out.update(covers_target(out["lat"][:2], out["lon"][:2]))
        out["time"] = _time_info(ds)
        # depth level, if any
        for dn in ("depth", "depth_u", "lev", "level", "z"):
            if dn in ds.coords or dn in ds.variables:
                d = np.asarray(ds[dn].values, dtype=np.float64).ravel()
                d = d[np.isfinite(d)]
                if d.size:
                    out["depth"] = {"coord": dn, "min": float(d.min()),
                                    "max": float(d.max()), "n": int(d.size)}
                break
    except Exception as exc:
        out["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        try:
            ds.close()
        except Exception:
            pass
    return out


def identify_format(path: Path) -> str:
    """
    Format from the file CONTENT first, extension second.

    Content wins because extensions lie: a ``.nc4`` file is frequently plain
    HDF5, and reporting it as netCDF would imply we read it when we did not.
    """
    try:
        with open(path, "rb") as fh:
            magic = fh.read(8)
        if magic[:4] == b"GRIB":
            return "grib"
        if magic[:3] == b"CDF":
            return "netcdf"
        if magic[:4] == b"\x89HDF":
            return "hdf5"
        if magic[:2] == b"PK":
            return "zip_container"
        if magic[:5] == b"{\n  " or magic[:1] in (b"{", b"["):
            return "json"
        if magic[:2] == b"\x93NUM":
            return "numpy"
    except Exception:
        pass
    ext = path.suffix.lower()
    known = {
        ".nc": "netcdf", ".nc4": "netcdf", ".cdf": "netcdf",
        ".grib": "grib", ".grib2": "grib", ".grb": "grib", ".grb2": "grib",
        ".h5": "hdf5", ".hdf5": "hdf5", ".hdf": "hdf5",
        ".zarr": "zarr", ".tif": "geotiff", ".tiff": "geotiff",
        ".csv": "csv", ".parquet": "parquet", ".json": "json",
        ".npy": "numpy", ".npz": "numpy", ".txt": "text", ".log": "text",
    }
    return known.get(ext, ext.lstrip(".") or "unknown")


def inspect_generic(path: Path) -> Dict[str, Any]:
    """
    Identify the format and read only what this environment can genuinely read.

    The available stack is numpy / xarray / netCDF4 / pandas / pyarrow / PIL.
    Anything needing cfgrib, h5py, zarr or rasterio is reported as
    ``NOT_READABLE_WITH_CURRENT_ENVIRONMENT`` together with its size and path.
    No metadata is ever invented for an unreadable file.
    """
    fmt = identify_format(path)
    out: Dict[str, Any] = {"file": str(path), "format": fmt}

    if fmt == "numpy":
        try:
            arr = np.load(path, mmap_mode="r", allow_pickle=False)
            out.update(readable=True, reader="numpy",
                       shape=list(getattr(arr, "shape", [])),
                       dtype=str(getattr(arr, "dtype", "")),
                       kind="array")
            if arr.dtype.kind == "f":
                a = np.asarray(arr)
                fin = np.isfinite(a)
                out["finite_cells"] = int(fin.sum())
                out["nan_cells"] = int(a.size - fin.sum())
            if arr.ndim >= 2:
                out["spatial_dims"] = [int(arr.shape[-2]), int(arr.shape[-1])]
            return out
        except Exception as exc:
            out.update(readable=False, reader="numpy",
                       status=STATUS_NOT_READABLE, error=f"{type(exc).__name__}")
            return out

    if fmt in ("csv", "parquet"):
        try:
            import pandas as pd
            df = pd.read_parquet(path) if fmt == "parquet" else pd.read_csv(path, nrows=200000)
            out.update(readable=True, reader="pandas", rows=int(len(df)),
                       columns=[str(c) for c in df.columns][:64])
            return out
        except Exception as exc:
            out.update(readable=False, reader="pandas",
                       status=STATUS_NOT_READABLE, error=f"{type(exc).__name__}")
            return out

    if fmt == "json":
        try:
            data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
            out.update(readable=True, reader="json",
                       keys=sorted(data)[:32] if isinstance(data, dict) else None,
                       top_level_type=type(data).__name__)
            return out
        except Exception as exc:
            out.update(readable=False, reader="json",
                       status=STATUS_NOT_READABLE, error=f"{type(exc).__name__}")
            return out

    # grib / hdf5 / zarr / geotiff / anything else
    out.update(readable=False, reader=None, status=STATUS_NOT_READABLE,
               note=(f"{fmt} file present; this environment has no reader for it. "
                     f"Install the matching library in Colab "
                     f"(cfgrib+eccodes / h5py / zarr / rasterio) to audit it. "
                     f"Its presence and size are recorded; its contents are NOT "
                     f"assumed."))
    return out


MONTH_RE = None


def _month_patterns():
    global MONTH_RE
    if MONTH_RE is None:
        import re
        MONTH_RE = re.compile(r"(19|20)(\d{2})[-_]?(0[1-9]|1[0-2])")
    return MONTH_RE


def missing_months(periods: List[Tuple[int, int]], start: str, end: str) -> List[str]:
    """Missing (year, month) pairs inside the target period."""
    import re
    have = {(y, m) for y, m in periods}
    m0 = re.match(r"(\d{4})-(\d{2})", start or "")
    m1 = re.match(r"(\d{4})-(\d{2})", end or "")
    if not (m0 and m1 and have):
        return []
    y, mo = int(m0.group(1)), int(m0.group(2))
    ey, emo = int(m1.group(1)), int(m1.group(2))
    out: List[str] = []
    while (y, mo) <= (ey, emo):
        if (y, mo) not in have:
            out.append(f"{y:04d}-{mo:02d}")
        mo += 1
        if mo == 13:
            y, mo = y + 1, 1
    return out


def periods_from_names(paths: List[Path]) -> List[Tuple[int, int]]:
    rx = _month_patterns()
    found: List[Tuple[int, int]] = []
    for p in paths:
        m = rx.search(p.stem)
        if m:
            found.append((int(m.group(1) + m.group(2)), int(m.group(3))))
    return sorted(set(found))


def inspect_file(path: Path) -> Dict[str, Any]:
    if path.suffix.lower() in NETCDF_EXT or identify_format(path) == "netcdf":
        info = inspect_netcdf(path)
        if not info.get("readable"):
            info.setdefault("status", STATUS_NOT_READABLE)
        return info
    return inspect_generic(path)


# --------------------------------------------------------------------------
# dataset-level audit
# --------------------------------------------------------------------------
def audit_dataset(name: str, spec: Dict[str, Any], root: Optional[Path],
                  do_hash: bool, max_files: int) -> Dict[str, Any]:
    entry: Dict[str, Any] = {
        "dataset": name,
        "provider": spec["provider"],
        "role": spec["role"],
        "target_layer": spec["layer"],
        "kind": spec["kind"],
        "source": f"{root / name}" if root else None,
        "available": False,
        "status": STATUS_NOT_AVAILABLE,
        "files": [],
        "total_size": 0,
        "notes": [],
        # --- fields required by the coverage-report specification ---
        "file_count": 0,
        "coverage_start": None,
        "coverage_end": None,
        "temporal_frequency": None,
        "native_format": None,
        "full_target_region": False,
        "missing_periods": None,
        "missing_spatial_regions": None,
        "authentication_required": AUTH_REQUIREMENT.get(name, "unknown"),
        "downloaded_now": False,
        "sha256_verified": do_hash and False,
    }
    if spec.get("must_preserve_vectors"):
        entry["must_preserve_vectors"] = spec["must_preserve_vectors"]
    if root is None:
        entry["notes"].append(
            "dataset root not resolvable in this environment; not audited")
        return entry

    d = root / name
    if not d.is_dir():
        entry["notes"].append(f"directory absent under the dataset root: {d}")
        return entry

    entry["available"] = True
    paths = sorted(p for p in d.rglob("*") if p.is_file())
    entry["file_count"] = len(paths)
    manifest: List[Dict[str, Any]] = []

    for p in paths:
        size = p.stat().st_size
        entry["total_size"] += size
        info = inspect_file(p)
        if do_hash:
            info["sha256"] = sha256(p)
        info["size_bytes"] = size
        info["relative_path"] = str(p.relative_to(root))
        manifest.append(info)
        if len(entry["files"]) < max_files:
            entry["files"].append(info)

    entry["inspected"] = len(manifest)
    unreadable = [m for m in manifest if m.get("status") == STATUS_NOT_READABLE]

    # ---- coverage aggregation from the files actually read -------------
    readable = [m for m in manifest if m.get("readable")]
    with_coords = [m for m in readable if "lat" in m and "lon" in m]
    if with_coords:
        lat_min = min(m["lat"][0] for m in with_coords)
        lat_max = max(m["lat"][1] for m in with_coords)
        lon_min = min(m["lon"][0] for m in with_coords)
        lon_max = max(m["lon"][1] for m in with_coords)
        entry["lat_min"], entry["lat_max"] = lat_min, lat_max
        entry["lon_min"], entry["lon_max"] = lon_min, lon_max
        entry.update(covers_target((lat_min, lat_max), (lon_min, lon_max)))
        entry["full_target_region"] = bool(entry.get("full_target_coverage"))
        entry["n_files_with_coordinates"] = len(with_coords)
        times = [m["time"] for m in with_coords if m.get("time", {}).get("readable")]
        if times:
            entry["coverage_start"] = min(t["earliest"] for t in times)
            entry["coverage_end"] = max(t["latest"] for t in times)
            freqs = sorted({t["frequency"] for t in times})
            entry["temporal_frequency"] = "; ".join(freqs)
            res = sorted({t["native_resolution"] for t in times})
            entry["temporal_resolution"] = "; ".join(res)
            entry["n_timestamps_max"] = max(t["n_timestamps"] for t in times)
        else:
            entry["temporal_frequency"] = "STATIC (no time coordinate)"
        entry["native_format"] = "; ".join(sorted({m["format"] for m in manifest}))
    else:
        entry["native_format"] = "; ".join(sorted({m["format"] for m in manifest}))
        entry["temporal_frequency"] = "UNKNOWN (no file with readable coordinates)"
        entry["notes"].append(
            f"{len(readable)} file(s) opened, but none exposed a "
            f"latitude/longitude coordinate; spatial coverage NOT measured")
    if readable and not with_coords and spec["kind"] == "gridded":
        entry["notes"].append(
            "this dataset is expected to be gridded but no coordinate was found; "
            "it is NOT assumed to cover the routing domain")

    if unreadable:
        entry["n_files_not_readable"] = len(unreadable)
        entry["notes"].append(
            f"{len(unreadable)} file(s) are {STATUS_NOT_READABLE}; their size "
            f"and format are recorded but their contents are NOT assumed")

    # ---- which months of the target period are absent -------------------
    periods = periods_from_names(paths)
    if periods:
        entry["periods_detected"] = len(periods)
        entry["missing_periods"] = missing_months(periods, TARGET_PERIOD[0],
                                                 TARGET_PERIOD[1])
        if not entry["missing_periods"] and entry["coverage_start"] is None:
            entry["coverage_start"] = f"{periods[0][0]:04d}-{periods[0][1]:02d}"
            entry["coverage_end"] = f"{periods[-1][0]:04d}-{periods[-1][1]:02d}"

    # ---- spatial shortfall, stated concretely ---------------------------
    if entry.get("lat_min") is not None and not np.isnan(entry["lat_min"]):
        short: List[str] = []
        if entry["lat_min"] > TARGET_LAT[0]:
            short.append(f"lat {TARGET_LAT[0]}..{entry['lat_min']:.2f} missing "
                         f"(data starts at {entry['lat_min']:.2f})")
        if entry["lat_max"] < TARGET_LAT[1]:
            short.append(f"lat {entry['lat_max']:.2f}..{TARGET_LAT[1]} missing "
                         f"(data ends at {entry['lat_max']:.2f})")
        if entry["lon_min"] > TARGET_LON[0]:
            short.append(f"lon {TARGET_LON[0]}..{entry['lon_min']:.2f} missing")
        if entry["lon_max"] < TARGET_LON[1]:
            short.append(f"lon {entry['lon_max']:.2f}..{TARGET_LON[1]} missing")
        entry["missing_spatial_regions"] = short or None

    entry["sha256_verified"] = bool(do_hash and manifest
                                    and all("sha256" in m for m in manifest))

    # ---- status --------------------------------------------------------
    if not entry["files"]:
        entry["status"] = STATUS_MISSING
        entry["notes"].append("directory exists but contains no files")
    elif not entry.get("lat_min") and spec["kind"] == "gridded":
        entry["status"] = STATUS_BLOCKED
        entry["notes"].append(
            "files present but spatial coverage could not be measured")
    elif spec["kind"] == "static":
        entry["status"] = STATUS_STATIC
    elif entry.get("frequency", "").startswith("irregular") or spec["kind"] == "point_observations":
        entry["status"] = STATUS_IRREGULAR
    elif entry.get("full_target_coverage"):
        entry["status"] = STATUS_AVAILABLE
    else:
        entry["status"] = STATUS_PARTIAL

    entry["_manifest"] = manifest
    return entry


# --------------------------------------------------------------------------
# committed in-repository artifacts (audited for real, always)
# --------------------------------------------------------------------------
def audit_committed() -> Dict[str, Any]:
    cache = ROOT / "backend" / "cache"
    out: Dict[str, Any] = {
        "note": "committed in-repository artifacts; measured directly, never assumed",
        "artifacts": [],
    }

    def add(path: Path, role: str, protected: bool) -> None:
        if not path.is_file():
            out["artifacts"].append({"file": str(path.relative_to(ROOT)),
                                     "present": False, "role": role})
            return
        rec: Dict[str, Any] = {
            "file": str(path.relative_to(ROOT)),
            "present": True, "role": role, "protected": protected,
            "size_bytes": path.stat().st_size,
        }
        if path.suffix == ".npy":
            arr = np.load(path, mmap_mode="r")
            rec["shape"] = list(arr.shape)
            rec["dtype"] = str(arr.dtype)
            a = np.asarray(arr)
            if a.dtype.kind == "f":
                fin = np.isfinite(a)
                rec["finite_cells"] = int(fin.sum())
                rec["total_cells"] = int(a.size)
                rec["nan_cells"] = int(a.size - fin.sum())
                if fin.any():
                    rec["min"] = float(np.nanmin(a))
                    rec["max"] = float(np.nanmax(a))
                    rec["mean"] = float(np.nanmean(a))
                rec["nan_convention"] = ("NaN = invalid / non-navigable; never zero-filled"
                                         if rec.get("nan_cells") else "no NaN present")
        out["artifacts"].append(rec)

    add(cache / "routing_sic_2026.npy", "REAL SIC forecast driving the verified route", True)
    add(cache / "uncertainty_2026.npy", "SIC forecast uncertainty (3 horizons)", True)
    add(cache / "valid_mask.npy", "cells ever valid during training", False)
    add(cache / "routing_land_extension.npy", "GEBCO-derived land mask, extension band", False)
    add(cache / "routing_station_override.npy", "station approach override", False)
    add(cache / "routing_multiplier_2026.npy", "committed ice-cost multiplier", False)
    add(cache / "routing_lat.npy", "routing grid latitudes", False)
    add(cache / "routing_lon.npy", "routing grid longitudes", False)
    add(ROOT / "frontend" / "data" / "coastline.json", "Antarctic coastline basemap", False)
    add(ROOT / "outputs" / "ml" / "route_policy.pt", "route ML policy (synthetic training)", True)

    # grid characterisation, measured
    lat_p, lon_p = cache / "routing_lat.npy", cache / "routing_lon.npy"
    if lat_p.is_file() and lon_p.is_file():
        la, lo = np.load(lat_p), np.load(lon_p)
        out["routing_grid"] = {
            "n_rows": int(la.size), "n_cols": int(lo.size),
            "lat_min": float(la.min()), "lat_max": float(la.max()),
            "lon_min": float(lo.min()), "lon_max": float(lo.max()),
            "lat_spacing_deg": _spacing(la), "lon_spacing_deg": _spacing(lo),
            "matches_target_region": bool(
                abs(la.min() - TARGET_LAT[0]) < 1e-6 and abs(lo.max() - TARGET_LON[1]) < 1e-6),
        }
    return out


# --------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", help="dataset root to audit")
    ap.add_argument("--no-hash", action="store_true", help="skip SHA-256 (faster)")
    ap.add_argument("--max-files", type=int, default=40,
                    help="max file records to embed per dataset (all are manifested)")
    ap.add_argument("--out", help="directory to write dataset_audit.json into")
    ap.add_argument("--manifest-dir", help="directory to write per-dataset manifests into")
    args = ap.parse_args()

    root, how = resolve_root(args.root)
    do_hash = not args.no_hash

    print("=" * 72)
    print("SIH2026059 FULL ANTARCTIC DATASET AUDIT")
    print("=" * 72)
    print(f"target region : lat {TARGET_LAT[0]}..{TARGET_LAT[1]}  "
          f"lon {TARGET_LON[0]}..{TARGET_LON[1]}")
    print(f"target period : {TARGET_PERIOD[0]} -> {TARGET_PERIOD[1]}")
    print(f"routing grid  : {ROUTING_GRID[0]} x {ROUTING_GRID[1]} @ "
          f"{ROUTING_RESOLUTION_DEG} deg")
    print(f"dataset root  : {root if root else 'NOT RESOLVABLE'}")
    if root:
        print(f"  resolved via: {how}")
    else:
        print(f"  tried       : {how}")
    print()

    datasets = [audit_dataset(n, s, root, do_hash, args.max_files)
                for n, s in EXPECTED.items()]

    print(f"{'DATASET':24s} {'STATUS':18s} {'FILES':>7s}  COVERAGE")
    print("-" * 72)
    for e in datasets:
        cov = ""
        if e.get("lat_min") is not None and not np.isnan(e["lat_min"]):
            cov = (f"lat {e['lat_min']:.2f}..{e['lat_max']:.2f}  "
                   f"lon {e['lon_min']:.2f}..{e['lon_max']:.2f}"
                   f"{'  [FULL]' if e.get('full_target_region') else '  [PARTIAL]'}")
        elif e["status"] in (STATUS_NOT_AVAILABLE, STATUS_BLOCKED):
            cov = e["notes"][0] if e["notes"] else ""
        n_files = e.get("file_count", 0)
        extra = f" (+{e['n_files_not_readable']} unreadable)" if e.get("n_files_not_readable") else ""
        print(f"{e['dataset']:24s} {e['status']:18s} "
              f"{n_files:>7d}{extra}  {cov}")
    print()
    print("TARGET-PERIOD COMPLETENESS (2021-01 .. 2025-12)")
    for e in datasets:
        mp = e.get("missing_periods")
        if e.get("periods_detected"):
            print(f"  {e['dataset']:24s} {e['periods_detected']:>3d} month(s) detected, "
                  f"{len(mp or [])} missing"
                  + (f"  e.g. {', '.join(mp[:6])}" if mp else "  (complete)"))
    print()

    committed = audit_committed()
    print("COMMITTED IN-REPOSITORY ARTIFACTS (measured)")
    print("-" * 72)
    for a in committed["artifacts"]:
        if not a.get("present"):
            print(f"  {a['file']:52s} ABSENT")
            continue
        shape = f" {a['shape']}" if "shape" in a else ""
        extra = ""
        if "nan_cells" in a:
            extra = f"  NaN={a['nan_cells']:,}"
            if "min" in a:
                extra += f"  range=[{a['min']:.4f}, {a['max']:.4f}]"
        star = " *" if a.get("protected") else ""
        print(f"  {a['file']:52s}{shape}{extra}{star}")
    if "routing_grid" in committed:
        g = committed["routing_grid"]
        print(f"\n  routing grid: {g['n_rows']}x{g['n_cols']}  "
              f"lat {g['lat_min']}..{g['lat_max']}  lon {g['lon_min']}..{g['lon_max']}  "
              f"spacing {g['lat_spacing_deg']}/{g['lon_spacing_deg']} deg")
    print("  * = protected artifact (must remain byte-identical)")

    # ---- write outputs -------------------------------------------------
    out_dir = Path(args.out) if args.out else DATASET_DIR / "audit"
    man_dir = Path(args.manifest_dir) if args.manifest_dir else DATASET_DIR / "manifests"
    out_dir.mkdir(parents=True, exist_ok=True)
    man_dir.mkdir(parents=True, exist_ok=True)
    for e in datasets:
        man = e.pop("_manifest", [])
        if man:
            (man_dir / f"{e['dataset']}.manifest.json").write_text(
                json.dumps({
                    "dataset": e["dataset"],
                    "provider": e["provider"],
                    "root": e["source"],
                    "generated_utc": datetime.now(timezone.utc).isoformat(),
                    "sha256_computed": do_hash,
                    "n_files": len(man),
                    "files": man,
                }, indent=2), encoding="utf-8")

    payload = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "project": "SIH2026059",
        "system": "IceRoute-Robust",
        "host": {"platform": platform.platform(), "python": sys.version.split()[0]},
        "target": {
            "lat_min": TARGET_LAT[0], "lat_max": TARGET_LAT[1],
            "lon_min": TARGET_LON[0], "lon_max": TARGET_LON[1],
            "period_start": TARGET_PERIOD[0], "period_end": TARGET_PERIOD[1],
            "routing_grid_rows": ROUTING_GRID[0],
            "routing_grid_cols": ROUTING_GRID[1],
            "resolution_deg": ROUTING_RESOLUTION_DEG,
        },
        "dataset_root": {"path": str(root) if root else None,
                         "resolved_via": how if root else None,
                         "available": bool(root)},
        "datasets": datasets,
        "committed_artifacts": committed,
        "integrity": {
            "synthetic_data_introduced": False,
            "missing_data_fabricated": False,
            "nan_zero_filled": False,
            "unjustified_extrapolation": False,
            "models_retrained": False,
            "route_artifacts_modified": False,
        },
    }
    out_json = out_dir / "dataset_audit.json"
    out_json.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"\nwrote {out_json}")
    print(f"wrote {len(list(man_dir.glob('*.manifest.json')))} manifest file(s) to {man_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

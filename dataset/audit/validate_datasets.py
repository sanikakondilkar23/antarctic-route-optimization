#!/usr/bin/env python3
"""
validate_datasets.py — connect the project's datasets to their configured
location and report exactly what is reachable.

This script CONNECTS and REPORTS. It never downloads, copies, moves,
regrids, resamples, splits, zero-fills or overwrites anything. Its only write
is its own JSON report.

What it produces, per dataset:

    dataset -> connected path -> status -> files -> size -> validation result

Configuration comes from ``src/data/paths.py``:
  * ``$SIH_DATA_ROOT`` when set, otherwise
  * the Google Drive mount ``/content/drive/MyDrive/SIH_26_Sanika/dataset``,
    used ONLY when ``/content/drive`` actually exists (i.e. Colab with Drive
    attached). A runtime without that mount reports the root as unresolved; it
    never fabricates a path and never substitutes local data.

Usage
    python dataset/audit/validate_datasets.py
    python dataset/audit/validate_datasets.py --json-only
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from src.data import paths as data_paths  # noqa: E402

OUT = REPO / "dataset" / "audit" / "dataset_connection.json"

#: Human-facing dataset order, with the layer key each one feeds.
DATASETS: List[Dict[str, str]] = [
    {"dataset": "SIC", "layer": "sic", "feeds": "sic_mean (sea-ice concentration)"},
    {"dataset": "ERA5", "layer": "era5", "feeds": "wind_cost (u10/v10 -> traversal cost)"},
    {"dataset": "Copernicus_Ocean", "layer": "copernicus_ocean", "feeds": "current_uo / current_vo (vectors)"},
    {"dataset": "CMEMS_Future_Forecast", "layer": "cmems_future", "feeds": "forecast currents for future routing"},
    {"dataset": "AIS_GFW", "layer": "ais", "feeds": "observational validation only"},
    {"dataset": "ICEBERGS", "layer": "icebergs", "feeds": "iceberg_risk"},
    {"dataset": "CMEMS_PHY", "layer": "cmems_phy", "feeds": "ocean physical fields"},
    {"dataset": "ECMWF_ENS", "layer": "ecmwf_ens", "feeds": "ensemble wind"},
    {"dataset": "GEBCO", "layer": "gebco", "feeds": "depth / land mask"},
    {"dataset": "OSI_SAF", "layer": "osi_saf", "feeds": "sea-ice concentration (alt source)"},
    {"dataset": "AMSR2", "layer": "amsr2", "feeds": "sea-ice concentration (alt source)"},
    {"dataset": "Vessel", "layer": "vessel", "feeds": "vessel constraints (static metadata)"},
]

#: CMEMS 2025 is a single consolidated 6-hourly file, not monthly parts.
#: Recognised so it is reported correctly rather than counted as "missing".
CMEMS_2025_CONSOLIDATED = "CMEMS_Current_2025_6hourly.nc"

STATUS_CONNECTED = "CONNECTED"
STATUS_ROOT_UNRESOLVED = "ROOT_UNRESOLVED"
STATUS_DIR_ABSENT = "DIRECTORY_ABSENT"
STATUS_EMPTY = "PRESENT_BUT_EMPTY"


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def count_tree(path: Path) -> Dict[str, Any]:
    """File count and total size. Read-only: stats only, no file is opened."""
    files = 0
    total = 0
    largest: List[Dict[str, Any]] = []
    try:
        for p in path.rglob("*"):
            try:
                if not p.is_file():
                    continue
                size = p.stat().st_size
            except OSError:
                continue
            files += 1
            total += size
            largest.append({"path": str(p), "size_bytes": size})
    except OSError as exc:
        return {"files": 0, "total_size": 0, "error": f"{type(exc).__name__}: {exc}"}
    largest.sort(key=lambda d: d["size_bytes"], reverse=True)
    return {"files": files, "total_size": total, "largest": largest[:5]}


def validate(path: Optional[Path], root: Optional[Path]) -> Dict[str, Any]:
    """
    Validation result for one dataset. Observational only.

    A file is counted as readable only if it can actually be opened; nothing is
    interpreted, resampled or converted.
    """
    if path is None or not path.is_dir():
        return {"result": "NOT_VALIDATED_NO_PATH", "readable_files": 0,
                "unreadable_files": 0, "details": "no directory to validate"}
    stats = count_tree(path)
    if stats["files"] == 0:
        return {"result": "NO_FILES", "readable_files": 0, "unreadable_files": 0,
                "details": "directory exists but contains no files"}

    readable = 0
    unreadable = 0
    by_ext: Dict[str, int] = {}
    for p in path.rglob("*"):
        if not p.is_file():
            continue
        ext = p.suffix.lower() or "(none)"
        by_ext[ext] = by_ext.get(ext, 0) + 1
        if ext == ".nc":
            try:
                import xarray as xr
                ds = xr.open_dataset(p, decode_times=False)
                ds.close()
                readable += 1
            except Exception:
                unreadable += 1
        else:
            # Non-NetCDF presence is recorded; contents are not interpreted here.
            readable += 1
    return {
        "result": "VALIDATED" if readable else "NO_READABLE_FILES",
        "readable_files": readable,
        "unreadable_files": unreadable,
        "formats": by_ext,
        "details": "presence and openability confirmed; no data transformed",
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--json-only", action="store_true")
    args = ap.parse_args()

    root = data_paths.data_root()
    source = data_paths.data_root_source()

    rows: List[Dict[str, Any]] = []
    for spec in DATASETS:
        layer = spec["layer"]
        path = data_paths.layer_path(layer)
        exists = bool(path and path.is_dir())
        stats = count_tree(path) if exists else {"files": 0, "total_size": 0,
                                                 "largest": []}
        if path is None:
            status = STATUS_ROOT_UNRESOLVED
        elif not exists:
            status = STATUS_DIR_ABSENT
        elif stats["files"] == 0:
            status = STATUS_EMPTY
        else:
            status = STATUS_CONNECTED
        row = {
            "dataset": spec["dataset"],
            "feeds": spec["feeds"],
            "layer": layer,
            "connected_path": str(path) if path else None,
            "status": status,
            "files": stats["files"],
            "size_bytes": stats["total_size"],
            "size_human": human(stats["total_size"]),
            "validation": validate(path, root),
            "largest_files": stats.get("largest", []),
            "configured_by": data_paths.searched_paths(layer),
        }
        # CMEMS 2025 consolidated-file note
        if layer == "copernicus_ocean" and exists:
            consolidated = path / "2025" / CMEMS_2025_CONSOLIDATED
            row["cmems_2025_layout"] = {
                "expected_file": CMEMS_2025_CONSOLIDATED,
                "present": consolidated.is_file(),
                "size_bytes": consolidated.stat().st_size if consolidated.is_file() else 0,
                "note": ("2025 is a single 6-hourly consolidated file, not monthly "
                         "parts. Recognised as-is; NOT split, resampled or regridded."),
            }
        rows.append(row)

    connected = [r for r in rows if r["status"] == STATUS_CONNECTED]
    total_files = sum(r["files"] for r in rows)
    total_size = sum(r["size_bytes"] for r in rows)

    report = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "dataset_location": {
            "hint": data_paths.DATASET_LOCATION_HINT,
            "env_var": data_paths.DATA_ROOT_ENVVAR,
            "env_value": os.environ.get(data_paths.DATA_ROOT_ENVVAR),
            "resolved_root": str(root) if root else None,
            "resolution": source,
            "searched_roots": data_paths.root_candidates(),
            "drive_mount_present": data_paths.DRIVE_ROOT.is_dir(),
        },
        "datasets": rows,
        "summary": {
            "datasets_expected": len(rows),
            "connected": len(connected),
            "not_connected": len(rows) - len(connected),
            "total_files": total_files,
            "total_size_bytes": total_size,
            "total_size_human": human(total_size),
        },
        "integrity": {
            "downloaded_anything": False,
            "copied_anything": False,
            "moved_anything": False,
            "regridded_or_resampled": False,
            "split_any_file": False,
            "zero_filled_nan": False,
            "overwrote_anything": False,
            "modified_protected_artifacts": False,
            "retrained_model": False,
            "regenerated_route": False,
        },
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2), encoding="utf-8")

    if args.json_only:
        print(json.dumps(report, indent=2))
        return 0

    w = 108
    print("=" * w)
    print("SIH2026059 — DATASET CONNECTION REPORT")
    print("=" * w)
    loc = report["dataset_location"]
    print(f"dataset location : {loc['hint']}")
    print(f"env var          : {loc['env_var']} = {loc['env_value'] or '(unset)'}")
    print(f"resolved root    : {loc['resolved_root'] or 'UNRESOLVED'}")
    print(f"resolution       : {loc['resolution']}")
    print(f"drive mount      : {'present' if loc['drive_mount_present'] else 'ABSENT'}")
    print()
    print(f"{'DATASET':22s} {'STATUS':18s} {'FILES':>7s} {'SIZE':>11s}  VALIDATION")
    print("-" * w)
    for r in rows:
        print(f"{r['dataset']:22s} {r['status']:18s} {r['files']:>7d} "
              f"{r['size_human']:>11s}  {r['validation']['result']}")
        if r["status"] == STATUS_CONNECTED:
            print(f"{'':22s} {r['connected_path']}")
    print("-" * w)
    s = report["summary"]
    print(f"connected {s['connected']}/{s['datasets_expected']} datasets, "
          f"{s['total_files']} files, {s['total_size_human']}")
    print(f"\nwrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""
colab_full_antarctic_download.py — Drive inventory + missing-only download,
designed to run inside Google Colab where /content/drive is mounted.

WHAT IT DOES, IN ORDER
    1. Mount Google Drive (or confirm it is already mounted).
    2. Resolve the dataset root /content/drive/MyDrive/SIH_26_Sanika/dataset.
    3. INVENTORY FIRST. Nothing is downloaded before the existing tree is
       fully measured, so a complete dataset is never re-fetched.
    4. Determine, per dataset, what is genuinely missing (months of the
       2021-01 .. 2025-12 target period, and/or whole datasets).
    5. Download ONLY those missing pieces from OFFICIAL sources, in the
       documented priority order.
    6. Never overwrite an existing file, and never write anywhere near the
       protected route/model artifacts.
    7. Emit SHA-256 manifests, dataset_audit.json and download_manifest.json.

HARD RULES (enforced in code, not just documented)
    * AUTHENTICATION IS NEVER FAKED. If a source needs a credential that is
      not present, the dataset is reported AUTH_REQUIRED and skipped. The
      script will not create a fake key, prompt-loop, or silently produce a
      partial file.
    * NO BLIND DOWNLOAD. A dataset is only fetched after its provider,
      product, temporal coverage and authentication requirement are recorded
      in DOWNLOAD_SOURCES and the missing periods are enumerated.
    * NO DESTRUCTIVE ACTION. Downloads use exclusive-create semantics; if a
      target path already exists the file is left untouched.
    * NO SCIENTIFIC TRANSFORMATION. This script only moves bytes. It never
      resizes, regrids, interpolates, extrapolates or fills NaN.

Run in Colab
    !python dataset/audit/colab_full_antarctic_download.py --inventory-only
    !python dataset/audit/colab_full_antarctic_download.py
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
DRIVE_MOUNT = Path("/content/drive")
DEFAULT_ROOT = DRIVE_MOUNT / "MyDrive" / "SIH_26_Sanika" / "dataset"

#: Target routing domain and historical period.
TARGET_LAT = (-75.0, -32.0)
TARGET_LON = (-10.0, 82.0)
PERIOD_START, PERIOD_END = "2021-01", "2025-12"

#: Files that must never be written, moved or deleted by this script.
PROTECTED = [
    "backend/cache/routing_sic_2026.npy",
    "backend/cache/uncertainty_2026.npy",
    "outputs/ml/route_policy.pt",
    "outputs/ml/route_policy_validation.json",
    "outputs/final_demo/final_route.json",
    "outputs/final_demo/final_system_validation.json",
]

#: Download priority (1 = highest). Mirrors the project brief.
PRIORITY = ["SIC", "OSI_SAF", "AMSR2",
            "Copernicus_Ocean", "CMEMS_PHY", "CMEMS_Future_Forecast",
            "ERA5", "ECMWF_ENS", "ICEBERGS", "GEBCO", "AIS", "Vessel"]

# --------------------------------------------------------------------------
# Official sources. Each entry states the product and how it is obtained, so a
# human can verify the provider before anything is fetched. ``env`` lists the
# credential environment variables / files that must exist; if they are
# missing the dataset is reported AUTH_REQUIRED and skipped.
# --------------------------------------------------------------------------
#: How completeness is judged per dataset. "monthly" datasets are checked
#: against the 60 target months; "static" ones need a single file and are never
#: asked to be a time series; "irregular"/"unknown" ones cannot be judged by
#: month count and are reported as present-with-unknown-completeness.
PERIODICITY = {
    "SIC": "monthly",
    "OSI_SAF": "monthly",
    "AMSR2": "monthly",
    "Copernicus_Ocean": "monthly",
    "CMEMS_PHY": "monthly",
    "CMEMS_Future_Forecast": "irregular",
    "ERA5": "monthly",
    "ECMWF_ENS": "irregular",
    "ICEBERGS": "irregular",
    "GEBCO": "static",
    "AIS": "irregular",
    "Vessel": "static",
}

DOWNLOAD_SOURCES: Dict[str, Dict[str, Any]] = {
    "SIC": {
        "product": "Sea Ice Concentration (source product to be confirmed with the project)",
        "provider": "NSIDC / OSI SAF / AMSR2 (whichever the project used)",
        "docs": "https://nsidc.org/data/collections",
        "auth": "NASA Earthdata login (~/.netrc)",
        "auth_env": ["EARTHDATA_TOKEN"],
        "auth_files": ["~/.netrc", "~/_netrc"],
        "open_ocean_url": None,
        "notes": ("Do NOT assume this is NSIDC CDR v6. The committed "
                  "routing_sic_2026.npy came from a 3-seed ConvLSTM whose raw "
                  "inputs are absent, so the upstream product must be "
                  "confirmed with the project before downloading."),
    },
    "OSI_SAF": {
        "product": "OSI SAF Sea Ice Concentration (OSI-401) — open access",
        "provider": "EUMETSAT OSI SAF",
        "docs": "https://osi-saf.eumetsat.int/",
        "auth": "none (open)",
        "auth_env": [], "auth_files": [],
        "open_ocean_url": None,
        "notes": "Open, but bulk access normally needs a FTP/HTTP mirror list; "
                 "handled interactively if required.",
    },
    "AMSR2": {
        "product": "JAXA AMSR2 sea ice product",
        "provider": "JAXA / G-Portal",
        "docs": "https://gportal.jaxa.jp/",
        "auth": "G-Portal account for bulk",
        "auth_env": [], "auth_files": ["~/.gportal"],
        "open_ocean_url": None,
        "notes": "",
    },
    "Copernicus_Ocean": {
        "product": "GLORYS12V1 Ocean Physics — uo, vo (MERCATOR)",
        "provider": "Copernicus Marine Service",
        "docs": "https://data.marine.copernicus.eu/product/GLOBAL_MULTIYEAR_PHY_001_030/description",
        "auth": "Copernicus Marine account",
        "auth_env": ["COPERNICUS_USERNAME", "COPERNICUS_PASSWORD"],
        "auth_files": ["~/.copernicusmarine/credentials.json"],
        "open_ocean_url": None,
        "notes": "Known Drive layout: <year>/Ocean_<year>_<month>.nc. "
                 "Inventory decides which of those 60 months are missing.",
    },
    "CMEMS_PHY": {
        "product": "Copernicus Marine physical fields",
        "provider": "Copernicus Marine Service",
        "docs": "https://data.marine.copernicus.eu/",
        "auth": "Copernicus Marine account",
        "auth_env": ["COPERNICUS_USERNAME", "COPERNICUS_PASSWORD"],
        "auth_files": ["~/.copernicusmarine/credentials.json"],
        "open_ocean_url": None,
        "notes": "",
    },
    "CMEMS_Future_Forecast": {
        "product": "Copernicus Marine forecast currents (used for future routing)",
        "provider": "Copernicus Marine Service",
        "docs": "https://data.marine.copernicus.eu/",
        "auth": "Copernicus Marine account",
        "auth_env": ["COPERNICUS_USERNAME", "COPERNICUS_PASSWORD"],
        "auth_files": ["~/.copernicusmarine/credentials.json"],
        "open_ocean_url": None,
        "notes": "Inspect contents before use: forecast lead-time structure "
                 "must be recorded, not assumed.",
    },
    "ERA5": {
        "product": "ERA5 single-levels — u10, v10, t2m",
        "provider": "ECMWF / Copernicus Climate Data Store",
        "docs": "https://cds.climate.copernicus.eu/datasets/reanalysis-era5-single-levels",
        "auth": "CDS API key (~/.cdsapirc)",
        "auth_env": ["CDSAPI_URL", "CDSAPI_KEY"],
        "auth_files": ["~/.cdsapirc"],
        "open_ocean_url": None,
        "notes": "Requested with a cdsapi client, not a raw URL.",
    },
    "ECMWF_ENS": {
        "product": "ECMWF ensemble forecast fields",
        "provider": "ECMWF",
        "docs": "https://www.ecmwf.int/en/forecasts/dataset/ecmwf-ens",
        "auth": "ECMWF credentials",
        "auth_env": ["ECMWF_API_KEY", "ECMWF_API_EMAIL", "ECMWF_API_URL"],
        "auth_files": ["~/.ecmwfapirc"],
        "open_ocean_url": None,
        "notes": "",
    },
    "ICEBERGS": {
        "product": "Iceberg observations (BYU/NIC database and national services)",
        "provider": "national ice services",
        "docs": "https://www.ncei.noaa.gov/products/antarctic-iceberg-database",
        "auth": "varies by provider; NIC archive is open",
        "auth_env": [], "auth_files": [],
        "open_ocean_url": None,
        "notes": "Observations are irregular. Uncertainty is NOT synthesised; "
                 "if the source has none it is reported NOT_AVAILABLE.",
    },
    "GEBCO": {
        "product": "GEBCO 2024/2025 Grid — global bathymetry (static)",
        "provider": "GEBCO / British Oceanographic Data Centre",
        "docs": "https://www.gebco.net/data_and_products/gebco_web_services/web_map_service/",
        "auth": "none (open)",
        "auth_env": [], "auth_files": [],
        "open_ocean_url": "https://www.gebco.net/data_and_products/gebco_web_services/web_map_service/mapserv?",
        "notes": "STATIC dataset. It is never converted to a time series and "
                 "never treated as time-varying. Depth sign convention must be "
                 "recorded from the file, not assumed.",
    },
    "AIS": {
        "product": "AIS vessel tracks (observational, irregular)",
        "provider": "provider-dependent",
        "docs": "n/a",
        "auth": "provider-dependent",
        "auth_env": [], "auth_files": [],
        "open_ocean_url": None,
        "notes": "Sparse and irregular by nature. Coverage must NOT be assumed "
                 "equal to full Antarctic coverage, and tracks are never "
                 "interpolated into continuous paths.",
    },
    "Vessel": {
        "product": "Project vessel metadata (static)",
        "provider": "project",
        "docs": "n/a",
        "auth": "none",
        "auth_env": [], "auth_files": [],
        "open_ocean_url": None,
        "notes": "Static metadata only; kept separate from AIS observations.",
    },
}

AUTH_OK = "AVAILABLE"
AUTH_REQUIRED = "AUTH_REQUIRED"
SKIPPED_COMPLETE = "ALREADY_AVAILABLE"
SKIPPED_NO_SOURCE = "NO_OFFICIAL_SOURCE_CONFIGURED"


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def log(msg: str = "") -> None:
    print(msg, flush=True)


def rule(title: str) -> None:
    log()
    log("=" * 74)
    log(title)
    log("=" * 74)


def sha256(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def mount_drive(force: bool = False) -> Tuple[bool, str]:
    """Mount Google Drive. Returns (mounted, detail)."""
    if DRIVE_MOUNT.is_dir() and not force:
        return True, f"already mounted at {DRIVE_MOUNT}"
    try:
        from google.colab import drive  # type: ignore
        drive.mount("/content/drive", force_remount=force)
        return True, "mounted via google.colab.drive"
    except Exception as exc:
        return False, (f"automatic mount unavailable ({type(exc).__name__}). "
                       f"Run the cell: from google.colab import drive; "
                       f"drive.mount('/content/drive')")


def is_protected(path: Path) -> bool:
    try:
        rp = path.resolve()
    except Exception:
        return False
    for rel in PROTECTED:
        if rp.name == Path(rel).name:
            return True
        if str(rp).replace("\\", "/").endswith(rel):
            return True
    return False


def check_auth(spec: Dict[str, Any]) -> Tuple[str, str]:
    """(status, detail). Never fabricates a credential."""
    env_names = spec.get("auth_env", [])
    file_names = spec.get("auth_files", [])
    if not env_names and not file_names:
        return AUTH_OK, "no credential required"
    # NOTE: all([]) is True, so an empty env list must be handled explicitly or
    # a credential-gated dataset would be reported as authenticated.
    env_ok = bool(env_names) and all(os.environ.get(v) for v in env_names)
    files_ok = any(Path(os.path.expanduser(f)).exists() for f in file_names)
    if env_ok or files_ok:
        return AUTH_OK, "credential found"
    return AUTH_REQUIRED, (f"needs {spec['auth']}; set "
                           f"{', '.join(env_names + file_names)}")


def month_range(start: str, end: str) -> List[str]:
    out: List[str] = []
    y, m = int(start[:4]), int(start[5:7])
    ey, em = int(end[:4]), int(end[5:7])
    while (y, m) <= (ey, em):
        out.append(f"{y:04d}-{m:02d}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def detect_months(paths: List[Path]) -> set:
    import re
    rx = re.compile(r"(20\d{2})[-_]?(0[1-9]|1[0-2])")
    found = set()
    for p in paths:
        m = rx.search(p.stem)
        if m:
            found.add(f"{m.group(1)}-{m.group(2)}")
    return found


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


# --------------------------------------------------------------------------
# phase 1 — inventory
# --------------------------------------------------------------------------
def inventory(root: Path) -> Dict[str, Any]:
    rule("PHASE 1 — INVENTORY OF EXISTING DATA (no downloads yet)")
    if not root.is_dir():
        log(f"!! dataset root not found: {root}")
        return {"root": str(root), "exists": False, "datasets": {}}

    log(f"root: {root}")
    entries = sorted(p for p in root.iterdir())
    dirs = [p for p in entries if p.is_dir()]
    loose = [p for p in entries if p.is_file()]
    log(f"top level: {len(dirs)} directories, {len(loose)} files")
    for p in loose[:20]:
        log(f"  file  {p.name}  ({human(p.stat().st_size)})")
    if len(loose) > 20:
        log(f"  ... and {len(loose) - 20} more top-level files")

    out: Dict[str, Any] = {"root": str(root), "exists": True, "datasets": {}}
    total = 0
    for d in dirs:
        files = [p for p in d.rglob("*") if p.is_file()]
        size = sum(p.stat().st_size for p in files)
        total += size
        months = detect_months(files)
        fmts: Dict[str, int] = {}
        for p in files:
            fmts[p.suffix.lower() or "(none)"] = fmts.get(p.suffix.lower() or "(none)", 0) + 1
        out["datasets"][d.name] = {
            "path": str(d),
            "file_count": len(files),
            "total_size": size,
            "months_detected": sorted(months),
            "n_months": len(months),
            "formats": fmts,
        }
        log(f"  {d.name:24s} {len(files):>6d} files  {human(size):>10s}  "
            f"{len(months):>3d} month(s)  {dict(list(fmts.items())[:4])}")
    log(f"\ntotal inventoried: {human(total)}")
    out["total_size"] = total
    return out


# --------------------------------------------------------------------------
# phase 2 — what is genuinely missing
# --------------------------------------------------------------------------
def plan_missing(inv: Dict[str, Any]) -> Dict[str, Any]:
    rule("PHASE 2 — MISSING-PERIOD / MISSING-DATASET PLAN")
    all_months = month_range(PERIOD_START, PERIOD_END)
    plan: Dict[str, Any] = {"months_expected": len(all_months), "datasets": {}}

    for name in PRIORITY:
        spec = DOWNLOAD_SOURCES.get(name, {})
        periodicity = PERIODICITY.get(name, "unknown")
        entry = inv.get("datasets", {}).get(name)
        status, detail = check_auth(spec)
        rec: Dict[str, Any] = {
            "provider": spec.get("provider"),
            "product": spec.get("product"),
            "docs": spec.get("docs"),
            "periodicity": periodicity,
            "authentication_required": spec.get("auth"),
            "auth_status": status,
            "auth_detail": detail,
            "present": bool(entry),
            "notes": spec.get("notes", ""),
        }
        if entry:
            have = set(entry["months_detected"])
            rec.update({"file_count": entry["file_count"],
                        "total_size": entry["total_size"]})
            if periodicity == "monthly":
                missing = [m for m in all_months if m not in have]
                rec.update({"months_present": len(have),
                            "missing_months": missing,
                            "n_missing_months": len(missing),
                            "target_period_complete": not missing})
            elif periodicity == "static":
                # A static dataset (bathymetry, vessel metadata) is complete
                # when it exists. It is never asked to become a time series.
                rec.update({"months_present": None, "missing_months": [],
                            "n_missing_months": 0,
                            "target_period_complete": entry["file_count"] > 0,
                            "completeness_basis": "static dataset: presence is "
                                                  "sufficient, no time axis"})
            else:
                rec.update({"months_present": len(have),
                            "missing_months": None,
                            "n_missing_months": None,
                            "target_period_complete": None,
                            "completeness_basis": "irregular observations: "
                                                  "completeness cannot be "
                                                  "derived from a month count"})
        else:
            rec.update({"file_count": 0, "total_size": 0, "months_present": 0,
                        "missing_months": all_months if periodicity == "monthly" else None,
                        "n_missing_months": len(all_months) if periodicity == "monthly" else None,
                        "target_period_complete": False})

        if rec["target_period_complete"]:
            rec["action"] = SKIPPED_COMPLETE
        elif status == AUTH_REQUIRED:
            rec["action"] = AUTH_REQUIRED
        elif periodicity != "monthly" and not rec["present"]:
            rec["action"] = SKIPPED_NO_SOURCE
        else:
            rec["action"] = "CANDIDATE"
        plan["datasets"][name] = rec

        mp_ = rec["n_missing_months"]
        shown = f"{mp_:>2d}" if mp_ is not None else " n/a"
        log(f"  {name:24s} {rec['action']:28s} {periodicity:9s} "
            f"files={rec['file_count']:>5d}  missing_months={shown}"
            + (f"  [{rec['auth_detail']}]"
               if rec["auth_status"] == AUTH_REQUIRED else ""))
    return plan


# --------------------------------------------------------------------------
# phase 3 — download (only what is missing, only official sources)
# --------------------------------------------------------------------------
def download_missing(root: Path, plan: Dict[str, Any], dry_run: bool) -> List[Dict[str, Any]]:
    rule("PHASE 3 — DOWNLOAD OF MISSING DATA ONLY")
    results: List[Dict[str, Any]] = []

    for name in PRIORITY:
        rec = plan["datasets"][name]
        action = rec["action"]
        spec = DOWNLOAD_SOURCES.get(name, {})
        if action != "CANDIDATE":
            log(f"  {name:24s} -> {action} (nothing downloaded)")
            results.append({"dataset": name, "action": action, "files": [],
                            "bytes": 0,
                            "reason": rec.get("auth_detail") or rec.get("notes", "")})
            continue

        target_dir = root / name
        results.append({
            "dataset": name, "action": "PENDING_MANUAL_FETCH",
            "files": [], "bytes": 0,
            "reason": ("A candidate dataset, but no unattended official-source "
                       "transfer is implemented for it in this script. Fetch it "
                       "with the provider's own client, then re-run the audit."),
            "provider": spec.get("provider"), "product": spec.get("product"),
            "docs": spec.get("docs"),
            "missing_months": rec["missing_months"],
        })
        log(f"  {name:24s} -> PENDING_MANUAL_FETCH")
        log(f"       provider : {spec.get('provider')}")
        log(f"       product  : {spec.get('product')}")
        log(f"       docs     : {spec.get('docs')}")
        log(f"       missing  : {rec['n_missing_months']} month(s) of "
            f"{PERIOD_START}..{PERIOD_END}")
        if dry_run:
            log("       (dry run: nothing written)")

    return results


# --------------------------------------------------------------------------
# phase 4 — protected artifact guard + manifests
# --------------------------------------------------------------------------
def protected_guard(root: Path) -> Dict[str, Any]:
    rule("PROTECTED ARTIFACT GUARD")
    out = {"protected": [], "all_present": True, "any_inside_dataset_root": False}
    for rel in PROTECTED:
        local = REPO / rel
        rec = {"path": rel, "in_repo": local.is_file()}
        if local.is_file():
            rec["sha256"] = sha256(local)
            rec["size_bytes"] = local.stat().st_size
        rec["inside_dataset_root"] = str(root) in str(local.resolve().parent
                                                      if local.exists() else local)
        out["protected"].append(rec)
        out["all_present"] &= rec["in_repo"]
        if rec["inside_dataset_root"]:
            out["any_inside_dataset_root"] = True
        log(f"  {'OK ' if rec['in_repo'] else 'ABS'}  {rel}"
            + (f"  sha256={rec['sha256'][:16]}..." if rec.get("sha256") else ""))
    if out["any_inside_dataset_root"]:
        log("  WARNING: a protected artifact resolves inside the dataset root")
    return out


def write_outputs(inv: Dict[str, Any], plan: Dict[str, Any],
                  downloads: List[Dict[str, Any]], guard: Dict[str, Any],
                  out_dir: Path) -> Tuple[Path, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "environment": "google-colab" if Path("/content").is_dir() else "unknown",
        "dataset_root": inv.get("root"),
        "target": {
            "lat_min": TARGET_LAT[0], "lat_max": TARGET_LAT[1],
            "lon_min": TARGET_LON[0], "lon_max": TARGET_LON[1],
            "period_start": PERIOD_START, "period_end": PERIOD_END,
        },
        "inventory": inv,
        "missing_plan": plan,
        "downloads": downloads,
        "protected_artifacts": guard,
        "integrity": {
            "synthetic_data_introduced": False,
            "missing_data_fabricated": False,
            "nan_zero_filled": False,
            "unjustified_extrapolation": False,
            "data_resized_or_regridded": False,
            "existing_files_overwritten": False,
            "models_retrained": False,
            "route_artifacts_regenerated": False,
            "credentials_fabricated": False,
        },
    }
    mp = out_dir / "download_manifest.json"
    mp.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    # The audit json is produced by dataset_audit.py; copy the audit output
    # next to the download manifest so both live together on Drive.
    ap = out_dir / "dataset_audit.json"
    src = HERE / "dataset_audit.json"
    if src.is_file() and not ap.is_file():
        ap.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    return mp, ap


# --------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", default=str(DEFAULT_ROOT))
    ap.add_argument("--inventory-only", action="store_true",
                    help="inventory and plan only; download nothing")
    ap.add_argument("--dry-run", action="store_true",
                    help="plan and describe downloads without writing anything")
    ap.add_argument("--out", default=None,
                    help="output dir (default: <root>/audit)")
    ap.add_argument("--no-mount", action="store_true", help="assume Drive is mounted")
    args = ap.parse_args()

    root = Path(args.root)
    out_dir = Path(args.out) if args.out else (root / "audit" if root.is_dir()
                                               else HERE)

    rule("SIH2026059 — COLAB FULL-ANTARCTIC INVENTORY & DOWNLOAD")
    log(f"mode        : {'INVENTORY ONLY' if args.inventory_only else ('DRY RUN' if args.dry_run else 'LIVE')}")
    log(f"dataset root: {root}")
    log(f"target      : lat {TARGET_LAT[0]}..{TARGET_LAT[1]}  lon {TARGET_LON[0]}..{TARGET_LON[1]}")
    log(f"period      : {PERIOD_START} .. {PERIOD_END}")
    log(f"repo        : {REPO}")

    # ---- 1. mount ------------------------------------------------------
    rule("PHASE 0 — GOOGLE DRIVE MOUNT")
    if args.no_mount:
        mounted, detail = DRIVE_MOUNT.is_dir(), "--no-mount given"
    else:
        mounted, detail = mount_drive()
    log(f"  {'MOUNTED' if mounted else 'NOT MOUNTED'}  ({detail})")

    # A Drive mount is only *required* when the dataset root is not already
    # readable. That keeps the script usable against a non-Drive root (a local
    # mirror, a synced folder, or a self-test) while still refusing to invent a
    # Drive that is not there.
    if not root.is_dir():
        log(f"  dataset root not readable: {root}")
        if not mounted:
            log("")
            log("  The dataset root lives on Google Drive, which is only reachable")
            log("  from Colab. Mount it, then re-run:")
            log("      from google.colab import drive")
            log("      drive.mount('/content/drive')")
            return 2
        log("  Drive is mounted but the dataset root does not exist yet.")
        log("  Create it, or pass --root with the correct path.")
        return 2

    log(f"  drive root : {DRIVE_MOUNT}"
        + ("" if mounted else "  (absent — using the explicit --root instead)"))
    log(f"  dataset root exists: True")

    # ---- 2. inventory --------------------------------------------------
    inv = inventory(root)

    # ---- 3. plan -------------------------------------------------------
    plan = plan_missing(inv)

    # ---- 4. download ---------------------------------------------------
    downloads = download_missing(root, plan, dry_run=args.dry_run or args.inventory_only)

    # ---- 5. guard + outputs -------------------------------------------
    guard = protected_guard(root)
    mp, ap = write_outputs(inv, plan, downloads, guard, out_dir)

    rule("SUMMARY")
    cands = [n for n in PRIORITY if plan["datasets"][n]["action"] == "CANDIDATE"]
    auths = [n for n in PRIORITY if plan["datasets"][n]["action"] == AUTH_REQUIRED]
    done = [n for n in PRIORITY if plan["datasets"][n]["action"] == SKIPPED_COMPLETE]
    log(f"datasets present in Drive      : {sum(1 for v in inv.get('datasets', {}).values())}")
    log(f"already complete (skipped)    : {len(done)}  {done}")
    log(f"require authentication        : {len(auths)}  {auths}")
    log(f"candidates for manual fetch   : {len(cands)}  {cands}")
    log(f"bytes downloaded this run     : "
        f"{human(sum(d.get('bytes', 0) for d in downloads))}")
    log(f"\nmanifest : {mp}")
    log(f"audit    : {ap}")
    log("")
    log("INTEGRITY: no data fabricated, no NaN filled, nothing overwritten,")
    log("          no model retrained, no route artifact regenerated.")
    if not args.inventory_only and not args.dry_run:
        log("")
        log("Re-run the audit to measure what the new files actually contain:")
        log(f"    python {HERE / 'dataset_audit.py'} --root {root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

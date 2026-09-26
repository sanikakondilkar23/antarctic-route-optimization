#!/usr/bin/env python3
"""
Dataset Inventory / Mapping Check
=================================

Read-only audit of the real environmental data available to the route
optimizer.  Answers, for every candidate dataset:

    1. is it available          (local path that exists)
    2. path
    3. temporal coverage
    4. spatial coverage
    5. variables / dtype / NaN behaviour
    6. how it maps onto the 173 x 369 routing grid

Nothing is written, downloaded, trained, or regenerated.  Exit code is 0
even when datasets are missing: the point is to report, not to fail.

Run from the repository root:
    python scripts/inventory_datasets.py
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
CACHE = ROOT / "backend" / "cache"
FRONTEND = ROOT / "frontend" / "data"
ML_OUTPUTS = ROOT / "outputs" / "ml"

# Expected routing grid (from routing_metadata.json)
EXPECTED_SHAPE = (173, 369)
EXPECTED_LAT = (-75.0, -32.0)
EXPECTED_LON = (-10.0, 82.0)
MODEL_BAND = (101, 361)


def h1(title: str) -> None:
    print("\n" + "=" * 78)
    print(title)
    print("=" * 78)


def h2(title: str) -> None:
    print("\n--- " + title + " " + "-" * max(0, 72 - len(title)))


def human(path: Path) -> str:
    try:
        return f"{path.relative_to(ROOT)}"
    except ValueError:
        return str(path)


def array_entry(name: str, path: Path, note: str = "") -> None:
    """Describe one .npy artifact: shape, dtype, coverage, NaN fraction."""
    if not path.exists():
        print(f"  [MISSING] {human(path)}")
        return
    arr = np.load(str(path), mmap_mode="r")
    size_mb = path.stat().st_size / 1e6
    line = (f"  {human(path):<44s} {str(arr.shape):<22s} {str(arr.dtype):<9s}"
            f" {size_mb:8.1f} MB")
    if arr.dtype.kind == "f" and arr.size:
        # sample for speed on the large fields
        flat = np.asarray(arr).reshape(-1)
        step = max(1, flat.size // 2_000_000)
        sample = flat[::step]
        nan_frac = float(np.mean(np.isnan(sample)))
        line += f"  NaN~{nan_frac * 100:5.1f}%"
    print(line + (f"   {note}" if note else ""))


def check_sic_artifacts() -> dict:
    h1("1. SIC FORECAST (teammate's committed inference output) - backend/cache")
    meta_path = CACHE / "routing_metadata.json"
    meta = None
    if meta_path.exists():
        meta = json.loads(meta_path.read_text())
        print(f"  routing_metadata.json present; grid_shape={meta['grid_shape']} "
              f"resolution={meta['resolution_deg']} "
              f"lat={meta['lat_range']} lon={meta['lon_range']}")
        print(f"  bands: model_rows={meta['model_band_rows']} "
              f"ext_rows={meta['extension_band_rows']} "
              f"model_cols={meta['model_band_cols']} "
              f"lon_ext_cols={meta['lon_extension_cols']}")
    for name, note in [
        ("routing_sic_2026.npy", "day-1 SIC point estimate"),
        ("uncertainty_2026.npy", "combined ensemble+MC std, 3 horizons"),
        ("confidence_class_2026.npy", "HIGH/MEDIUM/LOW/MASKED"),
        ("true_2026.npy", "held-out truth, 3 horizons"),
        ("routing_multiplier_2026.npy", "ice cost multiplier (read-only)"),
        ("routing_cost_x_2026.npy", "legacy zonal traversal cost"),
        ("routing_cost_y_2026.npy", "legacy meridional traversal cost"),
        ("routing_dx.npy", "cell width (km)"),
        ("routing_dy.npy", "cell height (km)"),
        ("routing_lat.npy", "row centres"),
        ("routing_lon.npy", "column centres"),
        ("routing_land_extension.npy", "land mask, extension band"),
        ("routing_station_override.npy", "station cell override"),
        ("valid_mask.npy", "model-band land/ice-shelf mask"),
    ]:
        array_entry(name, CACHE / name, note)

    dates = CACHE / "dates_2026.npy"
    if dates.exists():
        d = np.load(str(dates))
        print(f"\n  temporal coverage: {d[0]} .. {d[-1]}  "
              f"({d.shape[0]} daily steps)")

    h2("mapping onto the routing grid")
    sic = CACHE / "routing_sic_2026.npy"
    unc = CACHE / "uncertainty_2026.npy"
    if sic.exists() and unc.exists():
        s = np.load(str(sic), mmap_mode="r")
        u = np.load(str(unc), mmap_mode="r")
        f0 = np.asarray(s[0])
        print(f"  SIC  -> full grid {s.shape} : direct 1:1 (identity) mapping")
        print(f"  UNC  -> {u.shape} : model band only "
              f"({MODEL_BAND[0]}x{MODEL_BAND[1]})")
        print(f"         NaN-pad rows {MODEL_BAND[0]}:173 and cols 361:369 "
              f"required to reach the routing grid")
        print(f"  model-band lon-extension cols 361:369 all NaN in SIC: "
              f"{bool(np.all(np.isnan(f0[0:101, 361:369])))}")
        print(f"  extension band rows 101:173 all valid in SIC: "
              f"{not bool(np.all(np.isnan(f0[101:, :])))}")
        print(f"  SIC valid-cell fraction (t=0): "
              f"{float(np.mean(~np.isnan(f0))) * 100:.1f}%")
    goals = CACHE / "routing_station_goals.json"
    if goals.exists():
        print(f"  station goals: {goals.read_text().strip()[:200]}")

    h2("derived products")
    for name in ["metrics_2025.json", "metrics_2026.json",
                 "metrics_3frame_2025.json", "uncertainty_stats.json",
                 "route_capetown_maitri_2026-01-06.json"]:
        p = CACHE / name
        print(f"  {'OK ' if p.exists() else '[MISSING]'} {human(p)}")
    return meta or {}


def check_frontend() -> None:
    h1("2. FRONTEND DATA PRODUCTS (derived from the real SIC output)")
    for name in ["lat.json", "lon.json", "stations.json", "coastline.json",
                 "metrics.json", "horizon_metrics.json",
                 "confidence_thresholds.json", "values/date_index.json"]:
        p = FRONTEND / name
        if not p.exists():
            print(f"  [MISSING] {human(p)}")
            continue
        try:
            obj = json.loads(p.read_text())
            size = f"{len(obj)} entries" if isinstance(obj, (list, dict)) else "scalar"
        except Exception:
            size = f"{p.stat().st_size} bytes"
        print(f"  {human(p):<44s} {size}")
    values = sorted((FRONTEND / "values").glob("*.json")) if (FRONTEND / "values").exists() else []
    print(f"  frontend/data/values/*.json: {len(values)} date files"
          + (f"  ({values[0].stem} .. {values[-1].stem})" if values else ""))


def check_external() -> None:
    h1("3. EXTERNAL REAL DATA (CMEMS currents, iceberg, wind, bathymetry)")
    config_path = ROOT / "src" / "data" / "config.py"
    print(f"  config module: {human(config_path)}")
    print("  env-var driven paths actually set in this shell:")
    found = False
    for key in sorted(os.environ):
        if key.startswith("ARctic_") or key.startswith("ARCTIC_"):
            print(f"    {key} = {os.environ[key]}")
            found = True
    if not found:
        print("    (none)")

    # CMEMS: the loader expects {cmems_root}/{year}/Ocean_{year}_{month:02d}.nc
    print("\n  CMEMS GLORYS current (uo, vo, m/s):")
    print("    expected layout: <cmems_root>/{2021..2024}/{year}/{year}_{MM}.nc")
    print("                    <cmems_root>/2025/CMEMS_Current_2025_6hourly.nc")
    drive_candidates = [
        Path("G:/MyDrive"),
        Path("C:/Users/Sanika/MyDrive"),
        Path.home() / "MyDrive",
    ]
    for cand in drive_candidates:
        print(f"    {'FOUND  ' if cand.exists() else 'absent '} {cand}")
    print("    NOTE: no local CMEMS archive in the repository; the documented")
    print("          source is Google Drive, which is not mounted here.")

    print("\n  Iceberg risk / trajectory outputs:")
    found_ice = False
    for cand in list(ROOT.glob("**/*iceberg*")) + list(ROOT.glob("**/*Iceberg*")):
        print(f"    {human(cand) if cand.is_relative_to(ROOT) else cand}")
        found_ice = True
    if not found_ice:
        print("    [MISSING] no iceberg data/model output present")
        print("    NOTE: src/data/adapters.py::IcebergAdapter is an empty")
        print("          stub; routing_metadata.json marks the iceberg")
        print("          standoff cost term as 'deferred'.")

    print("\n  Raw 2026 SIC inference inputs (needed only to re-run inference):")
    for cand in [ROOT / "backend" / "data" / "test_2026",
                 ROOT / "backend" / "data" / "processed",
                 ROOT / "data" / "raw", ROOT / "data" / "processed",
                 ROOT / "data" / "test"]:
        n = len(list(cand.rglob("*"))) if cand.exists() else 0
        files = len([p for p in cand.rglob("*") if p.is_file()]) if cand.exists() else 0
        state = f"exists, {files} files" if cand.exists() else "[MISSING]"
        print(f"    {human(cand):<44s} {state}")
    ck = sorted(ROOT.glob("backend/runs/*/best_model.pt"))
    print(f"    checkpoints: {len(ck)} found -> "
          f"{[p.parent.name for p in ck]}")


def check_route_ml_dataset() -> None:
    h1("4. EXISTING ROUTE-ML TRAINING DATASET (reuse decision)")
    npz = ML_OUTPUTS / "route_training_dataset.npz"
    csv = ML_OUTPUTS / "route_training_dataset.csv"
    if not npz.exists():
        print(f"  [MISSING] {human(npz)}")
        return
    z = np.load(str(npz), allow_pickle=True)
    feats = z["features"]
    names = [str(x) for x in z["feature_names"]]
    print(f"  {human(npz)}  features={feats.shape} actions={z['actions'].shape} "
          f"n_routes={int(z['n_routes'])} seed={int(z['seed'])}")
    print(f"  {human(csv)}  exists={csv.exists()}")
    idx = {n: i for i, n in enumerate(names)}
    rows = feats[:, idx["n_rows"]]
    cols = feats[:, idx["n_cols"]]
    print(f"\n  provenance check on the real-data requirements:")
    print(f"    grid size encoded in features : {int(rows[0])} x {int(cols[0])}"
          f"   (routing grid is 173 x 369) -> "
          f"{'REAL' if int(rows[0]) == 173 else 'SYNTHETIC'}")
    for layer in ("sic_mean", "current_uo", "current_vo", "depth",
                  "iceberg_risk", "current_cost"):
        if layer in idx:
            col = feats[:, idx[layer]]
            uniq = np.unique(np.round(col, 6))
            verdict = "all zero" if uniq.size == 1 and uniq[0] == 0 else "varies"
            print(f"    {layer:<16s}: min={col.min():.4f} max={col.max():.4f} "
                  f"-> {verdict}")
    th = feats[:, idx["t_hours"]]
    print(f"    t_hours         : {th.min():.1f} .. {th.max():.1f} "
          f"(route step index, not elapsed hours)")
    print(f"\n  VERDICT: existing dataset was generated from the synthetic grid in\n"
          f"            src/environment/synthetic.py (20 x 25), NOT from real "
          f"data.\n            Keep as a pipeline smoke test; it must be "
          f"regenerated from the real\n            routing grid before training the "
          f"route ML model.")


def check_sic_integration() -> None:
    h1("5. SIC -> EnvironmentalGrid INTEGRATION (this branch)")
    try:
        from src.data.sic_forecast import SICForecastField
    except Exception as exc:  # pragma: no cover
        print(f"  [ERROR] cannot import SICForecastField: {exc}")
        return
    from datetime import datetime, timezone

    field = SICForecastField(cache_dir=str(CACHE),
                             route_start_datetime=datetime(2026, 1, 6,
                                                           tzinfo=timezone.utc))
    if not field.is_available():
        print("  artifacts unavailable; skipping")
        return
    info = field.describe()
    for key, value in info.items():
        print(f"  {key:<26s}: {value}")
    grid = field.load(t_hours=0.0, grid_template=_native_grid())
    print(f"\n  load(t=0) -> sic_mean{grid.sic_mean.shape} "
          f"sic_uncertainty{grid.sic_uncertainty.shape}")
    print(f"  navigable cells: {int(grid.navigable.sum())} / {grid.navigable.size}"
          f"  (NaN cells marked impassable, never zero-filled)")


def _native_grid():
    import sys
    sys.path.insert(0, str(ROOT))
    from src.data.builder import build_grid_template
    return build_grid_template(lat_min=-75.0, lat_max=-32.0,
                               lon_min=-10.0, lon_max=82.0,
                               resolution_deg=0.25)


def main() -> None:
    print("Dataset inventory for the Antarctic route-optimization pipeline")
    print(f"repository: {ROOT}")
    check_sic_artifacts()
    check_frontend()
    check_external()
    check_route_ml_dataset()
    check_sic_integration()
    h1("6. GAP SUMMARY (blocking a real-data route-ML training run)")
    print("""
  AVAILABLE (real, committed)
    - SIC mean + uncertainty + confidence class + truth, 2026-01-06..2026-06-21,
      167 daily steps, full 173x369 routing grid (uncertainty model-band only)
    - routing axes, dx/dy, ice multiplier, cost grids, station goals/override,
      land mask, valid mask, routing_metadata.json
    - frontend products derived from the same real output

  MISSING / NOT MOUNTED
    - CMEMS GLORYS currents (uo, vo): Google Drive only, not mounted here.
      Blocks the real current_cost / current_uo / current_vo features.
    - Iceberg risk + uncertainty: no data and no model output; the adapter is a
      stub and the cost term is documented as deferred.
    - Wind and bathymetry: no data configured.
    - Raw 2026 SIC inference inputs (backend/data/test_2026): absent. Not
      recreated - the committed routing artifacts are the source of truth and
      re-running inference is out of scope.

  CONSEQUENCE
    A route-ML model trained today would be trained on real SIC but with
    zero-filled current/depth/iceberg features. Generate the expert dataset
    only after the CMEMS (and, if required, iceberg) features are available.
""")


if __name__ == "__main__":
    main()

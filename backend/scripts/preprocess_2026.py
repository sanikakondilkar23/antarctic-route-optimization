"""
preprocess_2026.py — Build processed test arrays for 2026 (Jan 1 – Jun 23).

Key optimizations vs training preprocess:
  - KD-tree neighbour info precomputed ONCE, reused per day (avoids 174 rebuilds)
  - radius_of_influence = 25000 (25 km, matches NSIDC cell spacing)
  - NSIDC data cast to float32 before resampling
  - ERA5/CMEMS loaded from test_2026 paths directly

Normalization stats come from data/processed/norm_stats.json (TRAINING ONLY).
SIC_prev_year looks up exact calendar dates from 2025 validation data.
"""

import json
import time
from pathlib import Path

import numpy as np
import xarray as xr

ROOT = Path(__file__).resolve().parents[1]

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
NSIDC_DIR = ROOT / "data" / "test_2026" / "nsidc"
ERA5_DIR = ROOT / "data" / "test_2026" / "era5"
CMEMS_DIR = ROOT / "data" / "test_2026" / "cmems"
OUTPUT_DIR = ROOT / "data" / "test_2026" / "processed"
TRAINING_DIR = ROOT / "data" / "processed"

LON_MIN, LON_MAX = -10.0, 80.0
LAT_MIN, LAT_MAX = -75.0, -50.0
TIME_START = "2026-01-01"
TIME_END = "2026-06-30"
REGID_RADIUS_M = 25_000  # 25 km


# ---------------------------------------------------------------------------
# Loaders (self-contained, no dependency on preprocess.py module globals)
# ---------------------------------------------------------------------------
def load_nsidc_test():
    """Load NSIDC CDR v6 files from test_2026, return DataArray (time, y, x)."""
    nc_files = sorted(NSIDC_DIR.glob("sic_pss25_*.nc"))
    if not nc_files:
        raise FileNotFoundError(f"No CDR v6 files in {NSIDC_DIR}/")

    def _iso_from_name(name):
        d = name[10:18]
        return np.datetime64(f"{d[0:4]}-{d[4:6]}-{d[6:8]}", "ns")

    start_ts = np.datetime64(TIME_START, "ns")
    end_ts = np.datetime64(TIME_END, "ns")
    nc_files = [f for f in nc_files if start_ts <= _iso_from_name(f.name) <= end_ts]

    print(f"[NSIDC] Loading {len(nc_files)} files ...")
    arrays = []
    for f in nc_files:
        with xr.open_dataset(f) as ds_one:
            arrays.append(ds_one["cdr_seaice_conc"].load())
    da = xr.concat(arrays, dim="time", join="exact", coords="minimal")
    da = da.sortby("time").sel(time=slice(TIME_START, TIME_END))
    print(f"[NSIDC] Shape: {da.shape}, range: {da.time.values[0]} -> {da.time.values[-1]}")
    return da


def load_era5_test():
    """Load ERA5 monthly NetCDF files, daily-average, crop to ROI."""
    nc_files = sorted(ERA5_DIR.glob("ERA5_*.nc"))
    if not nc_files:
        raise FileNotFoundError(f"No ERA5_*.nc files in {ERA5_DIR}/")

    rename_map = {
        "10m_u_component_of_wind": "u10",
        "10m_v_component_of_wind": "v10",
        "2m_temperature": "t2m",
    }

    months = []
    for f in nc_files:
        with xr.open_dataset(f) as ds_m:
            ds_m = ds_m.rename({k: v for k, v in rename_map.items() if k in ds_m.data_vars})
            ds_m = ds_m[["u10", "v10", "t2m"]]
            if ds_m.latitude.values[0] > ds_m.latitude.values[-1]:
                ds_m = ds_m.isel(latitude=slice(None, None, -1))
            ds_m = ds_m.sel(latitude=slice(LAT_MIN, LAT_MAX),
                            longitude=slice(LON_MIN, LON_MAX))
            months.append(ds_m.resample(time="1D").mean().load())

    ds = xr.concat(months, dim="time", join="exact", coords="minimal")
    ds = ds.sortby("time").sel(time=slice(TIME_START, TIME_END))
    if ds.latitude.values[0] > ds.latitude.values[-1]:
        ds = ds.isel(latitude=slice(None, None, -1))
    print(f"[ERA5] Shape: lat={ds.sizes['latitude']} lon={ds.sizes['longitude']}, "
          f"time: {ds.time.values[0]} -> {ds.time.values[-1]}")
    return ds


def load_cmems_test(target_lat, target_lon):
    """Load CMEMS monthly files, interp to ERA5 grid."""
    nc_files = sorted(CMEMS_DIR.glob("Ocean_*.nc"))
    if not nc_files:
        raise FileNotFoundError(f"No Ocean_*.nc files in {CMEMS_DIR}/")

    all_times = []
    for f in nc_files:
        with xr.open_dataset(f) as ds_t:
            all_times.append(np.asarray(ds_t["time"].values, dtype="datetime64[ns]"))
    all_times = np.concatenate(all_times)
    uniq_times = np.unique(all_times)
    print(f"[CMEMS] Raw timestamps: {all_times.size}, unique: {uniq_times.size}")

    remaining = set(int(t) for t in uniq_times)
    months = []
    n_dupes = 0
    for f in nc_files:
        with xr.open_dataset(f) as ds_m:
            ds_m = ds_m[["uo", "vo", "thetao", "so", "zos"]]
            if "depth" in ds_m.dims:
                ds_m = ds_m.isel(depth=0, drop=True)
            t_int = np.asarray(ds_m["time"].values, dtype="datetime64[ns]").astype("int64")
            keep_mask = np.array([int(t) in remaining for t in t_int], dtype=bool)
            n_dupes += int((~keep_mask).sum())
            for k in t_int[keep_mask]:
                remaining.discard(int(k))
            ds_m = ds_m.isel(time=keep_mask)
            if ds_m.sizes["time"] == 0:
                continue
            ds_m = ds_m.sortby("latitude")
            if ds_m.longitude.values[0] >= 0 and ds_m.longitude.values[-1] > 180:
                ds_m = ds_m.assign_coords(
                    longitude=(((ds_m.longitude + 180) % 360) - 180)
                ).sortby("longitude")
            ds_m = ds_m.sel(latitude=slice(LAT_MIN, LAT_MAX),
                            longitude=slice(LON_MIN, LON_MAX))
            ds_m = ds_m.interp(latitude=target_lat, longitude=target_lon, method="linear").load()
            months.append(ds_m)

    print(f"[CMEMS] Dropped {n_dupes} duplicate boundary timestamps")
    ds = xr.concat(months, dim="time").sortby("time")
    ds = ds.sel(time=slice(TIME_START, TIME_END))
    ds["thetao"] = ds["thetao"] + 273.15
    print(f"[CMEMS] Grid: lat={ds.sizes['latitude']} lon={ds.sizes['longitude']}, "
          f"time: {ds.time.values[0]} -> {ds.time.values[-1]}")
    return ds


# ---------------------------------------------------------------------------
# Optimized regrid: precompute KD-tree neighbour info ONCE
# ---------------------------------------------------------------------------
def regrid_nsidc_optimized(nsidc_da, target_lat, target_lon):
    """Regrid NSIDC SIC -> ERA5 grid using precomputed neighbour info.

    The KD-tree is built ONCE from the source/target geometry, then reused
    for all 174 days via fast array indexing. This is ~100x faster than
    calling resample_nearest per day (which rebuilds the KD-tree each time).
    """
    from pyproj import CRS, Transformer
    from pyresample.geometry import SwathDefinition
    from pyresample.kd_tree import get_neighbour_info, get_sample_from_neighbour_info

    t0 = time.time()

    # Build source lat/lon from EPSG:3976
    print("[Regrid] Building NSIDC lat/lon from EPSG:3976 x/y ...")
    xx, yy = np.meshgrid(nsidc_da.x.values, nsidc_da.y.values)
    transformer = Transformer.from_crs(
        CRS.from_epsg(3976), CRS.from_epsg(4326), always_xy=True
    )
    lon_2d, lat_2d = transformer.transform(xx, yy)
    print(f"[Regrid] Source lat/lon computed in {time.time()-t0:.1f}s")

    src_def = SwathDefinition(lons=lon_2d, lats=lat_2d)
    tgt_lon_2d, tgt_lat_2d = np.meshgrid(target_lon, target_lat)
    tgt_def = SwathDefinition(lons=tgt_lon_2d, lats=tgt_lat_2d)

    # Precompute KD-tree neighbour info ONCE
    t1 = time.time()
    print(f"[Regrid] Precomputing KD-tree neighbour info (radius={REGID_RADIUS_M}m) ...")
    valid_input_idx, valid_output_idx, index_array, distance_array = get_neighbour_info(
        src_def, tgt_def, radius_of_influence=REGID_RADIUS_M, neighbours=1
    )
    print(f"[Regrid] KD-tree built in {time.time()-t1:.1f}s")

    # Apply to each day via fast array indexing
    t2 = time.time()
    n_days = nsidc_da.sizes["time"]
    H, W = len(target_lat), len(target_lon)

    sic_regridded = np.full((n_days, H, W), np.nan, dtype=np.float32)
    for t in range(n_days):
        sic_day = nsidc_da.isel(time=t).values.astype(np.float32)
        resampled = get_sample_from_neighbour_info(
            "nn", (H, W), sic_day,
            valid_input_idx, valid_output_idx,
            index_array, distance_array=distance_array,
            fill_value=np.nan,
        )
        sic_regridded[t] = resampled

    print(f"[Regrid] {n_days} days resampled in {time.time()-t2:.1f}s")
    print(f"[Regrid] Total regrid wall time: {time.time()-t0:.1f}s")
    return sic_regridded


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Training norm stats
    with open(TRAINING_DIR / "norm_stats.json") as f:
        norm_stats = json.load(f)
    sic_mean = norm_stats["sic_mean"]
    sic_std = norm_stats["sic_std"]
    forcing_mean = np.array(norm_stats["mean"], dtype=np.float32)
    forcing_std = np.array(norm_stats["std"], dtype=np.float32)
    print(f"Training norm stats: sic_mean={sic_mean:.4f}, sic_std={sic_std:.4f}")

    # Training data for SIC_prev_year
    train_time = np.load(TRAINING_DIR / "time.npy")
    train_sic = np.load(TRAINING_DIR / "sic.npy")
    print(f"Training time: {train_time.shape[0]} days, {train_time[0]} -> {train_time[-1]}")

    # --- Load data sources ---
    t_start = time.time()

    print("\n=== Loading NSIDC ===")
    t0 = time.time()
    nsidc_da = load_nsidc_test()
    t_nsidc_load = time.time() - t0

    print("\n=== Loading ERA5 ===")
    t0 = time.time()
    era5_ds = load_era5_test()
    t_era5_load = time.time() - t0

    target_lat = era5_ds.latitude.values
    target_lon = era5_ds.longitude.values

    print("\n=== Loading CMEMS ===")
    t0 = time.time()
    cmems_regrid = load_cmems_test(target_lat, target_lon)
    t_cmems_load = time.time() - t0

    # --- Regrid NSIDC ---
    print("\n=== Regridding NSIDC ===")
    t0 = time.time()
    sic_arr = regrid_nsidc_optimized(nsidc_da, target_lat, target_lon)
    t_nsidc_regrid = time.time() - t0

    # --- Align time axes ---
    nsidc_time = np.asarray(nsidc_da.time.values, dtype="datetime64[ns]")
    era5_times = np.asarray(era5_ds.time.values, dtype="datetime64[ns]")
    cmems_times = np.asarray(cmems_regrid.time.values, dtype="datetime64[ns]")

    common_times = np.intersect1d(nsidc_time, era5_times)
    common_times = np.intersect1d(common_times, cmems_times)
    print(f"\n[Align] Common dates: {common_times.size}")
    print(f"  Range: {common_times[0]} -> {common_times[-1]}")

    sic_idx = np.array([np.where(nsidc_time == t)[0][0] for t in common_times], dtype=int)
    era5_idx = np.array([np.where(era5_times == t)[0][0] for t in common_times], dtype=int)
    cmems_idx = np.array([np.where(cmems_times == t)[0][0] for t in common_times], dtype=int)

    sic = sic_arr[sic_idx]  # already float32 from regrid

    # --- SIC_prev_year: EXACT calendar date match from 2025 ---
    print("\n=== Building SIC_prev_year channel ===")
    sic_prev = np.full_like(sic, np.nan, dtype=np.float32)
    train_time_set = {int(t): i for i, t in enumerate(train_time)}
    prev_nan_days = 0
    for i, t in enumerate(common_times):
        prev_t = t - np.timedelta64(365, "D")
        j = train_time_set.get(int(prev_t))
        if j is not None:
            sic_prev[i] = train_sic[j]
        else:
            prev_nan_days += 1
    print(f"  SIC_prev_year NaN days (date not in 2025): {prev_nan_days}")

    # Date-match verification
    print("\n=== SIC_prev_year DATE-MATCH VERIFICATION ===")
    for idx in [0, 1, 2, 3, 4, -5, -4, -3, -2, -1]:
        d_2026 = np.datetime64(common_times[idx], "D")
        year, month, day = str(d_2026).split("-")
        d_prev = np.datetime64(f"2025-{month}-{day}", "D")
        matches = np.where(train_time == d_prev)[0]
        status = "EXACT" if len(matches) == 1 else f"FAIL ({len(matches)} matches)"
        print(f"  {idx:>4}  {d_2026}  ->  {d_prev}  {status}")

    # --- Build forcing array [T, 9, H, W] ---
    print("\n=== Building forcing array ===")
    channels = []
    for var in ["u10", "v10", "t2m"]:
        channels.append(era5_ds[var].isel(time=era5_idx).values.astype(np.float32))
    for var in ["uo", "vo", "thetao", "so", "zos"]:
        channels.append(cmems_regrid[var].isel(time=cmems_idx).values.astype(np.float32))
    channels.append(sic_prev)
    forcing = np.stack(channels, axis=1)  # [T, 9, H, W]

    # --- Standardize with TRAINING stats ---
    print("\n=== Standardizing with training stats ===")
    forcing_mean_4d = forcing_mean.reshape(1, 9, 1, 1)
    forcing_std_4d = forcing_std.reshape(1, 9, 1, 1)
    forcing_std_4d[~np.isfinite(forcing_std_4d)] = 1.0
    forcing_std_4d[forcing_std_4d == 0] = 1.0
    forcing = (forcing - forcing_mean_4d) / forcing_std_4d

    nan_count = int(np.isnan(forcing).sum())
    print(f"  NaN count before fill: {nan_count}")
    forcing = np.nan_to_num(forcing, nan=0.0)

    # --- Save ---
    lat = era5_ds.latitude.values.astype(np.float32)
    lon = era5_ds.longitude.values.astype(np.float32)
    np.save(OUTPUT_DIR / "sic.npy", sic)
    np.save(OUTPUT_DIR / "forcing.npy", forcing)
    np.save(OUTPUT_DIR / "time.npy", common_times.astype("datetime64[ns]"))
    np.save(OUTPUT_DIR / "lat.npy", lat)
    np.save(OUTPUT_DIR / "lon.npy", lon)

    # --- Timing report ---
    t_total = time.time() - t_start
    print("\n" + "=" * 60)
    print("  TIMING REPORT")
    print("=" * 60)
    print(f"  NSIDC load:        {t_nsidc_load:.1f}s")
    print(f"  ERA5 load:         {t_era5_load:.1f}s")
    print(f"  CMEMS load:        {t_cmems_load:.1f}s")
    print(f"  NSIDC regrid:      {t_nsidc_regrid:.1f}s")
    print(f"  Total:             {t_total:.1f}s")
    print("=" * 60)

    # --- GATE 2 REPORT ---
    ch_names = ["u10", "v10", "t2m", "uo", "vo", "thetao", "so", "zos", "sic_prev_year"]
    print("\n  GATE 2 REPORT")
    print("=" * 60)
    print(f"  sic.npy:     shape {sic.shape}  dtype {sic.dtype}  NaN fraction {np.isnan(sic).mean():.4f}")
    print(f"  forcing.npy: shape {forcing.shape}  dtype {forcing.dtype}")
    for c, name in enumerate(ch_names):
        ch = forcing[:, c]
        print(f"    ch {c:2d} ({name:>14s}): min={ch.min():.4f}  max={ch.max():.4f}  NaN={np.isnan(ch).mean():.6f}")
    print(f"  time.npy:    [{common_times.size}]  {common_times[0]}  {common_times[-1]}")
    gaps = np.diff(common_times)
    n_gaps = int(np.sum(gaps != np.timedelta64(1, "D")))
    print(f"  Gaps in time axis: {n_gaps}")
    print(f"  T == 174 (GATE 1): {common_times.size == 174}")
    print(f"  forcing NaN == 0:  {np.isnan(forcing).mean() == 0.0}")
    print("=" * 60)


if __name__ == "__main__":
    main()

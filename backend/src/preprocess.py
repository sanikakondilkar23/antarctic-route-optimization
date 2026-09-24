"""
preprocess.py — Align NSIDC CDR v6 SIC + ERA5 + CMEMS into model inputs.

Produces:
    sic.npy       [T, H, W]       float32  RAW SIC 0..1 (NaN preserved)
    sic_mean.npy  scalar          float32  train-period SIC mean
    sic_std.npy   scalar          float32  train-period SIC std
    forcing.npy   [T, 9, H, W]    float32  standardized u10,v10,t2m,uo,vo,
                                              thetao,so,zos,SIC_prev_year
    time.npy      [T]             datetime64[ns]
    lat.npy       [H]             float32
    lon.npy       [W]             float32
    norm_stats.json               train-set normalization stats

ROI: lon [-10, 80], lat [-75, -50]  (Southern Ocean, Bharati-Maitri corridor).

Data window: 2021-01-01 .. 2025-12-31 (1826 days).
Train: 2021-01-01 .. 2024-12-31 (standardization stats).  Val: 2025.

Channel order (identical in preprocess, dataset, model):
    0: SIC           1: u10   2: v10   3: t2m
    4: uo            5: vo    6: thetao 7: so
    8: zos           9: SIC_prev_year (shifted 365 days by calendar date)

Forcing channel order in forcing.npy (9 channels, index 1..9 above):
    [u10, v10, t2m, uo, vo, thetao, so, zos, SIC_prev_year]

Data sources
------------
NSIDC CDR v6 (G02202 NSIDC-0051):
    data/nsidc_raw/sic_pss25_YYYYMMDD_FXX_v06r00.nc   (flat layout)
    Grid (time=1, y=332, x=316). Coords time/x/y; x/y in meters on the
    NSIDC Southern-Hemisphere polar stereographic grid (EPSG:3976).
    SIC = cdr_seaice_conc, already scaled 0..1 and flags already masked to
    NaN. Do NOT divide by 100. Do NOT re-mask flags.

ERA5 (data/era5_nc/ERA5_YYYY_MM.nc, NetCDF — converted from GRIB in WSL):
    Variables already named u10, v10, t2m. Hourly/6-hourly -> daily mean.
    Grid: regular lat/lon at 0.25 deg, ROI-cropped before concat.

CMEMS (data/cmems_raw/Ocean_YYYY_MM.nc, GLORYS12v1 daily means):
    Variables uo, vo, thetao, so, zos. Single depth level ~0.494 m.
    Regular lat/lon grid (1/12 deg). Interpolated to the ERA5 grid.
    Duplicated boundary timestamps (2021-2024 files carry the first day of
    the following month) are removed by TIMESTAMP (np.unique on time)
    before any spatial regrid, unifying 2021-2024 (dupes) with 2025 (none).
    CMEMS NaN (land/non-ocean) are invalid; after alignment + standardi-
    zation filled with 0 (= channel mean). Filled counts logged per month.

SIC_prev_year:
    2021 dates map to 2020 (not on disk) -> NaN -> 0 post-standardization.
    Number of such NaN days is reported.
"""

import json
import logging
from pathlib import Path

import numpy as np
import xarray as xr

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
LON_MIN, LON_MAX = -10.0, 80.0
LAT_MIN, LAT_MAX = -75.0, -50.0
TIME_START = "2021-01-01"
TIME_END = "2025-12-31"
TRAIN_END = "2024-12-31"

# 7-day verification slice. Keep TEST_MODE=True for the mandatory smoke-test.
# A full 5-year run requires TEST_MODE=False and all raw data present.
TEST_MODE = False
if TEST_MODE:
    TIME_START, TIME_END = "2022-01-01", "2022-01-07"

# Stage A = SIC + ERA5 only (CMEMS disabled); Stage B = full channel set.
# Set False to reproduce Stage A, True for Stage B.
INCLUDE_CMEMS = True

OUTPUT_DIR = Path(__file__).resolve().parents[1] / "data" / "processed"
RAW_NSIDC_DIR = Path(__file__).resolve().parents[1] / "data" / "raw" / "nsidc"
RAW_ERA5_DIR = Path(__file__).resolve().parents[1] / "data" / "raw" / "era5"
RAW_CMEMS_DIR = Path(__file__).resolve().parents[1] / "data" / "raw" / "cmems"
REGID_RADIUS_M = 50_000  # 50 km, fits NSIDC 25 km cell spacing

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("preprocess")


def _months_in_window(nc_files):
    """Filter monthly files (ERA5_YYYY_MM.nc / Ocean_YYYY_MM.nc) to those
    whose YYYY_MM month intersects [TIME_START, TIME_END] (lexicographic).

    Avoids concatenating out-of-window months onto non-identical grids
    (join='exact' would fail loudly on truly mismatched grids, but months
    outside the requested window are irrelevant and need not be loaded).
    """
    start_m = f"{TIME_START[0:4]}_{TIME_START[5:7]}"
    end_m = f"{TIME_END[0:4]}_{TIME_END[5:7]}"
    picked = []
    for f in nc_files:
        if f.name.startswith("ERA5_"):
            m = f.name[5:12]      # ERA5_YYYY_MM.nc
        elif f.name.startswith("Ocean_"):
            m = f.name[6:13]      # Ocean_YYYY_MM.nc
        else:
            continue
        if start_m <= m <= end_m:
            picked.append(f)
    return picked


# ---------------------------------------------------------------------------
# 1. Download ERA5 as NetCDF (cdsapi). GRIB path abandoned (see docstring).
# ---------------------------------------------------------------------------
def _months_between(start: str, end: str):
    """Yield 'YYYY-MM' strings covering [start, end] inclusive."""
    y0, m0 = int(start[:4]), int(start[5:7])
    y1, m1 = int(end[:4]), int(end[5:7])
    y, m = y0, m0
    while (y, m) <= (y1, m1):
        yield f"{y:04d}_{m:02d}"
        m += 1
        if m == 13:
            y, m = y + 1, 1


def download_era5():
    """Download hourly ERA5 single-levels (u10, v10, t2m) as monthly NetCDF."""
    import cdsapi

    print("[ERA5] Downloading monthly NetCDF files ...")
    RAW_ERA5_DIR.mkdir(parents=True, exist_ok=True)

    c = cdsapi.Client()

    for yyyy_mm in _months_between(TIME_START, TIME_END):
        year, month = yyyy_mm.split("_")
        out_path = RAW_ERA5_DIR / f"ERA5_{yyyy_mm}.nc"

        if out_path.exists():
            print(f"  {yyyy_mm} already exists — skipping.")
            continue

        print(f"  Requesting {yyyy_mm} ...")
        c.retrieve(
            "reanalysis-era5-single-levels",
            {
                "product_type": "reanalysis",
                "variable": [
                    "10m_u_component_of_wind",
                    "10m_v_component_of_wind",
                    "2m_temperature",
                ],
                "year": year,
                "month": month,
                "day": [f"{d:02d}" for d in range(1, 32)],
                "time": [f"{h:02d}:00" for h in range(24)],
                "area": [LAT_MAX, LON_MIN, LAT_MIN, LON_MAX],  # N, W, S, E
                "format": "netcdf",
                "grid": ["0.25", "0.25"],
            },
            str(out_path),
        )
        print(f"  {yyyy_mm} saved to {out_path}")

    print("[ERA5] Download complete.")


# ---------------------------------------------------------------------------
# 2. Load NSIDC CDR v6
# ---------------------------------------------------------------------------
# Note: x/y coords are in meters (polar stereographic). lat/lon are NOT in
# the file; they are computed in regrid_to_era5() via pyproj (EPSG:3976).
def load_nsidc():
    """One file at a time -> xr.concat (NOT open_mfdataset by_coords).

    Returns a DataArray with dims (time, y, x) sorted by time.
    """
    nc_files = sorted(RAW_NSIDC_DIR.glob("sic_pss25_*.nc"))
    if not nc_files:
        raise FileNotFoundError(
            f"No CDR v6 files in {RAW_NSIDC_DIR}/"
        )

    # Restrict to the requested date window (speeds up the 7-day slice).
    # Filename date is YYYYMMDD (sic_pss25_YYYYMMDD_FXX_v06r00.nc); make it
    # ISO 8601 because np.datetime64 mis-parses the bare YYYYMMDD form.
    def _iso_from_name(name):
        d = name[10:18]
        return np.datetime64(f"{d[0:4]}-{d[4:6]}-{d[6:8]}", "ns")

    start_ts = np.datetime64(TIME_START, "ns")
    end_ts = np.datetime64(TIME_END, "ns")
    nc_files = [
        f
        for f in nc_files
        if start_ts <= _iso_from_name(f.name) <= end_ts
    ]
    if not nc_files:
        raise FileNotFoundError(
            f"No CDR v6 files in [{TIME_START}, {TIME_END}]"
        )

    print(f"[NSIDC] Loading {len(nc_files)} CDR v6 files ...")

    arrays = []
    for f in nc_files:
        with xr.open_dataset(f) as ds_one:
            if "cdr_seaice_conc" not in ds_one.data_vars:
                raise KeyError(
                    f"{f.name}: cdr_seaice_conc missing. "
                    f"Found: {list(ds_one.data_vars)}"
                )
            arrays.append(ds_one["cdr_seaice_conc"].load())

    da = xr.concat(arrays, dim="time", join="exact", coords="minimal")
    da = da.sortby("time")
    da = da.sel(time=slice(TIME_START, TIME_END))

    print(f"[NSIDC] Loaded shape: {da.shape}")
    print(f"[NSIDC] Time range: {da.time.values[0]} -> {da.time.values[-1]}")
    print(
        f"[NSIDC] min={float(np.nanmin(da.values))} "
        f"max={float(np.nanmax(da.values))}"
    )
    return da


# ---------------------------------------------------------------------------
# 3. Load ERA5 (NetCDF)
# ---------------------------------------------------------------------------
def load_era5():
    """Open ERA5 monthly NetCDF files, daily-average, return Dataset.

    Normalizes latitude to ascending and longitude to [-180, 180] ascending,
    then crops to the ROI (lon [-10, 80], lat [-75, -50]).
    """
    nc_files = sorted(RAW_ERA5_DIR.glob("ERA5_*.nc"))
    if not nc_files:
        raise FileNotFoundError(
            f"No ERA5_*.nc files in {RAW_ERA5_DIR}/. "
            "Run download_era5() first."
        )
    nc_files = _months_in_window(nc_files)
    print(f"[ERA5] Loading {len(nc_files)} NetCDF files ...")

    rename_map = {
        "10m_u_component_of_wind": "u10",
        "10m_v_component_of_wind": "v10",
        "2m_temperature": "t2m",
        "u10": "u10", "v10": "v10", "t2m": "t2m",
    }

    months = []
    for f in nc_files:
        with xr.open_dataset(f) as ds_m:
            ds_m = ds_m.rename(
                {k: v for k, v in rename_map.items() if k in ds_m.data_vars}
            )
            keep = [v for v in ["u10", "v10", "t2m"] if v in ds_m.data_vars]
            if len(keep) != 3:
                raise RuntimeError(
                    f"{f.name}: expected u10/v10/t2m, found "
                    f"{list(ds_m.data_vars)}"
                )
            ds_m = ds_m[keep]
            # Normalize latitude to ascending BEFORE the ROI crop (xarray
            # slice on a descending axis yields an empty selection).
            if ds_m.latitude.values[0] > ds_m.latitude.values[-1]:
                ds_m = ds_m.isel(latitude=slice(None, None, -1))
            # Crop each month to the ROI BEFORE concat so every monthly file
            # lands on an identical (101x361) grid — join="exact" then passes
            # even though some months (e.g. 2022-04) were downloaded on the
            # ROI box while others span the full hemisphere. Also shrinks
            # memory vs concatenating full-globe months.
            ds_m = ds_m.sel(latitude=slice(LAT_MIN, LAT_MAX),
                            longitude=slice(LON_MIN, LON_MAX))
            # Hourly/6-hourly -> daily mean for this month (keeps memory low).
            months.append(ds_m.resample(time="1D").mean().load())

    ds = xr.concat(months, dim="time", join="exact", coords="minimal")
    ds = ds.sortby("time")
    ds = ds.sel(time=slice(TIME_START, TIME_END))

    # Latitude ascending
    if ds.latitude.values[0] > ds.latitude.values[-1]:
        ds = ds.isel(latitude=slice(None, None, -1))
        print("[ERA5] Flipped latitude to ascending")
    # Longitude to -180..180 and ascending (already in this dataset)
    if ds.longitude.values[0] >= 0 and ds.longitude.values[-1] > 180:
        ds = ds.assign_coords(
            longitude=((ds.longitude + 180) % 360) - 180
        ).sortby("longitude")
        print("[ERA5] Converted longitude to -180..180")
    # Crop to ROI (target grid for NSIDC/CMEMS regridding)
    ds = ds.sel(latitude=slice(LAT_MIN, LAT_MAX),
                longitude=slice(LON_MIN, LON_MAX))

    print(f"[ERA5] Variables: {list(ds.data_vars)}")
    print(f"[ERA5] Time range: {ds.time.values[0]} -> {ds.time.values[-1]}")
    print(
        f"[ERA5] Grid (ROI): lat {ds.sizes['latitude']} x "
        f"lon {ds.sizes['longitude']}"
    )

    for var in ["u10", "v10", "t2m"]:
        n_nan = int(np.isnan(ds[var].values).sum())
        if n_nan > 0:
            print(f"[ERA5] WARNING: {n_nan} NaN in {var} after daily avg")

    return ds


# ---------------------------------------------------------------------------
# 3b. Load CMEMS ocean forcing (NetCDF, one month at a time)
# ---------------------------------------------------------------------------
def load_cmems(target_lat=None, target_lon=None):
    """Open CMEMS GLORYS12v1 monthly NetCDF files, one at a time.

    Timestamp dedup (GATE 2 note): 2021-2024 month files carry the first
    day of the following month as a duplicated boundary time (verified
    identical values across adjacent months). 2025 files do not. We dedupe
    by TIMESTAMP — not positionally — and do it BEFORE any spatial regrid:
    each unique daily mean is consumed exactly once (chronologically), so
    duplicate days are never xr.interp'd. The union of per-file time axes
    is read cheaply first (no data load), then data is loaded row-filtered
    per month and interp'd to the ERA5 ROI grid BEFORE concat (keeps peak
    memory bounded; a whole-set concat on the 1/12-deg grid would OOM).

    Selects the shallowest depth level (~0.494 m), keeps uo/vo/thetao/so/
    zos, converts/normalizes lon convention, crops to the ROI, then interps
    each month onto the ERA5 ROI grid.
    """
    nc_files = sorted(RAW_CMEMS_DIR.glob("Ocean_*.nc"))
    if not nc_files:
        raise FileNotFoundError(f"No Ocean_*.nc files in {RAW_CMEMS_DIR}/")
    nc_files = _months_in_window(nc_files)
    if not nc_files:
        raise FileNotFoundError(
            f"No Ocean_*.nc files in [{TIME_START}, {TIME_END}] window"
        )
    print(f"[CMEMS] Loading {len(nc_files)} monthly files ...")

    # --- Pass 1: read only time axes (cheap), build unique timestamp set ---
    all_times = []
    for f in nc_files:
        with xr.open_dataset(f) as ds_t:
            all_times.append(np.asarray(ds_t["time"].values, dtype="datetime64[ns]"))
    all_times = np.concatenate(all_times)
    uniq_times = np.unique(all_times)
    print(f"[CMEMS] Raw timestamps: {all_times.size}, unique: {uniq_times.size}")

    # --- Pass 2: load each month, keep unconsumed unique days only, regrid ---
    remaining = set(int(t) for t in uniq_times)  # ns ints for hashability
    months = []
    n_dupes = 0
    for f in nc_files:
        with xr.open_dataset(f) as ds_m:
            keep = [v for v in ["uo", "vo", "thetao", "so", "zos"]
                    if v in ds_m.data_vars]
            if len(keep) != 5:
                raise ValueError(
                    f"{f.name}: expected uo/vo/thetao/so/zos, found "
                    f"{list(ds_m.data_vars)}"
                )
            ds_m = ds_m[keep]
            if "depth" in ds_m.dims:
                ds_m = ds_m.isel(depth=0, drop=True)  # shallowest level
            t_int = np.asarray(ds_m["time"].values, dtype="datetime64[ns]").astype("int64")
            keep_mask = np.array([int(t) in remaining for t in t_int], dtype=bool)
            n_dupes += int((~keep_mask).sum())
            for k in t_int[keep_mask]:
                remaining.discard(int(k))
            ds_m = ds_m.isel(time=keep_mask)
            if ds_m.sizes["time"] == 0:
                continue
            ds_m = ds_m.sortby("latitude")
            if ds_m.longitude.values[0] >= 0 and \
               ds_m.longitude.values[-1] > 180:
                ds_m = ds_m.assign_coords(
                    longitude=(((ds_m.longitude + 180) % 360) - 180)
                ).sortby("longitude")
            ds_m = ds_m.sel(latitude=slice(LAT_MIN, LAT_MAX),
                            longitude=slice(LON_MIN, LON_MAX))
            if target_lat is not None:
                ds_m = ds_m.interp(
                    latitude=target_lat, longitude=target_lon, method="linear"
                ).load()
            months.append(ds_m.load())

    print(f"[CMEMS] Dropped {n_dupes} duplicate boundary timestamps")

    ds = xr.concat(months, dim="time")
    ds = ds.sortby("time")
    ds = ds.sel(time=slice(TIME_START, TIME_END))

    # Verify ideally-unique daily calendar after dedup.
    ds_t = np.asarray(ds.time.values, dtype="datetime64[ns]")
    print(f"[CMEMS] Post-dedup timestamps: {ds_t.size}, unique: {np.unique(ds_t).size}")

    # GLORYS12v1 stores thetao in degrees Celsius; ERA5 t2m is Kelvin.
    # Convert to Kelvin so all temperature channels share one unit.
    ds["thetao"] = ds["thetao"] + 273.15
    ds["thetao"].attrs["units"] = "K"

    print(f"[CMEMS] Variables: {list(ds.data_vars)}")
    print(f"[CMEMS] Grid (ROI): lat {ds.sizes['latitude']} x "
          f"lon {ds.sizes['longitude']}")
    print(f"[CMEMS] Time: {ds.time.values[0]} -> {ds.time.values[-1]}")
    return ds


# ---------------------------------------------------------------------------
# 4. Regrid NSIDC (polar stereographic) -> ERA5 regular lat/lon grid
# ---------------------------------------------------------------------------
def regrid_to_era5(nsidc_da, target_lat, target_lon):
    """Regrid SIC from the curvilinear polar-stereographic grid onto the
    ERA5 ROI lat/lon grid. SIC -> ERA5, NOT the reverse.

    pyproj: EPSG:3976 (NSIDC south polar stereographic) -> EPSG:4326.
    pyresample resample_nearest, radius_of_influence = 50 km.

    Returns np.ndarray shape (T, lat, lon).
    """
    from pyproj import CRS, Transformer
    from pyresample.geometry import SwathDefinition
    from pyresample.kd_tree import resample_nearest

    print("[Regrid] Building NSIDC lat/lon from EPSG:3976 x/y ...")
    xx, yy = np.meshgrid(nsidc_da.x.values, nsidc_da.y.values)
    transformer = Transformer.from_crs(
        CRS.from_epsg(3976), CRS.from_epsg(4326), always_xy=True
    )
    lon_2d, lat_2d = transformer.transform(xx, yy)

    src_def = SwathDefinition(lons=lon_2d, lats=lat_2d)

    tgt_lon_2d, tgt_lat_2d = np.meshgrid(target_lon, target_lat)
    tgt_def = SwathDefinition(lons=tgt_lon_2d, lats=tgt_lat_2d)

    print(
        f"[Regrid] Resampling {nsidc_da.sizes['time']} days "
        f"-> {(len(target_lat), len(target_lon))} grid ..."
    )
    sic_regridded = []
    for t in range(nsidc_da.sizes["time"]):
        sic_day = nsidc_da.isel(time=t).values  # (y, x)
        resampled = resample_nearest(
            src_def,
            sic_day,
            tgt_def,
            radius_of_influence=REGID_RADIUS_M,
            fill_value=np.nan,
        )
        sic_regridded.append(resampled)

    sic_arr = np.stack(sic_regridded, axis=0)  # (T, lat, lon)

    assert sic_arr.shape[1] == len(target_lat)
    assert sic_arr.shape[2] == len(target_lon)
    print(f"[Regrid] SIC shape after regrid: {sic_arr.shape}")
    return sic_arr


# ---------------------------------------------------------------------------
# 5. Align time axes, normalize, save
# ---------------------------------------------------------------------------
def align_and_save(sic_arr, nsidc_time, era5_ds, cmems_regrid):
    """Align SIC (regridded) + ERA5 + CMEMS by date, build .npy outputs.

    Normalization stats (mean/std) are computed on the TRAINING period only
    (common_times <= TRAIN_END). SIC is stored RAW 0..1 (NaN preserved) and
    standardized on the fly in dataset.py; the SIC_prev_year channel (9) is
    standardized here with the same SIC scalars (same physical quantity).
    Forcing NaN (CMEMS land/non-ocean and interp slivers) is filled with 0
    (= channel mean post-standardization), logged per month.
    """
    era5_times = np.asarray(era5_ds.time.values, dtype="datetime64[ns]")
    nsidc_time = np.asarray(nsidc_time, dtype="datetime64[ns]")
    cmems_times = (
        np.asarray(cmems_regrid.time.values, dtype="datetime64[ns]")
        if cmems_regrid is not None else None
    )

    common_times = np.intersect1d(nsidc_time, era5_times)
    if cmems_times is not None:
        common_times = np.intersect1d(common_times, cmems_times)

    print(f"[Align] NSIDC dates: {nsidc_time.size}")
    print(f"[Align] ERA5 dates:  {era5_times.size}")
    cmems_print = cmems_times.size if cmems_times is not None else 0
    print(f"[Align] CMEMS dates: {cmems_print}")
    print(f"[Align] Common:      {common_times.size}")
    print(f"[Align] Only NSIDC:  {list(np.setdiff1d(nsidc_time, era5_times)[:5])}")
    print(f"[Align] Only ERA5:   {list(np.setdiff1d(era5_times, nsidc_time)[:5])}")
    if cmems_times is not None:
        print(f"[Align] Only CMEMS:  {list(np.setdiff1d(cmems_times, np.intersect1d(nsidc_time, era5_times))[:5])}")

    sic_idx = np.array(
        [np.where(nsidc_time == t)[0][0] for t in common_times], dtype=int
    )
    era5_idx = np.array(
        [np.where(era5_times == t)[0][0] for t in common_times], dtype=int
    )
    cmems_idx = (
        np.array([np.where(cmems_times == t)[0][0] for t in common_times],
                 dtype=int)
        if cmems_times is not None else None
    )

    sic = sic_arr[sic_idx].astype(np.float32)  # [T, H, W]

    # --- Build SIC_prev_year channel: SIC shifted 365 days back ---
    # Aligned by strict calendar shift (t - 365 days). 2021 dates map to
    # 2020 (not on disk) -> whole-day NaN -> 0 post-standardization.
    sic_prev = np.full_like(sic, np.nan, dtype=np.float32)
    t_index = {int(t): i for i, t in enumerate(common_times)}
    prev_nan_days = 0
    for i, t in enumerate(common_times):
        prev_t = t - np.timedelta64(365, "D")
        j = t_index.get(int(prev_t))
        if j is not None:
            sic_prev[i] = sic[j]
        else:
            prev_nan_days += 1
    print(f"[Align] SIC_prev_year NaN days (2020 not on disk): {prev_nan_days}")

    # --- Build forcing array [T, C, H, W] ---
    print("[Align] Building forcing array ...")
    channels = []
    ch_names = []
    for var in ["u10", "v10", "t2m"]:
        channels.append(
            era5_ds[var].isel(time=era5_idx).values.astype(np.float32)
        )
        ch_names.append(var)

    if cmems_regrid is not None:
        for var in ["uo", "vo", "thetao", "so", "zos"]:
            channels.append(
                cmems_regrid[var].isel(time=cmems_idx).values.astype(np.float32)
            )
            ch_names.append(var)
    channels.append(sic_prev)
    ch_names.append("sic_prev_year")
    forcing = np.stack(channels, axis=1)  # [T, C, H, W]

    # --- SIC stats (train-period) and RAW persistence to disk ---
    # ITEM 4 convention: SIC is stored RAW 0..1 in sic.npy. The input SIC
    # channel is standardized ON THE FLY in dataset.py using the scalar
    # files saved here. The model head stays sigmoid and the loss / all
    # metrics operate on RAW 0..1 targets.
    train_mask = common_times <= np.datetime64(TRAIN_END)
    sic_train = sic[train_mask]
    sic_mean = float(np.nanmean(sic_train))
    sic_std = float(np.nanstd(sic_train))

    # --- Standardize forcing with train-period stats ---
    # CMEMS channels still contain NaN (land) at this point, so use
    # nanmean/nanstd — np.mean on NaN land cells would yield NaN mean/std and
    # zero out the whole ocean field after the nan_to_num fill below.
    # Channel 9 (sic_prev_year) uses the SAME scalars as the input SIC
    # channel (identical physical quantity) for scale consistency.
    forcing_train = forcing[train_mask]
    mean = np.nanmean(forcing_train[:, :8], axis=(0, 2, 3),
                      keepdims=True).astype(np.float32)
    std = np.nanstd(forcing_train[:, :8], axis=(0, 2, 3),
                    keepdims=True).astype(np.float32)
    std[~np.isfinite(std)] = 1.0   # guard zero/NaN-variance channels
    std[std == 0] = 1.0
    # Append SIC-identical scalars for the sic_prev_year channel.
    sic_scalar = np.float32(sic_mean)
    sic_scalar_std = np.float32(sic_std)
    mean = np.concatenate([mean, np.full((1, 1, 1, 1), sic_scalar,
                                         dtype=np.float32)], axis=1)
    std = np.concatenate([std, np.full((1, 1, 1, 1), sic_scalar_std,
                                       dtype=np.float32)], axis=1)
    assert np.isfinite(mean).all() and np.isfinite(std).all(), \
        "forcing channel stats must be finite"

    forcing = (forcing - mean) / std

    # --- CMEMS NaN policy: fill with 0 (= channel mean); log per month ---
    if cmems_regrid is not None:
        print("[Align] CMEMS NaN fill counts (pre-fill, per month):")
        for c, var in enumerate(["uo", "vo", "thetao", "so", "zos"]):
            chan = forcing[:, 3 + c]
            counts = {}
            for t in range(chan.shape[0]):
                month = np.datetime64(common_times[t], "M")  # floor to month
                counts[month] = counts.get(month, 0) + \
                    int(np.isnan(chan[t]).sum())
            print(f"    {var}: {counts}")
    forcing = np.nan_to_num(forcing, nan=0.0)

    norm_stats = {
        "sic_mean": sic_mean,
        "sic_std": sic_std,
        "channel_names": ch_names,
        "mean": mean.squeeze().tolist(),
        "std": std.squeeze().tolist(),
        "training_period": f"{TIME_START} to {TRAIN_END}",
        "n_days": int(train_mask.sum()),
        "n_full_days": int(common_times.size),
        "sic_prev_year_nan_days": prev_nan_days,
        "note": (
            "RAW SIC stored in sic.npy (NaN preserved); input SIC channel "
            "standardized on the fly in dataset.py with sic_mean.npy/"
            "sic_std.npy (train-period stats). Channel 9 (sic_prev_year) "
            "standardized with the same SIC scalars. Model head is sigmoid; "
            "target y and ALL metrics use RAW 0..1. Forcing channels "
            "standardized here (NaN -> 0 post-std). "
            f"CMEMS {'enabled' if cmems_regrid is not None else 'disabled'}."
        ),
    }

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_DIR / "norm_stats.json", "w") as f:
        json.dump(norm_stats, f, indent=2)

    # --- Save (sic.npy is RAW; scalars to disk for dataset.py) ---
    lat = era5_ds.latitude.values.astype(np.float32)
    lon = era5_ds.longitude.values.astype(np.float32)
    assert (lat.size, lon.size) == (forcing.shape[2], forcing.shape[3]) and \
        (sic.shape[1], sic.shape[2]) == (forcing.shape[2], forcing.shape[3]), \
        "lat/lon must be identical across sic and forcing arrays"
    np.save(OUTPUT_DIR / "sic.npy", sic)
    np.save(OUTPUT_DIR / "sic_mean.npy", np.float32(sic_mean))
    np.save(OUTPUT_DIR / "sic_std.npy", np.float32(sic_std))
    np.save(OUTPUT_DIR / "forcing.npy", forcing)
    np.save(OUTPUT_DIR / "time.npy", common_times.astype("datetime64[ns]"))
    np.save(OUTPUT_DIR / "lat.npy", lat)
    np.save(OUTPUT_DIR / "lon.npy", lon)
    print("[Align] Saved sic.npy (RAW), sic_mean.npy, sic_std.npy, "
          "forcing.npy, time.npy, lat.npy, lon.npy, norm_stats.json")
    print(
        f"[Align] Final T={sic.shape[0]}, C={forcing.shape[1]}, "
        f"H={forcing.shape[2]}, W={forcing.shape[3]}"
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print("=" * 60)
    print("  NSIDC CDR v6 SIC + ERA5 + CMEMS Preprocessing Pipeline")
    print(f"  Window: {TIME_START} -> {TIME_END}")
    print(f"  CMEMS:  {'ENABLED' if INCLUDE_CMEMS else 'DISABLED (Stage A)'}")
    print("=" * 60)

    if (OUTPUT_DIR / "sic.npy").exists() and (OUTPUT_DIR / "forcing.npy").exists():
        print(
            "Processed outputs already exist. "
            "Delete data/sic.npy to re-run."
        )
        return

    # Download missing ERA5 months if none present (cdsapi creds in ~/.cdsapirc).
    if not list(RAW_ERA5_DIR.glob("ERA5_*.nc")):
        download_era5()
    else:
        print(
            f"[ERA5] Raw NetCDF files found in {RAW_ERA5_DIR}/ "
            "— skipping download."
        )

    # Load SIC
    nsidc_da = load_nsidc()

    # Load ERA5 (daily averages, cropped to ROI)
    era5_ds = load_era5()

    # Regrid NSIDC -> ERA5 ROI grid
    target_lat = era5_ds.latitude.values
    target_lon = era5_ds.longitude.values
    sic_arr = regrid_to_era5(nsidc_da, target_lat, target_lon)

    # Load + regrid CMEMS (optional). load_cmems() interps each monthly
    # file to the ERA5 ROI grid before concat (memory-bounded); interping
    # the 3-year concat at once would hold ~7 GB in RAM.
    cmems_regrid = None
    if INCLUDE_CMEMS:
        cmems_regrid = load_cmems(target_lat, target_lon)
    else:
        print("[CMEMS] Disabled — Stage A (SIC + ERA5 only).")

    # Align, normalize, save
    align_and_save(sic_arr, nsidc_da.time.values, era5_ds, cmems_regrid)

    # --- GATE 3 assertions (3g) ---
    sic = np.load(OUTPUT_DIR / "sic.npy")
    forcing = np.load(OUTPUT_DIR / "forcing.npy")
    time_arr = np.load(OUTPUT_DIR / "time.npy")
    lat = np.load(OUTPUT_DIR / "lat.npy")
    lon = np.load(OUTPUT_DIR / "lon.npy")

    assert forcing.shape[1] == 9, \
        f"expect 9 forcing channels, got {forcing.shape[1]}"
    gaps = np.diff(time_arr)
    bad = int(np.sum(gaps != np.timedelta64(1, "D")))
    assert bad == 0, f"time axis has {bad} gaps > 1 day"
    assert (lat.size, lon.size) == (sic.shape[1], sic.shape[2]) == \
        (forcing.shape[2], forcing.shape[3]), \
        "lat/lon must be identical across sic and forcing arrays"
    print(f"[Verify] forcing channels = {forcing.shape[1]} (spec: 9)")
    print(f"[Verify] time gaps > 1 day: {bad} (spec: 0)")
    print(f"[Verify] sizes T={sic.shape[0]} H={lat.size} W={lon.size}")

    print("=" * 60)
    print("  Preprocessing complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
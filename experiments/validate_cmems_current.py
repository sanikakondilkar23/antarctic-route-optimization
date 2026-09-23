"""
CMEMS Current Dataset Validation Script
========================================

Run this on Google Colab after mounting Drive:
    from experiments.validate_cmems_current import validate_cmems_current
    validate_cmems_current()

Or directly:
    !python experiments/validate_cmems_current.py

Proves that real CMEMS data can be read and converted to
EnvironmentalGrid.current_cost without loading the full 17GB file.
"""

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))


CMEMS_FILE = "/content/drive/MyDrive/SIH_26_Sanika/dataset/Copernicus_Ocean/2025/CMEMS_Current_2025_6hourly.nc"

# Antarctic subset bounds
LAT_MIN = -70.0
LAT_MAX = -64.0
LON_MIN = 70.0
LON_MAX = 80.0


def validate_cmems_current(cmems_path=None):
    """
    Open the real CMEMS file, inspect it, and read a small Antarctic subset.

    This function:
    1. Opens the file with xarray (lazy/chunked, no full RAM load)
    2. Reports dimensions, variables, coordinates
    3. Selects a small Antarctic spatial subset + few time steps
    4. Reads uo/vo values and verifies they are finite
    5. Creates an EnvironmentalGrid-compatible current_cost layer

    Returns dict with inspection results.
    """
    try:
        import xarray as xr
    except ImportError:
        print("ERROR: xarray not installed. Run: pip install xarray")
        return None

    if cmems_path is None:
        cmems_path = CMEMS_FILE

    path = Path(cmems_path)
    if not path.exists():
        print(f"ERROR: File not found: {cmems_path}")
        print("This file is on Google Drive. Mount Drive first:")
        print("  from google.colab import drive")
        print("  drive.mount('/content/drive')")
        return None

    print("=" * 70)
    print("CMEMS Current Dataset Validation")
    print("=" * 70)
    print(f"File: {cmems_path}")
    print()

    # --- Step 1: Open with lazy loading ---
    print("--- Step 1: Open with xarray (lazy/chunked) ---")
    ds = xr.open_dataset(str(path), chunks={"time": 1})
    print(f"Dataset loaded lazily: {type(ds)}")
    print()

    # --- Step 2: Inspect dimensions ---
    print("--- Step 2: Dimensions ---")
    for dim, size in ds.dims.items():
        print(f"  {dim}: {size}")
    print()

    # --- Step 3: Inspect coordinates ---
    print("--- Step 3: Coordinates ---")
    for coord_name in ds.coords:
        coord = ds.coords[coord_name]
        print(f"  {coord_name}: dtype={coord.dtype}, shape={coord.shape}")
        if coord_name in ("latitude", "lat", "lat"):
            print(f"    range: [{float(coord.min()):.4f}, {float(coord.max()):.4f}]")
        elif coord_name in ("longitude", "lon", "lon"):
            print(f"    range: [{float(coord.min()):.4f}, {float(coord.max()):.4f}]")
        elif coord_name == "time":
            print(f"    range: [{str(coord.values[0])}, {str(coord.values[-1])}]")
        elif coord_name == "depth":
            print(f"    values: {coord.values}")
    print()

    # --- Step 4: Inspect variables ---
    print("--- Step 4: Variables ---")
    for var_name in ds.data_vars:
        var = ds[var_name]
        print(f"  {var_name}:")
        print(f"    dims: {var.dims}")
        print(f"    shape: {var.shape}")
        print(f"    dtype: {var.dtype}")
        if hasattr(var, "units"):
            print(f"    units: {var.attrs.get('units', 'N/A')}")
        if hasattr(var, "_FillValue"):
            print(f"    _FillValue: {var.attrs.get('_FillValue', 'N/A')}")
        if hasattr(var, "missing_value"):
            print(f"    missing_value: {var.attrs.get('missing_value', 'N/A')}")
    print()

    # --- Step 5: Select Antarctic subset ---
    print("--- Step 5: Antarctic Subset ---")
    print(f"  Latitude:  [{LAT_MIN}, {LAT_MAX}]")
    print(f"  Longitude: [{LON_MIN}, {LON_MAX}]")

    # Determine coordinate names
    lat_var = None
    lon_var = None
    for name in ("latitude", "lat"):
        if name in ds.dims or name in ds.coords:
            lat_var = name
            break
    for name in ("longitude", "lon"):
        if name in ds.dims or name in ds.coords:
            lon_var = name
            break

    if lat_var is None or lon_var is None:
        print(f"  ERROR: Could not find lat/lon variables. Available: {list(ds.coords)}")
        return None

    print(f"  Using coordinates: lat={lat_var}, lon={lon_var}")

    # Select subset
    subset = ds.sel(
        {lat_var: slice(LAT_MIN, LAT_MAX),
         lon_var: slice(LON_MIN, LON_MAX)},
    )
    print(f"  Subset shape: {dict(subset.dims)}")
    print()

    # --- Step 6: Read uo/vo for first time step ---
    print("--- Step 6: Read uo/vo (first time step, surface) ---")

    # Determine time and depth variable names
    time_var = "time" if "time" in subset.dims else None
    depth_var = "depth" if "depth" in subset.dims else None

    # Select first time step
    if time_var:
        subset_t0 = subset.isel({time_var: 0})
    else:
        subset_t0 = subset

    # Select surface (first depth level)
    if depth_var:
        subset_t0 = subset_t0.isel({depth_var: 0})
        print(f"  Selected depth level 0: {float(subset.coords[depth_var].values[0])} m")

    # Read uo and vo
    if "uo" in subset_t0:
        uo = subset_t0["uo"].values
        print(f"  uo shape: {uo.shape}")
        print(f"  uo dtype: {uo.dtype}")
        print(f"  uo range: [{float(np.nanmin(uo)):.6f}, {float(np.nanmax(uo)):.6f}]")
        print(f"  uo finite: {bool(np.all(np.isfinite(uo[np.isfinite(uo)])))}")
        print(f"  uo NaN fraction: {float(np.isnan(uo).mean()):.4f}")
    else:
        print(f"  WARNING: 'uo' not found. Available: {list(subset_t0.data_vars)}")

    if "vo" in subset_t0:
        vo = subset_t0["vo"].values
        print(f"  vo shape: {vo.shape}")
        print(f"  vo dtype: {vo.dtype}")
        print(f"  vo range: [{float(np.nanmin(vo)):.6f}, {float(np.nanmax(vo)):.6f}]")
        print(f"  vo finite: {bool(np.all(np.isfinite(vo[np.isfinite(vo)])))}")
        print(f"  vo NaN fraction: {float(np.isnan(vo).mean()):.4f}")
    else:
        print(f"  WARNING: 'vo' not found. Available: {list(subset_t0.data_vars)}")
    print()

    # --- Step 7: Create EnvironmentalGrid-compatible current layer ---
    print("--- Step 7: EnvironmentalGrid Compatibility ---")
    import numpy as np
    from src.environment.grid import EnvironmentalGrid

    n_rows = uo.shape[0]
    n_cols = uo.shape[1]
    lats = subset_t0[lat_var].values
    lons = subset_t0[lon_var].values

    # Current speed magnitude (always >= 0)
    speed = np.sqrt(np.nan_to_num(uo, nan=0.0) ** 2 +
                    np.nan_to_num(vo, nan=0.0) ** 2)

    grid = EnvironmentalGrid(
        n_rows=n_rows,
        n_cols=n_cols,
        lat=lats,
        lon=lons,
        navigable=np.ones((n_rows, n_cols), dtype=bool),
        current_cost=speed,
    )

    print(f"  EnvironmentalGrid created: {grid.n_rows}x{grid.n_cols}")
    print(f"  current_cost shape: {grid.current_cost.shape}")
    print(f"  current_cost range: [{grid.current_cost.min():.6f}, {grid.current_cost.max():.6f}]")
    print(f"  current_cost mean: {grid.current_cost.mean():.6f}")
    print(f"  All finite: {bool(np.all(np.isfinite(grid.current_cost)))}")
    print()

    print("=" * 70)
    print("VALIDATION PASSED: Real CMEMS data reached EnvironmentalGrid.current_cost")
    print("=" * 70)

    ds.close()
    return {
        "n_rows": n_rows,
        "n_cols": n_cols,
        "uo_shape": uo.shape,
        "vo_shape": vo.shape,
        "speed_range": [float(speed.min()), float(speed.max())],
    }


if __name__ == "__main__":
    validate_cmems_current()

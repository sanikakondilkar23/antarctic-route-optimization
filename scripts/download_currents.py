"""Download uo/vo using copernicusmarine.open_dataset - surface only."""
import copernicusmarine
import xarray as xr
import numpy as np
import os
import time

OUT_DIR = r'C:\Users\samee\Desktop\sic\backend\data\test_2026\cmems_north'
os.makedirs(OUT_DIR, exist_ok=True)

print('Opening dataset...')
t0 = time.time()
ds = copernicusmarine.open_dataset(
    dataset_id='cmems_mod_glo_phy_my_0.083deg_P1D-m',
    variables=['uo', 'vo'],
)
print(f'Opened in {time.time()-t0:.1f}s')
print('Depth values:', ds.depth.values[:5], '...')

# Select surface level (first depth = 0.494 m)
print('Selecting surface level (depth=0)...')
ds_sfc = ds[['uo', 'vo']].isel(depth=0)
print('After isel depth:', {k: v for k, v in ds_sfc.sizes.items()})

# Subset to extension band
print('Subsetting to extension band...')
sub = ds_sfc.sel(
    latitude=slice(-50, -32),
    longitude=slice(-10, 82),
    time=slice('2026-01-01', '2026-06-23'),
)
print('Subset shape:', {k: v for k, v in sub.sizes.items()})

# Load in time chunks to avoid OOM
print('Loading in time chunks...')
chunks = []
n_days = sub.sizes['time']
chunk_size = 30
for start in range(0, n_days, chunk_size):
    end = min(start + chunk_size, n_days)
    chunk = sub.isel(time=slice(start, end))
    print(f'  Days {start}-{end}...', end=' ', flush=True)
    t1 = time.time()
    chunk.load()
    print(f'{time.time()-t1:.1f}s')
    chunks.append(chunk)

print(f'All loaded in {time.time()-t0:.1f}s')

# Concatenate and save
result = xr.concat(chunks, dim='time')
print(f'uo range: {float(result.uo.min()):.4f} to {float(result.uo.max()):.4f}')
print(f'vo range: {float(result.vo.min()):.4f} to {float(result.vo.max()):.4f}')

out_path = os.path.join(OUT_DIR, 'ocean_north_2026.nc')
result.to_netcdf(out_path)
print(f'Saved: {out_path} ({os.path.getsize(out_path)/1e6:.1f} MB)')

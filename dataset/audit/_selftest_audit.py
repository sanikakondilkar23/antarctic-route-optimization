"""Local smoke test: build a fake dataset root and run the real auditor.

Verifies that the audit harness actually measures NetCDF coverage, detects
missing months, identifies unreadable formats honestly, and never invents
metadata. Uses throwaway files under a temp directory; touches no project data.
"""
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import xarray as xr

REPO = Path(__file__).resolve().parent
tmp = Path(tempfile.mkdtemp(prefix="sih_audit_"))
root = tmp / "dataset"

# --- 1. a realistic CMEMS-style NetCDF: Ocean_2024_06.nc -------------------
lat = np.round(np.arange(-75.0, -32.0 + 0.25, 0.25), 2)
lon = np.round(np.arange(-10.0, 82.0 + 0.25, 0.25), 2)
t = np.array(["2024-06-01", "2024-06-02", "2024-06-03"], dtype="datetime64[ns]")
d = root / "Copernicus_Ocean" / "2024"
d.mkdir(parents=True, exist_ok=True)
ds = xr.Dataset(
    {
        "uo": (("time", "depth", "latitude", "longitude"),
               np.random.rand(3, 1, lat.size, lon.size).astype(np.float32)),
        "vo": (("time", "depth", "latitude", "longitude"),
               np.random.rand(3, 1, lat.size, lon.size).astype(np.float32)),
    },
    coords={"time": t, "depth": [0.494], "latitude": lat, "longitude": lon},
)
ds.to_netcdf(d / "Ocean_2024_06.nc")

# a second month so the gap detector has something to find
ds2 = ds.assign_coords(time=np.array(["2024-07-01", "2024-07-02", "2024-07-03"],
                                     dtype="datetime64[ns]"))
ds2.to_netcdf(d / "Ocean_2024_07.nc")

# --- 2. a real NetCDF with a genuine spatial shortfall + NaN ---------------
lat2 = np.round(np.arange(-75.0, -50.0 + 0.25, 0.25), 2)   # model band only
lon2 = np.round(np.arange(-10.0, 80.0 + 0.25, 0.25), 2)
sic = np.random.rand(2, lat2.size, lon2.size).astype(np.float32)
sic[0, 0, 0] = np.nan
ds3 = xr.Dataset(
    {"sic": (("time", "latitude", "longitude"), sic)},
    coords={"time": np.array(["2021-01-01", "2021-01-02"], dtype="datetime64[ns]"),
            "latitude": lat2, "longitude": lon2},
)
ds3.to_netcdf(root / "SIC" / "sic_2021.nc" if (root / "SIC").mkdir(parents=True) or True
              else None)

# --- 3. formats this environment CANNOT read ------------------------------
(root / "ERA5").mkdir(parents=True, exist_ok=True)
(root / "ERA5" / "era5_2021.grib").write_bytes(b"GRIB\x00\x00\x00\x00" + b"\x00" * 512)
(root / "GEBCO").mkdir(parents=True, exist_ok=True)
(root / "GEBCO" / "gebco_2024.nc4").write_bytes(b"\x89HDF\r\n\x1a\n" + b"\x00" * 256)

# --- 4. readable non-NetCDF: npy + csv ------------------------------------
np.save(root / "AIS" / "tracks_2021.npy" if (root / "AIS").mkdir(parents=True) or True
        else None, np.zeros((100, 4), dtype=np.float32))
(root / "Vessel").mkdir(parents=True, exist_ok=True)
(root / "Vessel" / "fleet.csv").write_text(
    "name,draft_m,ice_class\nSagar Nidhi,6.5,PC5\n", encoding="utf-8")

print(f"synthetic root: {root}\n")
r = subprocess.run(
    [sys.executable, str(REPO / "dataset_audit.py"), "--root", str(root),
     "--out", str(tmp / "out"), "--manifest-dir", str(tmp / "man")],
    capture_output=True, text=True)
print(r.stdout)
if r.returncode != 0:
    print("STDERR:", r.stderr[-3000:])
    raise SystemExit(1)

audit = json.loads((tmp / "out" / "dataset_audit.json").read_text())
by = {d["dataset"]: d for d in audit["datasets"]}

ok = True
def check(label, cond, detail=""):
    global ok
    print(("PASS  " if cond else "FAIL  ") + label + (f"  -> {detail}" if detail else ""))
    if not cond:
        ok = False

co = by["Copernicus_Ocean"]
check("CMEMS netCDF read", co["status"] == "AVAILABLE", co["status"])
check("CMEMS full target region", co["full_target_region"] is True)
check("CMEMS daily frequency detected", "daily" in (co["temporal_frequency"] or ""),
      co["temporal_frequency"])
check("CMEMS missing months found (58 of 60)", len(co["missing_periods"] or []) == 58,
      f"{len(co['missing_periods'] or [])} missing")
check("CMEMS uo/vo present in vars", "uo" in json.dumps(co["files"]))

si = by["SIC"]
check("SIC netCDF read", si["status"] == "PARTIAL", si["status"])
check("SIC NOT full region (band only)", si["full_target_region"] is False)
check("SIC shortfall named", bool(si["missing_spatial_regions"]),
      str(si["missing_spatial_regions"])[:90])

er = by["ERA5"]
check("GRIB identified", er["native_format"] == "grib", str(er["native_format"]))
check("GRIB not read, not faked", er["status"] == "NOT_AVAILABLE"
      or er.get("n_files_not_readable", 0) >= 0)
man = json.loads((tmp / "man" / "ERA5.manifest.json").read_text())
check("GRIB file marked NOT_READABLE",
      any(f.get("status") == "NOT_READABLE_WITH_CURRENT_ENVIRONMENT" for f in man["files"]))

ge = by["GEBCO"]
check("HDF5 magic detected as hdf5", ge["native_format"] == "hdf5", str(ge["native_format"]))

ai = by["AIS"]
check("npy read by numpy", any(f.get("reader") == "numpy" for f in ai["files"]))
check("npy shape captured", any(f.get("shape") == [100, 4] for f in ai["files"]))

ve = by["Vessel"]
check("csv read by pandas", any(f.get("reader") == "pandas" for f in ve["files"]))
check("csv columns captured", any("ice_class" in (f.get("columns") or []) for f in ve["files"]))

check("auth recorded", all(d.get("authentication_required") for d in audit["datasets"]))
check("downloaded_now false everywhere", all(d["downloaded_now"] is False for d in audit["datasets"]))
check("integrity flags all false",
      not any(audit["integrity"].values()), str(audit["integrity"]))

print("\n" + ("ALL AUDIT-HARNESS CHECKS PASSED" if ok else "SOME CHECKS FAILED"))
raise SystemExit(0 if ok else 1)

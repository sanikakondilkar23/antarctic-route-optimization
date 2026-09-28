"""Self-test: does the dataset configuration actually resolve a Drive-shaped tree?

Builds a synthetic root that mimics the real Drive layout (including the
CMEMS 2025 consolidated 6-hourly file name) and asserts:

  * SIH_DATA_ROOT is honoured
  * the Google Drive default is used only when the mount exists
  * AIS resolves to AIS_GFW
  * per-dataset file counts / sizes are real
  * the CMEMS 2025 consolidated file is recognised, not treated as monthly
  * validation opens NetCDF without transforming it
  * nothing is downloaded, copied, moved, split or overwritten
  * with no root, the report says ROOT_UNRESOLVED and invents no path
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
import xarray as xr

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "dataset" / "audit" / "validate_datasets.py"

ok = True
def check(label, cond, detail=""):
    global ok
    print(("PASS  " if cond else "FAIL  ") + label + (f"  -> {detail}" if detail else ""))
    if not cond:
        ok = False


tmp = Path(tempfile.mkdtemp(prefix="sih_conn_"))
root = tmp / "dataset"

# --- SIC: monthly NetCDF ---------------------------------------------------
for y in (2024, 2025):
    for m in (1, 6, 12):
        d = root / "SIC" / str(y)
        d.mkdir(parents=True, exist_ok=True)
        lat = np.arange(-75.0, -50.01, 0.25)
        lon = np.arange(-10.0, 80.01, 0.25)
        ds = xr.Dataset(
            {"sic": (("time", "latitude", "longitude"),
                     np.random.rand(2, lat.size, lon.size).astype("float32"))},
            coords={"time": np.array([f"{y}-{m:02d}-01", f"{y}-{m:02d}-02"],
                                     dtype="datetime64[ns]"),
                    "latitude": lat, "longitude": lon})
        ds.to_netcdf(d / f"sic_{y}_{m:02d}.nc")
        ds.close()

# --- ERA5: grib files (presence only; not interpreted) --------------------
(root / "ERA5" / "2025").mkdir(parents=True)
for m in (1, 2, 3):
    (root / "ERA5" / "2025" / f"era5_2025_{m:02d}.grib").write_bytes(b"GRIB\x00" * 400)

# --- Copernicus: 2021-2024 monthly + 2025 single consolidated 6-hourly ----
for y in (2021, 2022, 2023, 2024):
    d = root / "Copernicus_Ocean" / str(y)
    d.mkdir(parents=True, exist_ok=True)
    for m in (1, 7):
        (d / f"Ocean_{y}_{m:02d}.nc").write_bytes(b"CDF\x01" + b"\0" * 3000)
d25 = root / "Copernicus_Ocean" / "2025"
d25.mkdir(parents=True, exist_ok=True)
# same NAME as the real 16.96 GB file, tiny stand-in: presence is what we test
(d25 / "CMEMS_Current_2025_6hourly.nc").write_bytes(b"CDF\x01" + b"\0" * 5000)

# --- the other six -------------------------------------------------------
(root / "CMEMS_Future_Forecast").mkdir(parents=True)
(root / "CMEMS_Future_Forecast" / "forecast_2025.nc").write_bytes(b"CDF\x01" + b"\0" * 800)
(root / "ICEBERGS").mkdir(parents=True)
(root / "ICEBERGS" / "icebergs_2025.csv").write_text("id,lat,lon\n1,-70.5,11.2\n")
(root / "AIS_GFW" / "2025").mkdir(parents=True)
(root / "AIS_GFW" / "2025" / "ais_2025.csv").write_text("mmsi,lat,lon\n123,-60,20\n")
(root / "GEBCO").mkdir(parents=True)
(root / "GEBCO" / "gebco_2024.nc").write_bytes(b"CDF\x01" + b"\0" * 1200)
(root / "Vessel").mkdir(parents=True)
(root / "Vessel" / "fleet.csv").write_text("name,draft_m\nSagar Nidhi,6.5\n")

before = {p: hashlib.sha256(p.read_bytes()).hexdigest()
          for p in root.rglob("*") if p.is_file()}
before_dirs = {p.parent for p in root.rglob("*")}

out = tmp / "out"
env = dict(os.environ, SIH_DATA_ROOT=str(root))
r = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True, env=env)
print(r.stdout)
if r.returncode != 0:
    print("STDERR:", r.stderr[-2500:])
    raise SystemExit(1)

rep = json.loads((REPO / "dataset" / "audit" / "dataset_connection.json").read_text())
by = {d["dataset"]: d for d in rep["datasets"]}

check("SIH_DATA_ROOT honoured", rep["dataset_location"]["resolved_root"] == str(root),
      rep["dataset_location"]["resolved_root"])
check("resolution reports the env var",
      rep["dataset_location"]["resolution"] == "$SIH_DATA_ROOT",
      rep["dataset_location"]["resolution"])
check("the 8 datasets present in the fixture are connected",
      rep["summary"]["connected"] == 8,
      f"{rep['summary']['connected']}/12 (4 not created in this fixture)")
check("datasets absent from the fixture are DIRECTORY_ABSENT, not fake",
      by["OSI_SAF"]["status"] == "DIRECTORY_ABSENT", by["OSI_SAF"]["status"])
check("SIC file count real", by["SIC"]["files"] == 6, str(by["SIC"]["files"]))
check("SIC NetCDF validated", by["SIC"]["validation"]["result"] == "VALIDATED",
      by["SIC"]["validation"]["result"])
check("SIC path points at <root>/SIC",
      by["SIC"]["connected_path"] == str(root / "SIC"), by["SIC"]["connected_path"])
check("ERA5 grib present, counted, not interpreted",
      by["ERA5"]["files"] == 3 and by["ERA5"]["validation"]["result"] == "VALIDATED")
check("Copernicus monthly files counted (8)",
      by["Copernicus_Ocean"]["files"] == 9, str(by["Copernicus_Ocean"]["files"]))
lay = by["Copernicus_Ocean"].get("cmems_2025_layout", {})
check("CMEMS 2025 consolidated recognised",
      lay.get("present") is True
      and lay.get("expected_file") == "CMEMS_Current_2025_6hourly.nc"
      and "6-hourly" in lay.get("note", ""),
      f"{lay.get('expected_file')} present={lay.get('present')}")
check("AIS resolves to AIS_GFW (not AIS)",
      by["AIS_GFW"]["connected_path"].endswith("AIS_GFW"),
      by["AIS_GFW"]["connected_path"])
check("sizes non-zero", rep["summary"]["total_size_bytes"] > 0,
      rep["summary"]["total_size_human"])
check("integrity flags all false", not any(rep["integrity"].values()),
      str(rep["integrity"]))

after = {p: hashlib.sha256(p.read_bytes()).hexdigest()
         for p in root.rglob("*") if p.is_file()}
check("no file modified or added", before == after,
      f"{len(before)} -> {len(after)} files")
check("no directory created inside the root (nothing split/copied)",
      before_dirs == {p.parent for p in root.rglob("*")})

# --- and with NO root it must refuse to invent one -----------------------
r2 = subprocess.run([sys.executable, str(SCRIPT)], capture_output=True, text=True,
                    env={k: v for k, v in os.environ.items() if k != "SIH_DATA_ROOT"})
rep2 = json.loads((REPO / "dataset" / "audit" / "dataset_connection.json").read_text())
check("no root -> resolved_root is null",
      rep2["dataset_location"]["resolved_root"] is None)
check("no root -> all ROOT_UNRESOLVED, no path invented",
      all(d["status"] == "ROOT_UNRESOLVED" and d["connected_path"] is None
          for d in rep2["datasets"]))
check("no root -> drive mount reported absent",
      rep2["dataset_location"]["drive_mount_present"] is False)

print("\n" + ("ALL DATASET-CONNECTION CHECKS PASSED" if ok else "SOME CHECKS FAILED"))
raise SystemExit(0 if ok else 1)

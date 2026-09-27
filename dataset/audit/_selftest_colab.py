"""Local self-test for colab_full_antarctic_download.py.

Builds a synthetic dataset root that mimics the known Drive layout
(Copernicus_Ocean with a partial set of Ocean_YYYY_MM.nc files, plus a
complete GEBCO) and asserts the script:

  * inventories before touching anything
  * never re-downloads a complete period
  * reports AUTH_REQUIRED instead of inventing credentials
  * writes download_manifest.json with integrity flags all false
  * leaves existing files byte-identical
"""
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "dataset" / "audit" / "colab_full_antarctic_download.py"

tmp = Path(tempfile.mkdtemp(prefix="sih_colab_"))
root = tmp / "MyDrive" / "SIH_26_Sanika" / "dataset"
out = tmp / "out"

# partial CMEMS: 2024-06 and 2024-07 only (the known example file is one of these)
co = root / "Copernicus_Ocean"
(co / "2024").mkdir(parents=True)
for m in ("06", "07"):
    (co / "2024" / f"Ocean_2024_{m}.nc").write_bytes(b"CDF\x01" + b"\0" * 2048)

# complete 60-month SIC
sic = root / "SIC"
for y in range(2021, 2026):
    for m in range(1, 13):
        d = sic / str(y) / "source"
        d.mkdir(parents=True, exist_ok=True)
        (d / f"sic_{y}_{m:02d}.nc").write_bytes(b"CDF\x01" + b"\0" * 512)

# static GEBCO, open access
(root / "GEBCO").mkdir(parents=True)
(root / "GEBCO" / "gebco_2024.nc").write_bytes(b"CDF\x01" + b"\0" * 1024)

before = {p: hashlib.sha256(p.read_bytes()).hexdigest()
          for p in root.rglob("*") if p.is_file()}

r = subprocess.run(
    [sys.executable, str(SCRIPT), "--root", str(root), "--no-mount",
     "--out", str(out)],
    capture_output=True, text=True)
print(r.stdout)
if r.returncode != 0:
    print("STDERR:", r.stderr[-2500:])
    raise SystemExit(1)

man = json.loads((out / "download_manifest.json").read_text())
by = man["missing_plan"]["datasets"]

ok = True
def check(label, cond, detail=""):
    global ok
    print(("PASS  " if cond else "FAIL  ") + label + (f"  -> {detail}" if detail else ""))
    if not cond:
        ok = False

check("inventory ran first", man["inventory"]["exists"] is True)
check("Copernicus_Ocean counted", by["Copernicus_Ocean"]["file_count"] == 2,
      str(by["Copernicus_Ocean"]["file_count"]))
check("CMEMS missing months = 58", by["Copernicus_Ocean"]["n_missing_months"] == 58,
      str(by["Copernicus_Ocean"]["n_missing_months"]))
check("SIC complete -> skipped", by["SIC"]["action"] == "ALREADY_AVAILABLE",
      by["SIC"]["action"])
check("GEBCO complete -> skipped", by["GEBCO"]["action"] == "ALREADY_AVAILABLE",
      by["GEBCO"]["action"])
check("CMEMS needs auth -> AUTH_REQUIRED",
      by["Copernicus_Ocean"]["auth_status"] == "AUTH_REQUIRED",
      by["Copernicus_Ocean"]["auth_status"])
check("ERA5 needs auth -> AUTH_REQUIRED",
      by["ERA5"]["auth_status"] == "AUTH_REQUIRED", by["ERA5"]["auth_status"])
check("no credentials fabricated",
      all(v is False for v in man["integrity"].values()), str(man["integrity"]))
check("protected artifacts located in repo",
      man["protected_artifacts"]["all_present"] is True)

after = {p: hashlib.sha256(p.read_bytes()).hexdigest()
         for p in root.rglob("*") if p.is_file()}
check("existing files byte-identical (nothing overwritten)", before == after,
      f"{len(before)} files unchanged")
check("nothing new written into the dataset root",
      set(before) == set(after), f"{len(set(after) - set(before))} new files")

print("\n" + ("ALL COLAB-SCRIPT CHECKS PASSED" if ok else "SOME CHECKS FAILED"))
raise SystemExit(0 if ok else 1)

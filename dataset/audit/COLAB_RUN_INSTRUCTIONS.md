# Running the Antarctic dataset audit & download from Google Colab

The dataset root `/content/drive/MyDrive/SIH_26_Sanika/dataset/` is on Google
Drive. It is only reachable from a machine that has Drive mounted — in practice
**Google Colab**. The Windows dev box cannot see it, and must not try to
fabricate the path.

This runbook is copy-paste. Every cell is complete; nothing needs guessing.

---

## What you will produce

| File | Meaning |
|---|---|
| `dataset_audit.json` | per-dataset status, measured coverage, missing periods, auth requirement |
| `download_manifest.json` | inventory, missing plan, download results, integrity flags, protected-artifact hashes |
| `manifests/<DATASET>.manifest.json` | one entry per file with size + SHA-256 |

---

## STEP 1 — Open a Colab notebook

<https://colab.research.google.com/> → **File → New notebook**.

Runtime → **Change runtime type** → **T4 GPU** (CPU works too; the audit is
I/O bound, not compute bound).

---

## STEP 2 — Mount Google Drive

Run this cell and click **Connect to Google Drive** when prompted:

```python
from google.colab import drive
drive.mount('/content/drive', force_remount=True)

from pathlib import Path
ROOT = Path('/content/drive/MyDrive/SIH_26_Sanika/dataset')
print('drive mounted :', Path('/content/drive').is_dir())
print('dataset root  :', ROOT)
print('root exists   :', ROOT.is_dir())
if ROOT.is_dir():
    for p in sorted(ROOT.iterdir()):
        print('  ', p.name, '(dir)' if p.is_dir() else f'{p.stat().st_size} B')
```

If `root exists` is `False`, stop and check the folder name in Drive. Do not
continue with a wrong path.

---

## STEP 3 — Get the repository code

Clone the repo into Colab's local disk (fast) — **do not run the audit from
inside Drive**, Drive is slow and the outputs are easier to collect from the
repo.

```python
!git clone https://github.com/<YOUR-ORG>/<YOUR-REPO>.git /content/SIH
```

If the repo is private, authenticate first:

```python
from google.colab import userdata
token = userdata.get('GITHUB_TOKEN')   # add it in Colab Secrets first
!git clone https://x-access-token:{token}@github.com/<YOUR-ORG>/<YOUR-REPO>.git /content/SIH
```

Then set the two paths the scripts expect:

```python
DATASET_ROOT = '/content/drive/MyDrive/SIH_26_Sanika/dataset'
REPO = Path('/content/SIH')
print(REPO, REPO.is_dir())
```

---

## STEP 4 — Install dependencies

```python
!pip -q install numpy xarray netCDF4 pandas pyarrow
```

Optional, only if you also want GRIB / HDF5 / Zarr / GeoTIFF files *read*
rather than reported as unreadable:

```python
!pip -q install cfgrib eccodes h5py zarr rasterio
```

Without those, the audit still runs: those files are identified by format and
marked `NOT_READABLE_WITH_CURRENT_ENVIRONMENT`, with their size and path
recorded. It never guesses their contents either way.

---

## STEP 5 — Inventory FIRST (downloads nothing)

```python
!python {REPO}/dataset/audit/colab_full_antarctic_download.py \
    --root {DATASET_ROOT} --no-mount --inventory-only \
    --out {DATASET_ROOT}/audit
```

Read the output before continuing. You are looking for:

* `PHASE 1` — how many files and bytes already exist per dataset
* `PHASE 2` — per dataset: `ALREADY_AVAILABLE` / `AUTH_REQUIRED` / `CANDIDATE`,
  and how many of the 60 target months are missing

---

## STEP 6 — Full audit (measures real coverage)

```python
!python {REPO}/dataset/audit/dataset_audit.py \
    --root {DATASET_ROOT} \
    --out {DATASET_ROOT}/audit \
    --manifest-dir {DATASET_ROOT}/audit/manifests
```

This opens every NetCDF and reports **measured** latitude/longitude extent,
0.25°-vs-other spacing, 0–360 longitude convention, depth levels, native
timestamps, real frequency, and which months of 2021-01…2025-12 are absent.

Drop `--no-hash` if SHA-256 of every file is too slow on a large tree.

---

## STEP 7 — Download the missing pieces

```python
!python {REPO}/dataset/audit/colab_full_antarctic_download.py \
    --root {DATASET_ROOT} --no-mount \
    --out {DATASET_ROOT}/audit
```

### About credentials

The script **will not** invent a key or create a fake file. For any dataset
whose provider needs a login, it prints `AUTH_REQUIRED` and skips it. To enable
those, do it yourself:

| Dataset | Credential | How |
|---|---|---|
| SIC (NSIDC) | Earthdata | `!echo "machine <user>.data.nsidc.earthdata.nasa.gov" >> ~/.netrc` then `!chmod 600 ~/.netrc` |
| ERA5 / ECMWF_ENS | CDS key | upload `~/.cdsapirc` via Colab's file uploader |
| CMEMS (3 dirs) | Marine account | `pip install copernicusmarine` then `copernicusmarine login` |
| OSI SAF | none | — |
| GEBCO | none | — |

Then re-run STEP 7. Already-present files are never re-fetched; the script
skips them and says so.

---

## STEP 8 — Re-audit to measure what arrived

```python
!python {REPO}/dataset/audit/dataset_audit.py \
    --root {DATASET_ROOT} \
    --out {DATASET_ROOT}/audit \
    --manifest-dir {DATASET_ROOT}/audit/manifests
```

Compare against STEP 6: `file_count`, `coverage_start/end`, `missing_periods`
and `status` should have improved. Anything still `PARTIAL` or `NOT_AVAILABLE`
is reported as such — it is not quietly upgraded.

---

## STEP 9 — Bring the results back to the Windows repo

The three audit scripts also work on Windows, against a synced or mirrored
copy of the dataset. From PowerShell:

```powershell
cd C:\Users\Sanika\OneDrive\Desktop\SIH_2026\antarctic_route_optimization
python dataset\audit\dataset_audit.py --root <path-to-mirrored-dataset>
python dataset\audit\antarctic_coverage.py
```

To pull the Colab outputs into the Windows repo, in Colab:

```python
from google.colab import files
files.download('/content/drive/MyDrive/SIH_26_Sanika/dataset/audit/dataset_audit.json')
files.download('/content/drive/MyDrive/SIH_26_Sanika/dataset/audit/download_manifest.json')
```

or, without downloading by hand, copy them onto OneDrive (which is what the
Windows box syncs):

```python
!mkdir -p /content/drive/MyDrive/SIH_26_Sanika/audit_results
!cp {DATASET_ROOT}/audit/*.json /content/drive/MyDrive/SIH_26_Sanika/audit_results/
```

---

## STEP 10 — Confirm nothing protected was touched

Run this in Colab and compare with the baseline in the repo:

```python
import hashlib, json
from pathlib import Path
protected = [
    "backend/cache/routing_sic_2026.npy",
    "backend/cache/uncertainty_2026.npy",
    "outputs/ml/route_policy.pt",
    "outputs/ml/route_policy_validation.json",
    "outputs/final_demo/final_route.json",
    "outputs/final_demo/final_system_validation.json",
]
def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()

out = {}
for rel in protected:
    p = REPO / rel
    out[rel] = sha(p) if p.is_file() else 'MISSING'
    print(f'{out[rel][:16]}...  {rel}')
(REPO / 'dataset/audit/protected_sha256_after.json').write_text(json.dumps(out, indent=2))
print('\nwrote protected_sha256_after.json')
```

Those must match the baseline recorded on the Windows box. If any differ,
**stop** and report it — do not continue.

---

## Local self-tests (no Drive needed)

Both audit scripts ship with self-tests that run anywhere:

```bash
python dataset/audit/_selftest_audit.py    # audit harness against a synthetic root
python dataset/audit/_selftest_colab.py   # inventory/plan/guard against a fake Drive
```

They build throwaway fixtures in `%TEMP%`, assert the real behaviour
(NetCDF measured, GRIB marked unreadable, missing months found, nothing
overwritten, no credentials fabricated) and clean up after themselves. They
touch no project data.

---

## What these scripts will never do

* fabricate or interpolate data
* zero-fill or mean-fill NaN
* resize or regrid anything to 173×369
* invent timestamps
* overwrite an existing file
* create a credential
* retrain a model or regenerate a route artifact

If a dataset is partial it is reported `PARTIAL`. If it is missing it is
reported `MISSING`. If it needs a login it is reported `AUTH_REQUIRED`. Those
answers are the deliverable.

> **Imported provenance document.** Source: https://github.com/sakshidas1-ux/sar-iceberg-detection branch `feature/aurora-iceberg-model`. Paths in this file refer to the source repository layout; the AURORA equivalents are `backend/aurora/iceberg/`, `models/iceberg/` and `docs/iceberg/`.

# ICEBERG AUDIT â€” sar-iceberg-detection (AURORA Phase 1â€“5)

Generated: 2026-09-28 Â· Repository: `sar-iceberg-detection` @ `main` (b8fd759, clean)

## Dataset

| Item | Finding |
|---|---|
| Dataset | **NOT FOUND** on this machine |
| Location declared | `data.yaml` â†’ `D:/sar-iceberg-detection/dataset` (absent) |
| Second config | `data_v2_backup.yaml` â†’ `D:/sar-iceberg-detection/dataset_v2` (absent) |
| Also absent | `tiles/`, `tiles_*/`, `tiles_filtered/`, `dataset/`, `dataset_v2/`, `dataset_v3/` |
| In git history? | No â€” `dataset/`, `dataset_v2/`, `tiles*/`, `runs/` are in `.gitignore` and were never committed (verified `git log --stat` on all 3 commits, `git ls-files`) |
| Elsewhere on disk | Searched `C:\Users\Sanika` (48 s recursive) and all of `D:\` for `tile_y*.png` / `dataset*` â†’ 0 hits |

**Documented dataset properties (from README â€” not verifiable here):** 512Ã—512 PNG tiles,
YOLO labels (`class xc yc w h`, normalized), single class `0 = iceberg`,
211/60/31 train/val/test images, 46 labeled images, 112 boxes, split seed 42.

**Scripts found:** `download_sar.py`, `tile_sar.py`, `filter_tiles.py`, `speckle_filter.py`,
`combine_datasets.py`, `split_dataset.py`, `train_longer.py`, `demo.py`, `visualize_sar.py`.
**No** evaluation script and **no** inference server existed before this run.
**No** `requirements.txt` (README references one â€” audit finding).

## Train / Validation / Test

- Not present locally â†’ cannot be counted, split-checked or leakage-checked.
- `evaluate_checkpoint.py` and `validate_dataset.py` were added to run both the moment
  `dataset/` is restored.

## Classes

`{0: iceberg}` â€” from `data.yaml`, `data_v2_backup.yaml` and the checkpoint itself (consistent).

## Existing checkpoint

`best_sar_iceberg_model.pt` (6,249,322 B) and `submission_artifacts/best_sar_iceberg_model.pt`
are **byte-identical** (SHA256 `75e153cbâ€¦55af461`). Full report: `evaluation/checkpoint_report.json`.

## Training framework

Ultralytics YOLOv8-nano, saved with ultralytics 8.4.155, loadable under installed 8.4.164,
PyTorch 2.14.0+cpu, Python 3.11.9, CPU-only (no CUDA device).

## Existing metrics (stored *inside* the checkpoint at training time â€” not re-measured)

mAP50 0.5202 Â· mAP50-95 0.18031 Â· Precision 0.82846 Â· Recall 0.5393 Â·
val box/cls/dfl loss 3.66633 / 4.98951 / 3.58283. Matches `submission_artifacts/metrics.txt`.

## Inference capability

Verified working (see `evaluation/performance.json`, tests). On the 32 committed sample
tiles at conf â‰¥ 0.25 â†’ 0 detections; at conf 0.10 â†’ 7 detections (max conf 0.223).

## Decision (Phase 5)

Training **NOT PERFORMED**: the checkpoint is a complete final model with stored validation
metrics, and no dataset exists to train or validate against. Retraining here would be
impossible without fabricating data.

`train_longer.py` has since been repaired so it *can* run once a dataset is restored. It now
resolves its starting weights from `AURORA_ICEBERG_INIT` / `AURORA_ICEBERG_MODEL` /
`./best_sar_iceberg_model.pt` / the original `runs/detect/train/weights/best.pt`, writes only to
`runs/aurora_iceberg/`, and prints the starting checkpoint's SHA256 before and after training to
prove `best_sar_iceberg_model.pt` was not modified. With no dataset present it exits with a
precise message instead of starting an unusable run. Verified: `python train_longer.py --dry-run`.

---

## BLOCKER â€” georeference is discarded by the tiling step

This is the most consequential finding in the audit and it constrains everything downstream.

`tile_sar.py` opens the source GeoTIFF with `rasterio`, which exposes an affine
scene-to-Earth transform. The script then saves each tile with:

```python
cv2.imwrite(str(OUTPUT_DIR / tile_name), tile)
```

`cv2.imwrite` writes a plain PNG: **no CRS, no geotransform, no GCPs**. The affine that
`rasterio` read is never captured and never written. Tile filenames encode only the pixel
offset inside the scene:

```
tiles_S1A_EW_GRDM_.../tile_y00000_x05376.png
                         ^^^^^^ ^^^^^ pixel row / column offset, not a coordinate
```

Consequence: **this repository cannot place a single detection on a map.** A detection is a
bounding box in tile pixel space with no recoverable path to longitude/latitude. To geolocate
one, the original Sentinel-1 metadata must be re-read and the transform re-derived per tile.

`aurora_inference.AuroraIcebergDetector.detect()` therefore returns pixel geometry only, and
`iceberg_risk_adapter` returns `location: null` with `location_source: "pixel_only"` whenever the
caller supplies no georeference. That is deliberate: deriving a plausible-looking position
without the transform would be fabrication.

### What is needed to close it

1. Re-tile with the transform persisted, e.g. a sidecar JSON per tile:
   `{"transform": [a, b, c, d, e, f], "crs": "EPSG:4326", "scene": "<product name>"}`,
   or write GeoTIFF tiles instead of PNG.
2. Supply that sidecar to `iceberg_risk_adapter.for_route_optimizer(..., georeference=...)`.
3. Only then can `build_risk_layer` emit a risk field, and only with an approved risk model.

Until then the AURORA iceberg risk interface is **INTEGRATION READY**, never READY.

---

## BLOCKER â€” possible train/val/test leakage (pre-existing)

The README states the split has *"no scene overlap between splits to prevent data leakage"*.
That claim cannot be verified without the dataset, and the code does not implement it:
`split_dataset.py` and `combine_datasets.py` both `random.shuffle` a flat tile list with
`seed=42`. Because `tile_sar.py` tiles with **64 px overlap**, neighbouring tiles of the same
scene â€” and the same scene across the EW and IW sources in `combine_datasets.py` â€” can land in
different splits, which inflates validation metrics.

Reported, not changed: altering the split would invalidate comparison with the checkpoint's
recorded metrics, and the dataset needed to verify it is absent. `combine_datasets.py` now prints
a warning at run time.

---

## Other audit findings

| Item | Finding |
|---|---|
| `requirements.txt` | Was missing despite README step 1 referencing it. Added. |
| Evaluation script | None existed; README step 7 was an inline `python -c`. `evaluate_checkpoint.py` added. |
| Absolute paths | `data.yaml`, `data_v2_backup.yaml`, `combine_datasets.py` hardcoded `D:/sar-iceberg-detection/...`. Now relative / env-configurable. |
| Parameter count | README claims 3,005,843; the checkpoint's actual `sum(p.numel())` is **3,011,043**. Checkpoint is authoritative. |
| Inference speed | README claims 26.5 ms/tile CPU. **Not reproduced** â€” measured 334â€“1031 ms/image at `imgsz 640` on this machine (see `evaluation/performance.json`). |
| Checkpoint SHA256 | `75e153cb3e3754c4ff47318ec9f160bfe39b8933455db0b4f7d01b46e55af461` â€” unchanged by this work. |


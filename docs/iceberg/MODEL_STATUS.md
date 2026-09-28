> **Imported provenance document.** Source: https://github.com/sakshidas1-ux/sar-iceberg-detection branch `feature/aurora-iceberg-model`. Paths in this file refer to the source repository layout; the AURORA equivalents are `backend/aurora/iceberg/`, `models/iceberg/` and `docs/iceberg/`.

# AURORA ICEBERG MODEL STATUS

Generated: 2026-09-28 Â· Machine: Windows 11, Python 3.11.9, `torch 2.14.0+cpu` (no CUDA)

```
============================================================
AURORA ICEBERG MODEL STATUS
============================================================
Repository audit:   PASS
Dataset found:      NO
Dataset validated:  BLOCKED  (validate_dataset.py added; dataset root missing)
Existing checkpoint: OK â€” complete trained model, byte-identical in root and
                     submission_artifacts/, SHA256 75e153cbâ€¦55af461,
                     ultralytics 8.4.155, YOLOv8-nano, nc=1 {0: iceberg},
                     3,011,043 params, imgsz 640, saved 2026-09-19,
                     stripped best checkpoint (epoch=-1, no optimizer state)
Existing model inference: PASS (loads, predicts, handles 0 detections)
Baseline evaluation: BLOCKED â€” no validation/test data on this machine.
                     Stored-at-training metrics recorded (below), never re-measured.
Additional training: NOT REQUIRED / BLOCKED â€” final model already exists and no
                     dataset exists to train or validate against. Nothing retrained;
                     best_sar_iceberg_model.pt unmodified (SHA256 verified after runs).
Final model:        best_sar_iceberg_model.pt
Training metrics:   not re-derived here. Stored at training time inside the
                    checkpoint: precision 0.82846, recall 0.5393,
                    mAP50 0.5202, mAP50-95 0.18031
Validation metrics: val/box_loss 3.66633, val/cls_loss 4.98951, val/dfl_loss 3.58283
                    (same source: checkpoint train_metrics)
Test metrics:       BLOCKED (test split unavailable)
Inference interface: PASS â€” aurora_inference.py / aurora_api.py
Iceberg risk interface: INTEGRATION READY â€” iceberg_risk_adapter.py returns
                    detections + confidence only; no risk/trajectory fabricated
AURORA integration: PASS â€” POST /api/icebergs/detect + docs/AURORA_INTEGRATION.md
Tests:              PASS â€” 13 passed (python -m pytest tests/ -q)
Git branch:         feature/aurora-iceberg-model
Git push:           PASS â€” pushed to origin/feature/aurora-iceberg-model (main untouched);
                    PR link offered by remote: https://github.com/sakshidas1-ux/sar-iceberg-detection/pull/new/feature/aurora-iceberg-model
Remaining blockers:
  1. dataset/ absent â†’ dataset validation, baseline mAP, test metrics,
     and any further training stay blocked until tiles + YOLO labels are restored
  2. no georeference: tile_sar.py writes plain PNGs via cv2.imwrite(), so
     detections cannot be placed on a lat/lon map without the scene transform
  3. no GPU on this machine â†’ latency is CPU-bound (see below)
============================================================
```

## Evidence

| Item | File |
|---|---|
| Audit | `docs/ICEBERG_AUDIT.md` |
| Checkpoint inspection | `evaluation/checkpoint_report.json` (`inspect_checkpoint.py`) |
| Dataset validation | `evaluation/dataset_validation.json` (`validate_dataset.py`) |
| Baseline evaluation | `evaluation/baseline_evaluation.json` (`evaluate_checkpoint.py`) |
| Training decision | `evaluation/training_decision.json` |
| Performance (measured) | `evaluation/performance.json` (`benchmark_inference.py`) |
| Integration contract | `docs/AURORA_INTEGRATION.md` |
| Tests | `tests/test_aurora_iceberg.py` â€” 13 passed |

## Performance (measured on this machine, CPU, batch 1, imgsz 640)

mean 1030.8 ms Â· median 878.3 ms Â· min 615.5 ms Â· max 1916.5 ms over 8 sample tiles;
blank/empty image 2106 ms â†’ 0 detections, no error. GPU: not available (CPU-only torch
build). No real-time claim.

## Git

Branch `feature/aurora-iceberg-model` (main untouched). Commits, in order:

1. `audit: document iceberg dataset and model`
2. `test: validate existing iceberg checkpoint`
3. `feat: add clean iceberg inference interface`
4. `feat: add iceberg integration contract`
5. `train: record verified training decision - no retrain, dataset unavailable`
6. `test: add iceberg inference tests`
7. `fix: make repository runnable on any machine`
8. `docs: correct README metrics and document the georeference blocker`
9. `docs: document AURORA iceberg integration`

No datasets or `runs/` artifacts committed (both are gitignored; no new weights were
produced). `best_sar_iceberg_model.pt` is untouched.

## Unblocking training

Restore `dataset/{images,labels}/{train,val,test}` (211/60/31 images, 46 labeled,
112 boxes), then:

```bash
python validate_dataset.py        # dataset report
python evaluate_checkpoint.py     # real baseline mAP on this machine
python train_longer.py --dry-run  # plan; then drop --dry-run to train
```


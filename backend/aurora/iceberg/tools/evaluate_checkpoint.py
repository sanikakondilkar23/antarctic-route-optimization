"""
Baseline evaluation of best_sar_iceberg_model.pt using the project's own
Ultralytics validation pipeline.

Runs ONLY if the dataset declared in data.yaml exists on this machine.
If it does not, status = BLOCKED and no metrics are invented.

This AURORA import does not carry the dataset, so on a fresh clone the script
correctly reports BLOCKED while still recording the metrics stored inside the
checkpoint at training time.

Writes <reports>/baseline_evaluation.json.

Usage:
    python backend/aurora/iceberg/tools/evaluate_checkpoint.py [data.yaml] [checkpoint.pt]
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[4]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.aurora.iceberg import paths as iceberg_paths


def main() -> int:
    data_yaml = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / "data.yaml")
    ckpt = Path(sys.argv[2] if len(sys.argv) > 2 else iceberg_paths.model_path())
    out = iceberg_paths.reports_dir() / "baseline_evaluation.json"

    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "checkpoint": str(ckpt),
        "data_yaml": str(data_yaml),
        "status": "BLOCKED",
        "metrics_measured": None,
        "metrics_stored_at_training": None,
        "blockers": [],
    }

    if not ckpt.exists():
        report["blockers"].append(f"checkpoint not found: {ckpt}")
    else:
        # stored metrics (from the checkpoint itself, recorded at training time)
        import torch
        c = torch.load(ckpt, map_location="cpu", weights_only=False)
        report["metrics_stored_at_training"] = c.get("train_metrics")
        report["checkpoint_date"] = c.get("date")

    if not data_yaml.exists():
        report["blockers"].append(f"data config not found: {data_yaml}")
        out.write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))
        return 2

    cfg = yaml.safe_load(data_yaml.read_text())
    root = Path(cfg.get("path", "."))
    if not root.is_absolute():
        root = (data_yaml.parent / root).resolve()
    report["dataset_root"] = str(root)
    if not root.exists():
        report["blockers"].append(f"dataset root missing: {root}")

    if report["blockers"]:
        report["blockers"].insert(0, "validation dataset unavailable on this machine")
        out.write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))
        return 2

    from ultralytics import YOLO
    model = YOLO(str(ckpt))
    results = model.val(data=str(data_yaml), split="val", verbose=False, plots=False)
    report["metrics_measured"] = {
        "precision": float(results.box.mp),
        "recall": float(results.box.mr),
        "mAP50": float(results.box.map50),
        "mAP50-95": float(results.box.map),
        "val_box_loss": float(results.box.loss if hasattr(results.box, "loss") else 0.0),
        "images": int(results.stats.shape[1]) if results.stats is not None else None,
    }
    report["speed_ms_per_image"] = {
        "preprocess": float(results.speed["preprocess"]),
        "inference": float(results.speed["inference"]),
        "postprocess": float(results.speed["postprocess"]),
    }
    report["status"] = "PASS"
    out.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""
Inspect best_sar_iceberg_model.pt without modifying it.

Writes a machine-readable report to evaluation/checkpoint_report.json.
All values are read from the checkpoint itself -- nothing is invented.

Usage:
    python inspect_checkpoint.py [path/to/checkpoint.pt]
"""
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import torch

from backend.aurora.iceberg import paths as iceberg_paths

DEFAULT_CKPT = iceberg_paths.model_path()
OUT_DIR = iceberg_paths.reports_dir()


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _jsonable(obj):
    if isinstance(obj, torch.Tensor):
        return obj.detach().cpu().tolist()
    if isinstance(obj, dict):
        return {str(k): _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    if isinstance(obj, (int, float, str, bool)) or obj is None:
        return obj
    return str(obj)


def inspect(path: Path) -> dict:
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    if not isinstance(ckpt, dict):
        raise TypeError(f"Unexpected checkpoint type: {type(ckpt)}")

    model = ckpt.get("model")
    report = {
        "checkpoint_path": str(path),
        "checkpoint_size_bytes": path.stat().st_size,
        "checkpoint_sha256": sha256(path),
        "checkpoint_type": "ultralytics YOLO detection checkpoint (state dict + model object)",
        "saved_date": ckpt.get("date"),
        "ultralytics_version_at_save": ckpt.get("version"),
        "epoch_field": ckpt.get("epoch"),
        "best_fitness_field": ckpt.get("best_fitness"),
        "has_model_object": model is not None,
        "has_ema_weights": ckpt.get("ema") is not None,
        "has_optimizer_state": ckpt.get("optimizer") is not None,
        "is_stripped_best_checkpoint": ckpt.get("epoch") == -1 and ckpt.get("optimizer") is None,
        "architecture": type(model).__name__ if model is not None else None,
        "class_count": getattr(model, "nc", None),
        "class_names": getattr(model, "names", None),
        "stride": _jsonable(getattr(model, "stride", None)),
        "parameter_count": int(sum(p.numel() for p in model.parameters())) if model is not None else None,
        "train_args": _jsonable(ckpt.get("train_args")),
        "metrics_stored_at_training": _jsonable(ckpt.get("train_metrics")),
        "training_history_available": ckpt.get("train_results") is not None,
        "git_metadata": _jsonable(ckpt.get("git")),
    }

    train_args = ckpt.get("train_args") or {}
    report["input_size"] = train_args.get("imgsz")
    report["trained_epochs"] = train_args.get("epochs")
    report["base_model"] = train_args.get("model")
    report["data_config"] = train_args.get("data")
    report["batch_size"] = train_args.get("batch")
    report["seed"] = train_args.get("seed")
    report["deterministic"] = train_args.get("deterministic")
    report["optimizer"] = train_args.get("optimizer")
    report["patience"] = train_args.get("patience")
    report["inference_defaults_stored"] = {
        "conf": train_args.get("conf"),
        "iou": train_args.get("iou"),
        "max_det": train_args.get("max_det"),
    }
    return report


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_CKPT
    if not path.exists():
        print(f"ERROR: checkpoint not found: {path}")
        return 1

    report = inspect(path)
    report["generated_at_utc"] = datetime.now(timezone.utc).isoformat()

    OUT_DIR.mkdir(exist_ok=True)
    out = OUT_DIR / "checkpoint_report.json"
    out.write_text(json.dumps(report, indent=2))

    print(f"Checkpoint : {report['checkpoint_path']}")
    print(f"SHA256     : {report['checkpoint_sha256']}")
    print(f"Saved      : {report['saved_date']} (ultralytics {report['ultralytics_version_at_save']})")
    print(f"Model      : {report['architecture']} | {report['class_names']} | params={report['parameter_count']}")
    print(f"Input size : {report['input_size']} | epochs={report['trained_epochs']} | seed={report['seed']}")
    print(f"Stripped   : {report['is_stripped_best_checkpoint']}")
    print(f"Stored metrics: {report['metrics_stored_at_training']}")
    print(f"Report written: {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

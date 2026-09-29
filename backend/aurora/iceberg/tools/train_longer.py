"""
Continue training from the existing trained weights.

Originally this script loaded ``runs/detect/train/weights/best.pt``. That path
is inside ``runs/``, which is git-ignored, so on a fresh clone the script could
not run at all. It now resolves its starting weights from, in order:

1. ``$AURORA_ICEBERG_INIT``  - explicit override
2. ``$AURORA_ICEBERG_MODEL`` - the shipped checkpoint
3. ``./best_sar_iceberg_model.pt``
4. ``./runs/detect/train/weights/best.pt`` - the original Round-1 location

Safety guarantees, enforced below:

* ``best_sar_iceberg_model.pt`` is never written. It is only ever read, and the
  SHA256 of whatever we started from is printed before training so the baseline
  is provably untouched afterwards.
* All new artifacts go to ``runs/aurora_iceberg/``, a separate directory, so a
  new run can never clobber an older one.
* ``exist_ok=False`` plus an explicit incrementing name means two runs never
  silently share an output folder.

Usage:
    python train_longer.py                 # resume from the shipped checkpoint
    python train_longer.py --epochs 100    # override the epoch budget
    python train_longer.py --dry-run       # resolve everything, train nothing

This script REQUIRES a dataset. Without ``AURORA_ICEBERG_DATASET`` pointing at
a populated YOLO dataset it exits with a clear message rather than starting a
run that cannot produce a meaningful validation score.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]

#: Never written by this script. Read-only, always.
SHIPPED_CHECKPOINT = REPO_ROOT / "models" / "iceberg" / "best_sar_iceberg_model.pt"

#: New artifacts go here, separate from any earlier runs.
PROJECT_DIR = Path(os.environ.get("AURORA_ICEBERG_PROJECT", "runs/aurora_iceberg"))

#: Matches the imgsz the shipped checkpoint was trained at.
IMGSZ = 640
BATCH = 8


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def resolve_init_weights() -> Path:
    """Pick the weights to continue from. Raises FileNotFoundError if none."""
    candidates = [
        Path(os.environ["AURORA_ICEBERG_INIT"]) if os.environ.get("AURORA_ICEBERG_INIT") else None,
        Path(os.environ["AURORA_ICEBERG_MODEL"]) if os.environ.get("AURORA_ICEBERG_MODEL") else None,
        SHIPPED_CHECKPOINT,
        REPO_ROOT / "runs" / "detect" / "train" / "weights" / "best.pt",
    ]
    for candidate in candidates:
        if candidate is not None and candidate.is_file():
            return candidate
    raise FileNotFoundError(
        "no starting weights found. Looked for: "
        + ", ".join(str(c) for c in candidates if c is not None)
        + ". Set AURORA_ICEBERG_INIT to an explicit checkpoint path."
    )


def resolve_dataset() -> Path:
    """
    Locate the YOLO dataset root.

    ``data.yaml`` uses a repository-relative ``path:``, so Ultralytics resolves
    it against the dataset file's own location. This helper only reports what it
    is, so the script can fail with a precise message when it is missing.
    """
    from pathlib import Path as _Path

    root = _Path(os.environ.get("AURORA_ICEBERG_DATASET", REPO_ROOT / "dataset"))
    if not root.is_dir():
        raise FileNotFoundError(
            f"dataset root not found: {root}\n"
            "Training is not possible without the annotated tiles and YOLO "
            "labels. Set AURORA_ICEBERG_DATASET to the dataset directory, or "
            "restore it from the original machine. No dataset is ever "
            "synthesised to make training runnable."
        )
    return root


def next_name(base: str) -> str:
    """runs/aurora_iceberg/<base>, <base>2, <base>3 ... so nothing is reused."""
    if not (PROJECT_DIR / base).exists():
        return base
    n = 2
    while (PROJECT_DIR / f"{base}{n}").exists():
        n += 1
    return f"{base}{n}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--epochs", type=int, default=200)
    parser.add_argument("--patience", type=int, default=40)
    parser.add_argument("--data", default="data.yaml")
    parser.add_argument("--name", default="aurora-iceberg-longer")
    parser.add_argument("--batch", type=int, default=BATCH)
    parser.add_argument("--imgsz", type=int, default=IMGSZ)
    parser.add_argument("--dry-run", action="store_true",
                        help="resolve and print the plan without training")
    args = parser.parse_args()

    try:
        init = resolve_init_weights()
    except FileNotFoundError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    before = sha256(init)
    print("=" * 68)
    print("AURORA iceberg training - continued training run")
    print("=" * 68)
    print(f"  starting weights : {init}")
    print(f"  sha256 (before)  : {before}")
    print(f"  dataset config   : {args.data}")
    print(f"  epochs / patience: {args.epochs} / {args.patience}")
    print(f"  imgsz / batch    : {args.imgsz} / {args.batch}")
    print(f"  output project   : {PROJECT_DIR}")
    print(f"  protected file   : {SHIPPED_CHECKPOINT.name} (read-only)")
    print()

    if init.resolve() == SHIPPED_CHECKPOINT.resolve():
        print("  NOTE: continuing from the shipped checkpoint. Fine-tuning it")
        print("        writes a NEW file under runs/aurora_iceberg/ and leaves")
        print("        best_sar_iceberg_model.pt byte-identical.")
        print()

    if args.dry_run:
        try:
            dataset = resolve_dataset()
            print(f"  dataset root     : {dataset}")
        except FileNotFoundError as exc:
            print(f"  dataset          : MISSING\n  {exc}")
        print("\n  --dry-run: nothing was trained.")
        return 0

    try:
        resolve_dataset()
    except FileNotFoundError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    from ultralytics import YOLO

    model = YOLO(str(init))
    run_name = next_name(args.name)
    print(f"  run name         : {run_name}")

    results = model.train(
        data=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        patience=args.patience,
        project=str(PROJECT_DIR),
        name=run_name,
        exist_ok=False,
        save=True,
        plots=True,
        verbose=True,
    )

    after = sha256(init)
    print()
    print("=" * 68)
    print("Training complete.")
    print(f"  run directory : {results.save_dir}")
    print(f"  best weights  : {results.save_dir}/weights/best.pt")
    print(f"  final mAP50   : {results.results_dict.get('metrics/mAP50(B)', 'N/A')}")
    print(f"  final mAP50-95: {results.results_dict.get('metrics/mAP50-95(B)', 'N/A')}")
    print(f"  sha256 (after): {after}")
    if before != after:
        print("  WARNING: the starting checkpoint changed during training.")
    else:
        print(f"  VERIFIED: {init.name} is byte-identical (unchanged by this run).")
    print("=" * 68)

    best = Path(results.save_dir) / "weights" / "best.pt"
    if best.is_file() and best.resolve() != SHIPPED_CHECKPOINT.resolve():
        print(f"\nCompare the candidate against the baseline with:\n"
              f"  python backend/aurora/iceberg/tools/evaluate_checkpoint.py "
              f"data.yaml {best}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

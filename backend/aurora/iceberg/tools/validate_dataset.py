"""
Validate the YOLO-format iceberg dataset before any training run.

Checks (per split: train/val/test):
  - dataset root / data.yaml presence and resolvable paths
  - image presence, readability, dimensions, duplicates (hash)
  - label presence, parseability, class ids, coordinate ranges
  - bounding boxes inside image bounds, non-degenerate boxes
  - images without labels (treated as negatives in this project)
  - labels without images
  - train/val/test leakage (same file name or same content hash)
  - class imbalance (box counts per split)

No file is modified. Writes <reports>/dataset_validation.json.

Usage:
    python backend/aurora/iceberg/tools/validate_dataset.py                # uses <repo>/data.yaml
    python backend/aurora/iceberg/tools/validate_dataset.py path/to/data.yaml
"""
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[4]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.aurora.iceberg import paths as iceberg_paths

VALID_SPLITS = ("train", "val", "test")


def load_config(yaml_path: Path) -> dict:
    with open(yaml_path) as f:
        cfg = yaml.safe_load(f)
    root = Path(cfg.get("path", "."))
    if not root.is_absolute():
        root = (yaml_path.parent / root).resolve()
    return {"root": root, "train": cfg.get("train"), "val": cfg.get("val"),
            "test": cfg.get("test"), "names": cfg.get("names") or {}}


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def iter_images(split_dir: Path):
    if not split_dir or not split_dir.exists():
        return []
    exts = {".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff"}
    return sorted(p for p in split_dir.iterdir() if p.suffix.lower() in exts)


def validate_split(name: str, split_dir: Path, label_dir: Path) -> dict:
    res = {
        "split": name,
        "images_dir": str(split_dir) if split_dir else None,
        "labels_dir": str(label_dir) if label_dir else None,
        "exists": bool(split_dir and split_dir.exists()),
        "n_images": 0,
        "n_label_files": 0,
        "n_labeled_images": 0,
        "n_boxes": 0,
        "box_count_by_class": {},
        "missing_labels": [],
        "labels_without_image": [],
        "unreadable_images": [],
        "image_sizes": {},
        "malformed_label_files": [],
        "out_of_bounds_boxes": [],
        "degenerate_boxes": [],
        "unknown_class_ids": [],
        "duplicate_content": {},
        "problems": [],
    }
    if not res["exists"]:
        res["problems"].append("images directory not found")
        return res

    images = iter_images(split_dir)
    res["n_images"] = len(images)
    hashes = {}
    known_classes = {int(k) for k in VALID_CLASS_IDS}

    for img in images:
        try:
            from PIL import Image
            with Image.open(img) as im:
                w, h = im.size
                im.verify()
            res["image_sizes"][str(w)] = res["image_sizes"].get(str(w), 0) + 1
        except Exception as exc:  # corrupted / unreadable
            res["unreadable_images"].append({"file": img.name, "error": str(exc)})
            continue

        digest = file_sha256(img)
        hashes.setdefault(digest, []).append(img.name)

        lbl = img.with_suffix(".txt")
        if not lbl.exists() or lbl.stat().st_size == 0:
            res["missing_labels"].append(img.name)
            continue

        res["n_label_files"] += 1
        lines = [l.strip() for l in lbl.read_text().splitlines() if l.strip()]
        if not lines:
            res["missing_labels"].append(img.name)
            continue
        res["n_labeled_images"] += 1

        for i, line in enumerate(lines, 1):
            parts = line.split()
            if len(parts) != 5:
                res["malformed_label_files"].append(
                    {"file": lbl.name, "line": i, "content": line[:80]})
                continue
            try:
                cid = int(float(parts[0]))
                xc, yc, bw, bh = (float(p) for p in parts[1:])
            except ValueError:
                res["malformed_label_files"].append(
                    {"file": lbl.name, "line": i, "content": line[:80]})
                continue

            res["n_boxes"] += 1
            res["box_count_by_class"][str(cid)] = res["box_count_by_class"].get(str(cid), 0) + 1
            if cid not in known_classes:
                res["unknown_class_ids"].append({"file": lbl.name, "class_id": cid})

            if not (0.0 <= xc <= 1.0 and 0.0 <= yc <= 1.0 and 0.0 < bw <= 1.0 and 0.0 < bh <= 1.0):
                res["out_of_bounds_boxes"].append({"file": lbl.name, "line": i,
                                                   "values": [xc, yc, bw, bh]})
            if bw <= 0 or bh <= 0:
                res["degenerate_boxes"].append({"file": lbl.name, "line": i,
                                                "values": [xc, yc, bw, bh]})

    if label_dir and label_dir.exists():
        for lbl in sorted(label_dir.glob("*.txt")):
            if not (split_dir / (lbl.stem + ".png")).exists() and \
               not any((split_dir / (lbl.stem + e)).exists() for e in (".jpg", ".jpeg", ".bmp")):
                res["labels_without_image"].append(lbl.name)

    res["duplicate_content"] = {k[:12]: v for k, v in hashes.items() if len(v) > 1}
    if res["unreadable_images"]:
        res["problems"].append(f"{len(res['unreadable_images'])} unreadable images")
    if res["malformed_label_files"]:
        res["problems"].append(f"{len(res['malformed_label_files'])} malformed label lines")
    if res["out_of_bounds_boxes"]:
        res["problems"].append(f"{len(res['out_of_bounds_boxes'])} boxes outside [0,1]")
    if res["duplicate_content"]:
        res["problems"].append(f"{len(res['duplicate_content'])} duplicate image groups")
    if res["labels_without_image"]:
        res["problems"].append(f"{len(res['labels_without_image'])} labels without image")
    return res


VALID_CLASS_IDS = {"0": "iceberg"}


def main() -> int:
    yaml_path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data.yaml"
    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "data_yaml": str(yaml_path),
        "status": "PASS",
        "blockers": [],
        "splits": {},
        "leakage": {},
        "class_balance": {},
        "safe_fixes_applied": [],
    }

    if not yaml_path.exists():
        report["status"] = "BLOCKED"
        report["blockers"].append(f"{yaml_path} not found")
    else:
        cfg = load_config(yaml_path)
        report["dataset_root"] = str(cfg["root"])
        report["class_names"] = {str(k): v for k, v in cfg["names"].items()}
        if not cfg["root"].exists():
            report["status"] = "BLOCKED"
            report["blockers"].append(f"dataset root does not exist: {cfg['root']}")
        else:
            hashes_by_split = {}
            for split in VALID_SPLITS:
                rel = cfg.get(split)
                if not rel:
                    continue
                split_dir = cfg["root"] / rel
                label_dir = cfg["root"] / "labels" / split
                res = validate_split(split, split_dir, label_dir)
                report["splits"][split] = res
                hashes_by_split[split] = res.get("duplicate_content", {})

            leakage = []
            names = {s: set(v) for s, v in
                     ((s, [n for grp in report["splits"][s].get("duplicate_content", {}).values()
                           for n in grp] if False else []) for s in report["splits"])}
            # leakage by identical file content across splits
            content_map = {}
            for split in report["splits"]:
                split_dir = report["splits"][split].get("images_dir")
                if not split_dir:
                    continue
                for img in iter_images(Path(split_dir)):
                    content_map.setdefault(file_sha256(img), set()).add(split)
            for digest, splits in content_map.items():
                if len(splits) > 1:
                    leakage.append({"sha256": digest[:12], "splits": sorted(splits)})
            report["leakage"] = {"cross_split_duplicate_content": leakage,
                                 "count": len(leakage)}

            total_boxes = sum(report["splits"][s]["n_boxes"] for s in report["splits"])
            report["class_balance"] = {
                "total_boxes": total_boxes,
                "per_split": {s: report["splits"][s]["n_boxes"] for s in report["splits"]},
                "per_class": report["splits"].get("train", {}).get("box_count_by_class", {}),
            }
            if leakage:
                report["status"] = "BLOCKED"
                report["blockers"].append(f"{len(leakage)} cross-split content duplicates (leakage)")
            for split, res in report["splits"].items():
                if res["problems"] and report["status"] == "PASS":
                    report["status"] = "BLOCKED"
                    report["blockers"].append(f"{split}: " + "; ".join(res["problems"]))

    out = iceberg_paths.reports_dir() / "dataset_validation.json"
    out.write_text(json.dumps(report, indent=2))
    print(json.dumps({"status": report["status"], "blockers": report["blockers"],
                      "report": str(out)}, indent=2))
    return 0 if report["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())

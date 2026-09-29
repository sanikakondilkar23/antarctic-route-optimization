"""
inference.py — the only module that talks to the trained iceberg network.

Usage:
    from backend.aurora.iceberg import inference
    result = inference.detect("tile.png")

Output contract (JSON-serialisable):
    {
      "icebergs": [{"bbox": [x1, y1, x2, y2], "confidence": float,
                    "class": "iceberg"}],
      "detection_count": int,
      "image_width": int, "image_height": int,
      "model": str, "detected_at": str,
      "confidence_threshold": float,
      "georeferencing": {"available": false, ...}   # never faked
    }

Rules inherited from the audited source implementation
-----------------------------------------------------
1. Read-only: the checkpoint is opened for inference and never written.
2. No fabrication: every number comes from a tensor the model produced.
   Zero detections is a valid result, not an error.
3. No invented timestamp: ``detected_at`` is the inference time (UTC), which
   is never presented as an image acquisition time.
4. Pixel-space geometry: boxes are in original-image pixels, clipped to the
   image bounds; geographic coordinates are only ever reported when valid
   metadata exists (see paths.GEOREFERENCING).
"""

from __future__ import annotations

import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from . import paths


class DetectorUnavailable(RuntimeError):
    """The checkpoint cannot be loaded, so no detection is ever returned."""


class AuroraIcebergDetector:
    def __init__(self, model_path: str | Path | None = None,
                 conf: float = paths.DEFAULT_CONF, iou: float = paths.DEFAULT_IOU,
                 device: str = ""):
        self.model_path = Path(model_path) if model_path else paths.model_path()
        if not self.model_path.exists():
            raise DetectorUnavailable(f"model checkpoint not found: {self.model_path}")
        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise DetectorUnavailable(
                "ultralytics is not installed (pip install ultralytics)") from exc
        self.model = YOLO(str(self.model_path))
        self.conf = float(conf)
        self.iou = float(iou)
        self.device = device
        self.class_names = dict(self.model.names)
        self._lock = threading.Lock()

    @property
    def model_name(self) -> str:
        return self.model_path.name

    def status(self) -> dict:
        return {
            "component": "iceberg_detection",
            "model": "YOLOv8-nano",
            "model_file": self.model_name,
            "model_path": str(self.model_path),
            "classes": list(self.class_names.values()),
            "n_classes": len(self.class_names),
            "parameters": int(sum(p.numel() for p in self.model.parameters())),
            "confidence_threshold": self.conf,
            "iou_threshold": self.iou,
            "device": self.device or "cpu",
            "georeferencing": dict(paths.GEOREFERENCING),
            "status": "READY",
        }

    def detect(self, image_path: str | Path, conf: Optional[float] = None,
               iou: Optional[float] = None) -> dict:
        image_path = Path(image_path)
        if not image_path.exists():
            raise FileNotFoundError(f"image not found: {image_path}")
        c = self.conf if conf is None else float(conf)
        i = self.iou if iou is None else float(iou)
        with self._lock:
            results = self.model.predict(source=str(image_path), conf=c, iou=i,
                                         device=self.device, verbose=False)
        r = results[0]
        orig = getattr(r, "orig_shape", None)
        if orig is None:
            from PIL import Image
            with Image.open(image_path) as im:
                w, h = im.size
        else:
            h, w = int(orig[0]), int(orig[1])

        icebergs = []
        if r.boxes is not None and len(r.boxes) > 0:
            for box in r.boxes:
                x1, y1, x2, y2 = [float(v) for v in box.xyxy[0].tolist()]
                cls_id = int(box.cls[0])
                x1, y1 = max(0.0, x1), max(0.0, y1)
                x2, y2 = min(float(w), x2), min(float(h), y2)
                icebergs.append({
                    "bbox": [round(x1, 2), round(y1, 2), round(x2, 2), round(y2, 2)],
                    "confidence": round(float(box.conf[0]), 4),
                    "class": self.class_names.get(cls_id, str(cls_id)),
                    "location": None,   # georeferencing unavailable
                })
        icebergs.sort(key=lambda d: d["confidence"], reverse=True)

        return {
            "icebergs": icebergs,
            "detection_count": len(icebergs),
            "image_width": int(w),
            "image_height": int(h),
            "model": self.model_name,
            "detected_at": datetime.now(timezone.utc).isoformat(),
            "confidence_threshold": c,
            "georeferencing": dict(paths.GEOREFERENCING),
            "source": str(image_path),
        }


_detector: Optional[AuroraIcebergDetector] = None
_lock = threading.Lock()


def get_detector(conf: float = paths.DEFAULT_CONF) -> AuroraIcebergDetector:
    global _detector
    with _lock:
        if _detector is None:
            _detector = AuroraIcebergDetector(conf=conf)
        return _detector


def detect(image_path: str | Path, conf: float = paths.DEFAULT_CONF) -> dict:
    return get_detector(conf=conf).detect(image_path, conf=conf)


def load_image(image_path: str | Path):
    """Read an image for preprocessing checks; raises on unreadable input."""
    from PIL import Image
    image_path = Path(image_path)
    if not image_path.exists():
        raise FileNotFoundError(f"image not found: {image_path}")
    with Image.open(image_path) as im:
        im.load()
        return im.size, im.mode

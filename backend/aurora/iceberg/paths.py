"""
paths.py — repository-relative locations for the AURORA iceberg module.

Nothing is hardcoded to an absolute path. The checkpoint location can be
overridden with AURORA_ICEBERG_MODEL; the default is models/iceberg/.

Georeferencing status (scientific limitation, checked at import time)
--------------------------------------------------------------------
``tile_sar.py`` in the source repository wrote tiles with ``cv2.imwrite()``,
which stores no CRS and no geotransform, so the scene-to-Earth affine read by
``rasterio`` was never persisted. Detections are therefore pixel-space only.
``GEOREFERENCING`` reports that honestly and must never be overridden to
claim coordinates the data cannot support.
"""

from __future__ import annotations

import os
from pathlib import Path

# backend/aurora/iceberg/paths.py -> iceberg -> aurora -> backend -> repo root
ICEBERG_DIR = Path(__file__).resolve().parent
BACKEND_DIR = ICEBERG_DIR.parents[1]
REPO_ROOT = BACKEND_DIR.parent

#: Trained YOLOv8-nano checkpoint (never written by this package).
DEFAULT_CHECKPOINT = REPO_ROOT / "models" / "iceberg" / "best_sar_iceberg_model.pt"

#: Machine-readable reports written by the tools/ scripts.
REPORTS_DIR = ICEBERG_DIR / "evaluation"

#: Real SAR tiles used as test fixtures (from the source repository's
#: committed sample predictions).
FIXTURE_DIR = REPO_ROOT / "tests" / "fixtures" / "sar_tiles"

#: Verified checkpoint facts, re-derived by tools/inspect_checkpoint.py.
EXPECTED_SHA256 = "75e153cb3e3754c4ff47318ec9f160bfe39b8933455db0b4f7d01b46e55af461"
EXPECTED_CLASSES = ("iceberg",)
EXPECTED_PARAM_COUNT = 3_011_043
EXPECTED_IMGSZ = 640
DEFAULT_CONF = 0.25
DEFAULT_IOU = 0.7

#: Honest georeferencing status. `available` is False and stays False until a
#: pipeline that persists CRS + geotransform per tile actually exists.
GEOREFERENCING = {
    "available": False,
    "status": "Georeferencing unavailable",
    "message": ("Georeferencing unavailable — detections are pixel-space only. "
                "Tiles were written as plain PNGs, so the source CRS/geotransform "
                "was not preserved."),
    "unit": "pixel",
}


def model_path() -> Path:
    """Absolute path to the trained checkpoint (env override supported)."""
    raw = os.environ.get("AURORA_ICEBERG_MODEL", "").strip()
    return Path(raw).expanduser().resolve() if raw else DEFAULT_CHECKPOINT


def reports_dir() -> Path:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    return REPORTS_DIR


def fixture_tiles() -> list[Path]:
    if not FIXTURE_DIR.exists():
        return []
    return sorted(FIXTURE_DIR.glob("*.jpg")) + sorted(FIXTURE_DIR.glob("*.png"))

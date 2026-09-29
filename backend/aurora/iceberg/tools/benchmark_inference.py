"""
Measure real inference latency for the iceberg model on this machine.

Writes <reports>/performance.json. No performance claim is made beyond
what is measured here.
"""
import json
import statistics
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[4]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.aurora.iceberg import paths as iceberg_paths
from backend.aurora.iceberg.inference import AuroraIcebergDetector

IMGSZ = 640
BATCH_NOTE = "batch=1 (single image per call)"


def main() -> int:
    det = AuroraIcebergDetector()
    samples = iceberg_paths.fixture_tiles()[:8]

    # warm-up
    if samples:
        det.detect(samples[0])

    times = []
    per_image = []
    for s in samples:
        t0 = time.perf_counter()
        res = det.detect(s)
        times.append(time.perf_counter() - t0)
        per_image.append(res["detection_count"])

    # synthetic blank (empty-image) case
    blank = Path(tempfile.mkdtemp()) / "blank.png"
    Image.fromarray(np.zeros((512, 512), dtype=np.uint8)).save(blank)
    t0 = time.perf_counter()
    blank_res = det.detect(blank)
    blank_ms = (time.perf_counter() - t0) * 1000

    report = {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "device": "CPU (torch %s, cuda_available=%s)" % (
            __import__("torch").__version__, __import__("torch").cuda.is_available()),
        "gpu_inference": "NOT AVAILABLE (CPU-only torch build, no CUDA device)",
        "model": det.model_name,
        "input_resolution": {"inference_imgsz": IMGSZ, "native_tile_px": 512},
        "batch_size": 1,
        "samples": len(samples),
        "latency_ms": {
            "mean": round(statistics.mean(times) * 1000, 1),
            "median": round(statistics.median(times) * 1000, 1),
            "min": round(min(times) * 1000, 1),
            "max": round(max(times) * 1000, 1),
            "stdev": round(statistics.pstdev(times) * 1000, 1) if len(times) > 1 else 0.0,
        },
        "blank_image_latency_ms": round(blank_ms, 1),
        "blank_image_detections": blank_res["detection_count"],
        "detections_per_sample_at_conf_0.25": per_image,
        "claims": ["measured on this machine only; no real-time claim"],
    }
    out = iceberg_paths.reports_dir() / "performance.json"
    out.write_text(json.dumps(report, indent=2))
    blank.unlink(missing_ok=True)
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

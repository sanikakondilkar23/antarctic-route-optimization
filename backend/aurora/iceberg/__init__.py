"""
AURORA iceberg module — SAR iceberg detection, risk adaptation and tooling.

Layout
------
paths.py       repository-relative locations (checkpoint, fixtures, reports)
inference.py   the single place that talks to the trained YOLOv8 checkpoint
risk.py        detection -> locations -> confidence -> risk layer (documented,
               separate stages; never fabricates coordinates or risk)
tools/         audit / validation / evaluation / benchmark utilities
evaluation/    machine-readable records produced by the source-repository audit

Origin: https://github.com/sakshidas1-ux/sar-iceberg-detection branch
``feature/aurora-iceberg-model`` — audited, tested (13 passed) and imported
into AURORA without retraining or altering the checkpoint.
"""

from __future__ import annotations

from .paths import GEOREFERENCING, model_path, reports_dir

__all__ = ["model_path", "reports_dir", "GEOREFERENCING"]

# AURORA — Iceberg Component Integration Contract

Imported from `sakshidas1-ux/sar-iceberg-detection` branch
`feature/aurora-iceberg-model` (audited, 13 tests passed there) and adapted to
this repository's conventions. **No retraining, no dataset, no fabricated data.**

## Where things live

| Concern | Location |
|---|---|
| Checkpoint (byte-identical, SHA256 `75e153cb…55af461`) | `models/iceberg/best_sar_iceberg_model.pt` |
| Inference (only module that touches the network) | `backend/aurora/iceberg/inference.py` |
| Detection → risk transformation | `backend/aurora/iceberg/risk.py` |
| Paths / verified facts / georeferencing status | `backend/aurora/iceberg/paths.py` |
| Endpoints (registered in the existing Flask app) | `backend/api/iceberg_api.py` |
| Audit / validation / evaluation / benchmark tools | `backend/aurora/iceberg/tools/` |
| Machine-readable records | `backend/aurora/iceberg/evaluation/` |
| Tests | `tests/test_aurora_iceberg.py` |
| Source-repository audit trail | `docs/iceberg/AUDIT.md`, `docs/iceberg/MODEL_STATUS.md` |

## Pipeline

```
Iceberg Detector  →  detections (pixel space)  →  Iceberg Risk Adapter
                   →  iceberg_risk / iceberg_uncertainty  →  Route Environment
                   →  Route Optimizer
```

`iceberg_risk` and `iceberg_uncertainty` are **null** today. The route optimizer
therefore does **not** consume iceberg risk yet, and
`backend/api/main.py::discover_iceberg()` keeps reporting
`available: false` — a test asserts that, so the claim cannot drift.

## API (existing Flask app: `backend/api/main.py::create_app`)

### `GET /api/icebergs/status`
```json
{"component": "iceberg_detection", "checkpoint_present": true,
 "checkpoint_sha256": "75e153cb…", "model_status": "ready",
 "georeferencing": {"available": false, "status": "Georeferencing unavailable"},
 "risk_status": "INTEGRATION READY",
 "route_consumes_iceberg_risk": false,
 "dataset_status": "unavailable in this repository (inference-only import)"}
```

### `GET /api/icebergs/model`
Checkpoint identity: model, classes, parameter count (3,011,043), thresholds, SHA256.

### `POST /api/icebergs/detect`
Input: `multipart/form-data` field `image`, or JSON `{"image_path": "..."}` or
`{"image_base64": "...", "conf": 0.25}`.

```json
{
  "detections": [
    {"bbox": [x1, y1, x2, y2], "confidence": 0.0, "class": "iceberg",
     "location": null, "coordinate_space": "pixel"}
  ],
  "detection_count": 0,
  "image_width": 512, "image_height": 512,
  "model": "best_sar_iceberg_model.pt",
  "detected_at": "2026-09-28T…Z",
  "confidence_threshold": 0.25,
  "model_status": "ready",
  "georeferencing": {"available": false, "status": "Georeferencing unavailable"},
  "risk_status": "INTEGRATION READY",
  "iceberg_risk": null
}
```

Errors: `400` missing/invalid input · `404` image not found · `413` too large ·
`415` unsupported content type · `422` unreadable image · `503` checkpoint missing.
**0 detections is a normal 200 response, never an error.**

## Georeferencing (scientific limitation)

`tile_sar.py` in the source repository wrote tiles with `cv2.imwrite()`, which
preserves no CRS and no geotransform. Detections are therefore **pixel-space
only** and `location` is always `null` unless a caller supplies a verified
affine (`{"type": "affine", "pixel_to_lonlat": [[a,b,c],[d,e,f]]}`) to
`iceberg_risk_adapter`-level functions. `backend/aurora/iceberg/paths.py::
GEOREFERENCING` is the single source of truth for that status, so a future
georeferencing pipeline can be added in one place without touching the detector.

## Frontend contract — "ICEBERG INTELLIGENCE"

| UI element | Field |
|---|---|
| Detector status | `model_status` (`ready` / API 503) + `GET /api/icebergs/status` |
| Detection count | `detection_count` |
| Confidence | `detections[].confidence` (0–1) |
| Pixel-space detections | `detections[].bbox` + `image_width` / `image_height` |
| Geographic position | `detections[].location` — display **only** when non-null |
| Georeferencing status | `georeferencing.status` → show **"Georeferencing unavailable"**, label boxes **"Pixel-space detection"** |
| Risk layer | show only when `risk_status == "READY"` |

Never draw an Antarctic map marker when `location` is null.

## Model facts (verified, not re-measured)

YOLOv8-nano · 1 class (`iceberg`) · 3,011,043 parameters · imgsz 640 ·
seed 0 · saved by ultralytics 8.4.155 · stored-at-training metrics
precision 0.82846, recall 0.5393, mAP50 0.5202, mAP50-95 0.18031.
Baseline re-evaluation is **BLOCKED** while the dataset is absent — see
`backend/aurora/iceberg/evaluation/baseline_evaluation.json`.

## Running

```bash
python -m pytest tests/test_aurora_iceberg.py -q
python backend/aurora/iceberg/tools/inspect_checkpoint.py     # verify checkpoint
python backend/aurora/iceberg/tools/validate_dataset.py       # BLOCKED until dataset restored
python backend/aurora/iceberg/tools/benchmark_inference.py    # measured CPU latency
uvicorn --help >/dev/null  # (not used: this repo's API is Flask)
flask --app backend.api.main run   # or python -m backend.api.main
```

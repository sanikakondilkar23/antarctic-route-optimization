"""
risk.py — AURORA iceberg risk adaptation layer.

Pipeline, with each stage kept separate and explicit:

    DETECTION ──▶ LOCATIONS ──▶ CONFIDENCE ──▶ SPATIAL/TEMPORAL RISK ──▶ ROUTE

The single most important rule in this file:

    **A detection is not a navigation risk.**

Confidence answers "how sure is the detector about this shape?" It says nothing
about an iceberg's physical extent, its drift, or whether a vessel's corridor
intersects it. Collapsing the two is how a prototype starts reporting numbers it
cannot support, so this module refuses to do it.

Why risk is currently INTEGRATION READY and not READY
-----------------------------------------------------
Converting a pixel-space bounding box into a navigation risk requires a
georeference. The source pipeline wrote tiles with ``cv2.imwrite()``, which
stores no CRS and no geotransform, so the scene-to-Earth affine read by
``rasterio`` was never persisted (see ``paths.GEOREFERENCING``). Without it:

* ``detections_to_locations`` returns ``location: None``
* ``build_risk_layer`` returns ``iceberg_risk: None``
* ``to_route_layers`` reports ``status = "INTEGRATION READY"``

The route optimizer is therefore never handed a fabricated field. The route
side of this repository already declares ``route_consumes_iceberg_risk: false``
and this module is what makes that claim true rather than aspirational.

To upgrade to READY, a caller must supply BOTH:
  1. a georeference describing the pixel -> lon/lat mapping, and
  2. an explicit, documented risk model.
Neither is guessed here, and neither is defaulted.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from . import paths

#: Status vocabulary shared with the API layer and the UI.
READY = "READY"
INTEGRATION_READY = "INTEGRATION READY"
BLOCKED = "BLOCKED"

SUPPORTED_GEO_TYPES = ("affine", "identity")
SUPPORTED_RISK_MODELS = ("confidence_standoff",)

_NOTE_DETECTION_IS_NOT_RISK = (
    "Detection confidence is NOT navigation risk. It describes the detector's "
    "certainty about a shape in an image, not an iceberg's extent, drift, or "
    "proximity to a vessel corridor."
)

_NOTE_GEOREFERENCE_REQUIRED = (
    "Georeferencing is unavailable: tiles were written as plain PNGs, so no "
    "CRS or geotransform was preserved. A pixel box cannot be placed on a map."
)


def detections_to_locations(
    detection: dict[str, Any],
    georeference: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    Stage 2: detections -> locations.

    ``georeference`` must be supplied by the caller and must describe how pixel
    coordinates map to lon/lat. Recognised forms:

        {"type": "affine", "pixel_to_lonlat": [[a, b, c], [d, e, f]]}
        {"type": "identity"}   # explicit pass-through, still not lon/lat

    With no georeference, every ``location`` is ``None`` and
    ``location_source`` is ``"pixel_only"``. A position is never approximated.
    """
    has_geo = bool(georeference) and georeference.get("type") in SUPPORTED_GEO_TYPES
    if georeference and not has_geo:
        raise ValueError(
            f"unsupported georeference type {georeference.get('type')!r}; "
            f"expected one of {SUPPORTED_GEO_TYPES}"
        )

    locations: list[dict[str, Any]] = []
    for det in detection.get("icebergs", []):
        locations.append({
            "bbox_pixel": list(det["bbox"]),
            "confidence": det["confidence"],
            "class": det["class"],
            "location": _pixel_to_lonlat(det["bbox"], georeference) if has_geo else None,
            "location_source": "georeference" if has_geo else "pixel_only",
            "coordinate_space": "lonlat" if has_geo else "pixel",
        })
    return {
        "icebergs": locations,
        "count": len(locations),
        "image_size": [detection.get("image_width"), detection.get("image_height")],
        "model": detection.get("model"),
        "detection_timestamp": detection.get("detected_at"),
        "georeferencing": dict(paths.GEOREFERENCING),
    }


def _pixel_to_lonlat(
    bbox: list[float],
    georeference: dict[str, Any],
) -> Optional[list[float]]:
    if georeference.get("type") == "affine":
        (a, b, c), (d, e, f) = georeference["pixel_to_lonlat"]
        xc = (bbox[0] + bbox[2]) / 2.0
        yc = (bbox[1] + bbox[3]) / 2.0
        return [a * xc + b * yc + c, d * xc + e * yc + f]
    if georeference.get("type") == "identity":
        # Explicitly not lon/lat. Preserved so a caller can pipeline pixels
        # without a transform, while keeping the coordinate space unambiguous.
        return [(bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0]
    return None


def build_risk_layer(
    locations: dict[str, Any],
    risk_model: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    Stage 4: locations + confidence -> spatial/temporal risk.

    A risk value is produced ONLY when the caller supplies an explicit risk
    model AND at least one detection has a real location. Otherwise the layer is
    returned with ``iceberg_risk = None`` and an honest status.

    The caller owns the risk science. This module applies the supplied rule and
    does not invent coefficients.
    """
    out: dict[str, Any] = {
        "status": INTEGRATION_READY,
        "iceberg_risk": None,
        "risk_field": None,
        "risk_units": None,
        "risk_model": None,
        "icebergs": [
            {
                "confidence": p["confidence"],
                "location": p["location"],
                "bbox_pixel": p["bbox_pixel"],
                "coordinate_space": p["coordinate_space"],
            }
            for p in locations.get("icebergs", [])
        ],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "notes": [_NOTE_DETECTION_IS_NOT_RISK],
    }

    if risk_model is None:
        out["notes"].append(_NOTE_GEOREFERENCE_REQUIRED)
        return out

    if risk_model.get("type") not in SUPPORTED_RISK_MODELS:
        out["status"] = BLOCKED
        out["notes"].append(
            f"unsupported risk model type {risk_model.get('type')!r}; "
            f"expected one of {SUPPORTED_RISK_MODELS}"
        )
        return out

    georeferenced = [p for p in out["icebergs"] if p["location"] is not None]
    if not georeferenced:
        out["notes"].append(_NOTE_GEOREFERENCE_REQUIRED)
        return out

    scale = float(risk_model.get("scale", 1.0))
    out["status"] = READY
    out["risk_model"] = risk_model
    out["risk_units"] = "relative_index"
    out["risk_field"] = [
        {
            "location": p["location"],
            "risk": round(p["confidence"] * scale, 4),
            "confidence": p["confidence"],
        }
        for p in georeferenced
    ]
    # iceberg_risk is the name the route cost map expects; keep them identical.
    out["iceberg_risk"] = out["risk_field"]
    out["notes"].append(
        "Risk is a confidence-derived relative index, not a POLARIS or "
        "IMO-compliant assessment. No physical iceberg area, drift rate, or "
        "stand-off distance is computed."
    )
    return out


def to_route_layers(
    detection: dict[str, Any],
    georeference: Optional[dict[str, Any]] = None,
    risk_model: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    Everything the route optimizer is allowed to see from the iceberg module.

    The route side expects a field named ``iceberg_risk``. Today that field is
    ``None``, which the cost model treats as "layer absent" rather than "zero
    risk" — see ``src/routing/cost.py`` and the ``w_ice`` weight, which defaults
    to 0. This is why the route is unaffected by the iceberg module in its
    current state, and why the API can honestly report
    ``route_consumes_iceberg_risk: false``.
    """
    locations = detections_to_locations(detection, georeference)
    risk = build_risk_layer(locations, risk_model)
    return {
        "iceberg_risk": risk["iceberg_risk"],
        "iceberg_uncertainty": None,
        "detection_count": detection.get("detection_count",
                                          len(detection.get("icebergs", []))),
        "status": risk["status"],
        "risk_units": risk["risk_units"],
        "locations": locations,
        "notes": risk["notes"],
        "route_consumer": "src/routing/cost.py::CostMap term 'ice' (w_ice, default 0)",
        "iceberg_uncertainty_note": (
            "A detection gives one confidence per object, not a distribution "
            "over position. No uncertainty field is emitted, because inventing "
            "one would imply a spatial model that does not exist. "
            "src/uncertainty/scenarios.py needs iceberg_risk_uncertainty for "
            "CVaR and is therefore unreachable from this module today."
        ),
    }


def for_route_optimizer(
    detection: dict[str, Any],
    georeference: Optional[dict[str, Any]] = None,
    risk_model: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """Full documented transformation chain, with its contract version."""
    layers = to_route_layers(detection, georeference, risk_model)
    return {
        "detections": detection,
        "locations": layers["locations"],
        "risk": {
            "status": layers["status"],
            "risk_field": layers["iceberg_risk"],
            "iceberg_risk": layers["iceberg_risk"],
            "iceberg_uncertainty": layers["iceberg_uncertainty"],
            "risk_units": layers["risk_units"],
            "notes": layers["notes"],
        },
        "integration_status": layers["status"],
        "contract_version": "1.0",
    }

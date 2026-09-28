"""
raster.py — browser-facing rasterization of the real AURORA fields.

Why PNG and not JSON
--------------------
The routing grid is 173x369 and the model grid is 101x361. Shipping those as
nested JSON would be ~64k numbers per field per horizon; shipping them as
base64 float bytes would still be megabytes. A PNG colormap is a few tens of
kilobytes and Leaflet consumes it directly through L.ImageOverlay, so the
browser draws real model output without ever seeing a fabricated value.

Contract
--------
Every encoder here is a pure colormap over the array it is given:

* NaN / non-finite cells become **fully transparent**. They are not coloured,
  not zero-filled and not interpolated. This mirrors the repository's
  non-negotiable rule that a NaN SIC cell means INVALID / NON-NAVIGABLE and
  must never be rendered as open water.
* The alpha channel is therefore the authoritative validity mask. A client that
  draws the image gets exactly the navigable domain, no more.
* Colour stops are documented, fixed and shared between the backend legend and
  the frontend legend component, so a pixel colour means the same thing in both.

No encoder interpolates, resamples or blurs. The only optional transform is a
nearest-neighbour width clamp for transport, which is off by default
(``AURORA_RASTER_MAX_WIDTH=0``) and reported in the response headers when used.
"""

from __future__ import annotations

import hashlib
import math
from typing import Any, Sequence

import numpy as np

from . import config


class RasterizerUnavailable(RuntimeError):
    """Pillow is not installed, so no raster can be served."""


def _pillow():
    try:
        from PIL import Image
    except ImportError as exc:  # pragma: no cover - environment problem
        raise RasterizerUnavailable(
            "Pillow is required to serve AURORA rasters: "
            "python -m pip install 'pillow>=10.0'"
        ) from exc
    return Image


# ---------------------------------------------------------------------------
# Colormaps. Documented stop tables, not invented gradients.
# ---------------------------------------------------------------------------
#: Sea-ice concentration. Stops are the standard NSIDC CDR v6 colour order,
#: truncated to 0..1. Each entry is (fraction, r, g, b).
SIC_STOPS: tuple[tuple[float, int, int, int], ...] = (
    (0.00, 8, 24, 48),
    (0.15, 20, 70, 130),
    (0.30, 40, 130, 185),
    (0.50, 120, 200, 225),
    (0.70, 205, 235, 245),
    (0.85, 255, 255, 255),
    (1.00, 255, 255, 255),
)

#: Forecast uncertainty (combined ensemble + MC-dropout std, in SIC fraction).
#: Low spread -> cool cyan (confident); high spread -> warm amber (uncertain).
UNCERTAINTY_STOPS: tuple[tuple[float, int, int, int], ...] = (
    (0.00, 12, 32, 52),
    (0.02, 20, 90, 120),
    (0.05, 40, 160, 190),
    (0.10, 120, 215, 220),
    (0.15, 235, 195, 110),
    (0.25, 240, 140, 70),
    (0.40, 226, 74, 66),
)

#: Total environmental cost field consumed by the route optimizer. Low cost
#: (open, navigable) -> deep teal; high cost (hazardous) -> red.
RISK_STOPS: tuple[tuple[float, int, int, int], ...] = (
    (0.00, 8, 26, 34),
    (0.10, 14, 70, 84),
    (0.25, 24, 130, 138),
    (0.45, 90, 175, 150),
    (0.65, 220, 200, 110),
    (0.85, 236, 150, 70),
    (1.00, 226, 66, 66),
)

#: Confidence classes are categorical, so they get discrete colours.
CONFIDENCE_COLORS: dict[int, tuple[int, int, int]] = {
    config.CLASS_HIGH: (46, 204, 190),
    config.CLASS_MEDIUM: (240, 190, 80),
    config.CLASS_LOW: (236, 106, 90),
    config.CLASS_MASKED: (0, 0, 0),
}


def _build_lut(stops: Sequence[tuple[float, int, int, int]], n: int = 256) -> np.ndarray:
    """256-entry RGBA lookup table from a stop table, by linear interpolation
    between documented stops. Interpolation happens once, in the colour table —
    never in the data."""
    xs = np.array([s[0] for s in stops], dtype=np.float64)
    out = np.zeros((n, 4), dtype=np.uint8)
    for channel in range(3):
        cs = np.array([s[channel + 1] for s in stops], dtype=np.float64)
        out[:, channel] = np.clip(
            np.rint(np.interp(np.linspace(0.0, 1.0, n), xs, cs)), 0, 255
        ).astype(np.uint8)
    out[:, 3] = 255
    return out


_SIC_LUT = _build_lut(SIC_STOPS)
_UNC_LUT = _build_lut(UNCERTAINTY_STOPS)
_RISK_LUT = _build_lut(RISK_STOPS)

LUTS: dict[str, np.ndarray] = {
    "sic": _SIC_LUT,
    "uncertainty": _UNC_LUT,
    "risk": _RISK_LUT,
}


def normalize(field: np.ndarray, lo: float, hi: float) -> np.ndarray:
    """Map a field onto 0..1 using an EXPLICIT, echoed domain.

    The domain is supplied by the caller from the artifact's own statistics and
    is returned to the client in the response headers, so a colour always maps
    back to a documented numeric value.
    """
    if hi <= lo:
        hi = lo + 1e-6
    return np.clip((np.asarray(field, dtype=np.float64) - lo) / (hi - lo), 0.0, 1.0)


def _width_clamp() -> int:
    return config.raster_max_width()


def encode_continuous(
    field: np.ndarray,
    kind: str,
    lo: float,
    hi: float,
) -> tuple[bytes, dict[str, Any]]:
    """Colormap one continuous field to RGBA PNG.

    Returns (png_bytes, meta) where meta records the exact domain used, the
    finite-cell count and the number of transparent (invalid) cells.
    """
    Image = _pillow()
    arr = np.asarray(field, dtype=np.float64)
    if arr.ndim != 2:
        raise ValueError(f"expected a 2-D field, got shape {arr.shape}")

    valid = np.isfinite(arr)
    lut = LUTS[kind]
    index = np.clip(np.rint(normalize(arr, lo, hi) * 255.0), 0, 255).astype(np.uint8)

    rgba = np.zeros(arr.shape + (4,), dtype=np.uint8)
    rgba[..., :3] = lut[index][..., :3]
    rgba[..., 3] = np.where(valid, 255, 0).astype(np.uint8)

    img = Image.fromarray(rgba, mode="RGBA")
    width, height = img.size
    max_width = _width_clamp()
    resized = False
    if 0 < max_width < width:
        new_h = max(1, int(round(height * max_width / width)))
        img = img.resize((max_width, new_h), Image.NEAREST)
        resized = True

    from io import BytesIO

    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    png = buf.getvalue()
    meta = {
        "kind": kind,
        "domain": [float(lo), float(hi)],
        "source_shape": [int(arr.shape[0]), int(arr.shape[1])],
        "raster_shape": [img.size[1], img.size[0]],
        "nearest_neighbour_resized": resized,
        "valid_cells": int(valid.sum()),
        "invalid_cells": int((~valid).sum()),
        "invalid_semantics": "transparent = INVALID / NON-NAVIGABLE (NaN); "
                             "never zero-filled and never drawn as open water",
        "bytes": len(png),
        "sha256": hashlib.sha256(png).hexdigest(),
    }
    return png, meta


def encode_categorical(field: np.ndarray) -> tuple[bytes, dict[str, Any]]:
    """Colormap a discrete class field (confidence class) to RGBA PNG."""
    Image = _pillow()
    raw = np.asarray(field)
    if raw.ndim != 2:
        raise ValueError(f"expected a 2-D field, got shape {raw.shape}")

    # Anything that is not a known class code is treated as invalid, never as
    # a colour.
    known = np.isin(raw, list(CONFIDENCE_COLORS))
    masked = raw == config.CLASS_MASKED
    valid = known & ~masked

    rgba = np.zeros(raw.shape + (4,), dtype=np.uint8)
    for code, colour in CONFIDENCE_COLORS.items():
        if code == config.CLASS_MASKED:
            continue
        hit = raw == code
        rgba[hit] = (*colour, 255)
    rgba[~valid] = (0, 0, 0, 0)

    img = Image.fromarray(rgba, mode="RGBA")
    max_width = _width_clamp()
    resized = False
    if 0 < max_width < img.size[0]:
        new_h = max(1, int(round(img.size[1] * max_width / img.size[0])))
        img = img.resize((max_width, new_h), Image.NEAREST)
        resized = True

    from io import BytesIO

    buf = BytesIO()
    img.save(buf, format="PNG", optimize=True)
    png = buf.getvalue()
    counts = {
        config.CLASS_LABELS[code]: int((raw == code).sum())
        for code in (config.CLASS_HIGH, config.CLASS_MEDIUM, config.CLASS_LOW)
    }
    meta = {
        "kind": "categorical",
        "labels": config.CLASS_LABELS,
        "colors": {
            config.CLASS_LABELS[k]: list(v)
            for k, v in CONFIDENCE_COLORS.items()
            if k != config.CLASS_MASKED
        },
        "counts": counts,
        "masked_cells": int(masked.sum()),
        "source_shape": [int(raw.shape[0]), int(raw.shape[1])],
        "raster_shape": [img.size[1], img.size[0]],
        "nearest_neighbour_resized": resized,
        "bytes": len(png),
        "sha256": hashlib.sha256(png).hexdigest(),
    }
    return png, meta


def field_stats(field: np.ndarray) -> dict[str, Any]:
    """Descriptive statistics over FINITE cells only, plus the invalid count."""
    arr = np.asarray(field, dtype=np.float64)
    finite = arr[np.isfinite(arr)]
    n_total = int(arr.size)
    if finite.size == 0:
        return {
            "n_cells": n_total,
            "n_valid": 0,
            "n_invalid": n_total,
            "min": None, "mean": None, "max": None,
            "p05": None, "p50": None, "p95": None,
        }
    return {
        "n_cells": n_total,
        "n_valid": int(finite.size),
        "n_invalid": n_total - int(finite.size),
        "valid_fraction": round(float(finite.size) / n_total, 6) if n_total else None,
        "min": float(finite.min()),
        "mean": float(finite.mean()),
        "max": float(finite.max()),
        "p05": float(np.percentile(finite, 5)),
        "p50": float(np.percentile(finite, 50)),
        "p95": float(np.percentile(finite, 95)),
    }


def cell_area_km2(lat: np.ndarray) -> np.ndarray:
    """Per-row 0.25 deg cell area in km^2 (broadcast across columns).

    Derived from the grid resolution actually used by the repository
    (``routing_metadata.json: resolution_deg = 0.25``).
    """
    res = 0.25
    h = 6371.0 * math.radians(res)
    w = 6371.0 * math.radians(res) * np.cos(np.radians(np.asarray(lat, dtype=np.float64)))
    return np.broadcast_to((h * w)[:, None], (np.size(lat), 1))


#: Legend definitions returned to the frontend so both sides agree on colour.
LEGENDS: dict[str, dict[str, Any]] = {
    "sic": {
        "title": "Sea-ice concentration",
        "unit": "SIC fraction (0-1)",
        "domain": [0.0, 1.0],
        "stops": [{"value": v, "color": f"rgb({r},{g},{b})"} for v, r, g, b in SIC_STOPS],
    },
    "uncertainty": {
        "title": "Forecast uncertainty (1 sigma)",
        "unit": "SIC fraction std (0-1); combined ensemble + MC-dropout spread",
        "domain": [0.0, 0.40],
        "stops": [
            {"value": v, "color": f"rgb({r},{g},{b})"} for v, r, g, b in UNCERTAINTY_STOPS
        ],
    },
    "risk": {
        "title": "Environmental cost field",
        "unit": "weighted cost (dimensionless)",
        "domain": [0.0, 1.0],
        "stops": [{"value": v, "color": f"rgb({r},{g},{b})"} for v, r, g, b in RISK_STOPS],
    },
    "confidence": {
        "title": "Forecast confidence class",
        "unit": "categorical",
        "classes": {
            "high": "rgb({},{},{})".format(*CONFIDENCE_COLORS[config.CLASS_HIGH]),
            "medium": "rgb({},{},{})".format(*CONFIDENCE_COLORS[config.CLASS_MEDIUM]),
            "low": "rgb({},{},{})".format(*CONFIDENCE_COLORS[config.CLASS_LOW]),
            "masked": "transparent (no value)",
        },
    },
}

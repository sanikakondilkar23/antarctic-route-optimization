"""
Per-layer provenance and availability.

A layer is only reported ``REAL`` when real data actually reached the
``EnvironmentalGrid`` that the route optimizer consumed.  The existence of a
loader, a class or a config entry is never sufficient evidence.

Statuses
--------
``REAL``
    Real measured/modelled data is present on the grid that produced the route.
``SYNTHETIC``
    Data came from ``src/environment/synthetic.py`` or another explicitly
    synthetic generator.  Never a valid basis for a reported route.
``DEMO``
    Committed demo/verification artifact rather than a live environmental
    layer.
``NOT_AVAILABLE``
    The dataset is not reachable in this deployment.  ``reason`` says where it
    was looked for.
``NOT_CONNECTED``
    A loader for this layer exists in the project but is not wired into the
    grid-building path used by the API.
``PARTIAL``
    Real data is present and finite over part of the grid only.  The layer is
    genuinely REAL data, but its spatial coverage is incomplete, so it cannot
    be described as complete and must not be required to be finite everywhere.
    ``reason`` states the coverage and ``covered_cells``/``n_cells`` quantify
    it.  Partial coverage is never hidden and never filled in.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

import numpy as np


class LayerStatus(str, Enum):
    REAL = "REAL"
    PARTIAL = "PARTIAL"
    SYNTHETIC = "SYNTHETIC"
    DEMO = "DEMO"
    NOT_AVAILABLE = "NOT_AVAILABLE"
    NOT_CONNECTED = "NOT_CONNECTED"


#: Logical layer name -> the ``EnvironmentalGrid`` attribute that carries it.
LAYER_ATTRIBUTES: Dict[str, str] = {
    "sic_mean": "sic_mean",
    "sic_uncertainty": "sic_uncertainty",
    "current_uo": "current_uo",
    "current_vo": "current_vo",
    "current_cost": "current_cost",
    "wind_cost": "wind_cost",
    "iceberg_risk": "iceberg_risk",
    "iceberg_risk_uncertainty": "iceberg_risk_uncertainty",
    "depth": "depth",
    "ice_multiplier": "ice_multiplier",
}

#: Which dataset each logical layer is expected to come from.
LAYER_DATASET: Dict[str, str] = {
    "sic_mean": "sic",
    "sic_uncertainty": "sic",
    "current_uo": "cmems_future",
    "current_vo": "cmems_future",
    "current_cost": "cmems_future",
    "wind_cost": "era5",
    "iceberg_risk": "icebergs",
    "iceberg_risk_uncertainty": "icebergs",
    "depth": "gebco",
    "ice_multiplier": "sic",
}


@dataclass
class LayerRecord:
    """Availability + provenance of one environmental layer."""

    name: str
    status: str
    source: Optional[str] = None
    reason: Optional[str] = None
    dataset: Optional[str] = None
    #: True only when this layer's values were read by the cost map that
    #: produced the reported route.
    in_cost: bool = False
    finite_cells: Optional[int] = None
    n_cells: Optional[int] = None
    #: Cells that MUST be finite because this layer is required. Only set for
    #: required layers; optional layers record coverage, not an obligation.
    required_cells: Optional[int] = None
    covered_required_cells: Optional[int] = None

    def to_dict(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "name": self.name,
            "status": self.status,
            "dataset": self.dataset,
            "source": self.source,
            "reason": self.reason,
            "in_cost": self.in_cost,
        }
        if self.finite_cells is not None:
            out["finite_cells"] = self.finite_cells
            out["n_cells"] = self.n_cells
        if self.required_cells is not None:
            out["required_cells"] = self.required_cells
            out["covered_required_cells"] = self.covered_required_cells
        return out


def _finite_count(arr: Optional[np.ndarray]) -> Optional[int]:
    if arr is None:
        return None
    return int(np.isfinite(np.asarray(arr, dtype=np.float64)).sum())


def record(name: str, status: LayerStatus, **kwargs: Any) -> LayerRecord:
    """Build a :class:`LayerRecord` with the dataset key filled in."""
    kwargs.setdefault("dataset", LAYER_DATASET.get(name))
    return LayerRecord(name=name, status=status.value, **kwargs)


def build_registry(
    grid: Any,
    *,
    cost_layers: Optional[List[str]] = None,
    sources: Optional[Dict[str, str]] = None,
    reasons: Optional[Dict[str, str]] = None,
    required_layers: Optional[List[str]] = None,
) -> Dict[str, LayerRecord]:
    """
    Derive the availability of every logical layer from a built grid.

    ``cost_layers`` is the set of layer names the cost map actually read; it
    is what separates "loaded" from "influenced the route".

    ``required_layers`` is the set that navigation *depends on* (SIC and its
    navigability).  Those must be finite on every navigable cell.  Every other
    layer is an optional cost term: real-but-partially-covered data is reported
    ``PARTIAL`` with its coverage counts, never ``REAL`` and never filled in.
    """
    sources = sources or {}
    reasons = reasons or {}
    cost_layers = set(cost_layers or ())
    required = set(required_layers or ())

    out: Dict[str, LayerRecord] = {}
    for name, attr in LAYER_ATTRIBUTES.items():
        arr = getattr(grid, attr, None)
        is_required = name in required
        if arr is None:
            out[name] = record(
                name,
                LayerStatus.NOT_AVAILABLE,
                reason=reasons.get(name, "layer not present on the EnvironmentalGrid"),
                in_cost=name in cost_layers,
            )
            continue

        data = np.asarray(arr, dtype=np.float64)
        finite = np.isfinite(data)
        n_finite = int(finite.sum())
        n_cells = int(data.size)

        # For a required layer the obligation is defined over the navigable
        # cells; for an optional one it is defined over the whole grid, because
        # "partially covered" is a statement about the layer, not the route.
        if is_required:
            nav = np.asarray(getattr(grid, "navigable", np.ones_like(finite)), dtype=bool)
            need = int(nav.sum())
            covered = int((finite & nav).sum())
            full_coverage = bool(need == 0 or covered == need)
        else:
            need = n_cells
            covered = n_finite
            full_coverage = bool(n_finite == n_cells)

        if n_finite == 0:
            status = LayerStatus.NOT_AVAILABLE
            reason = reasons.get(name, "layer present but contains no finite cell")
        elif not full_coverage:
            status = LayerStatus.PARTIAL
            reason = reasons.get(name) or (
                f"real data over {covered:,}/{need:,} required cells "
                f"({100.0 * covered / need:.1f}%); the rest is undefined and is "
                f"left as NaN, never filled")
        else:
            status = LayerStatus.REAL
            reason = reasons.get(name)

        out[name] = record(
            name,
            status,
            source=sources.get(name),
            reason=reason,
            in_cost=name in cost_layers,
            finite_cells=n_finite,
            n_cells=n_cells,
            required_cells=need,
            covered_required_cells=covered,
        )
    return out


def registry_to_dict(
    registry: Dict[str, LayerRecord],
    *,
    cost_layers: Optional[List[str]] = None,
    extras: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Serialise a registry for an API response."""
    layers = [r.to_dict() for r in registry.values()]
    real = [r["name"] for r in layers if r["status"] == LayerStatus.REAL.value]
    partial = [r["name"] for r in layers if r["status"] == LayerStatus.PARTIAL.value]
    available = [r["name"] for r in layers
                 if r["status"] in (LayerStatus.REAL.value,
                                    LayerStatus.PARTIAL.value,
                                    LayerStatus.SYNTHETIC.value,
                                    LayerStatus.DEMO.value)]
    in_cost = sorted(r["name"] for r in layers if r["in_cost"])
    payload: Dict[str, Any] = {
        "layers": layers,
        "real": sorted(real),
        "partial": sorted(partial),
        "available": sorted(available),
        "not_available": sorted(r["name"] for r in layers
                                if r["status"] == LayerStatus.NOT_AVAILABLE.value),
        "layers_in_cost": in_cost,
        "cost_layers_requested": sorted(cost_layers) if cost_layers else None,
        "status_semantics": {
            LayerStatus.REAL.value: "real data, finite everywhere it is required",
            LayerStatus.PARTIAL.value:
                "real data with incomplete spatial coverage; undefined cells stay "
                "NaN and the layer must not be required to be finite everywhere",
            LayerStatus.NOT_AVAILABLE.value: "no reachable data source in this deployment",
        },
    }
    if extras:
        payload.update(extras)
    return payload

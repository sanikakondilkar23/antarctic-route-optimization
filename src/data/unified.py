"""
Unified route-grid assembly.

One function builds the ``EnvironmentalGrid`` that the route optimizer
consumes, from every environmental layer that is genuinely reachable in this
deployment, and reports the provenance of each one.

Design rules enforced here
--------------------------
* SIC is the only layer with a committed in-repository artifact, so it is the
  only one that can be ``REAL`` without external data.
* Every other layer is attached only if its dataset is actually reachable
  (see :mod:`src.data.paths`).  When it is not, the layer stays absent or
  all-NaN and is reported ``NOT_AVAILABLE`` with the paths that were searched.
  Nothing is substituted.
* A layer is reported ``in_cost`` only when ``CostMap`` actually read it,
  which is derived from the active weights rather than asserted.
* Layers are never resized, cropped or zero-filled: each adapter either
  aligns to the route grid by coordinate or raises.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from src.data import paths as data_paths
from src.data.layer_status import (
    LayerStatus,
    build_registry,
    record,
)
from src.data.sic_forecast import SICForecastField
from src.environment.grid import EnvironmentalGrid
from src.routing.cost import CostMap, CostWeights

#: Logical layer -> the Drive dataset that supplies it.
LAYER_ADAPTERS: Dict[str, str] = {
    "wind_cost": "era5",
    "current_uo": "cmems_future",
    "iceberg_risk": "icebergs",
    "depth": "gebco",
}

#: Layers navigation depends on. These must be finite wherever the vessel may
#: go; a gap in one of them invalidates the grid itself. Everything not listed
#: here is an OPTIONAL cost term: real-but-partial data is reported as
#: ``PARTIAL`` and may only affect a route when its weight is non-zero AND its
#: coverage reaches the cells the term is applied to.
REQUIRED_NAVIGATION_LAYERS: Tuple[str, ...] = ("sic_mean",)

#: Logical layer -> the reason recorded when its dataset is unreachable.
UNAVAILABLE_REASON: Dict[str, str] = {
    "wind_cost": "ERA5 wind dataset not reachable; SIH_DATA_ROOT unset or the "
                 "ERA5 directory is absent",
    "current_uo": "CMEMS current dataset not reachable; SIH_DATA_ROOT unset or "
                  "the CMEMS directory is absent",
    "iceberg_risk": "iceberg risk dataset not reachable; no predictor output "
                    "and SIH_DATA_ROOT unset or the ICEBERGS directory is absent",
    "depth": "GEBCO bathymetry not reachable; SIH_DATA_ROOT unset or the GEBCO "
             "directory is absent",
    "sic_uncertainty": "committed uncertainty artifact missing",
}


def native_template(field: SICForecastField) -> EnvironmentalGrid:
    """Blank route-grid template matching the committed SIC grid exactly."""
    from src.data.builder import build_grid_template

    spec = field.grid_spec()
    return build_grid_template(
        lat_min=spec["lat_min"], lat_max=spec["lat_max"],
        lon_min=spec["lon_min"], lon_max=spec["lon_max"],
        resolution_deg=spec["resolution_deg"],
    )


def apply_land_extension_mask(
    grid: EnvironmentalGrid, cache_dir: Path, n_model_rows: int
) -> Tuple[EnvironmentalGrid, str]:
    """
    AND the committed GEBCO land mask for the extension band into navigability.

    The model band (rows 0..n_model_rows) already carries a land mask through
    SIC NaN.  The extension band (n_model_rows..end, which contains Cape Town)
    does not, and without this the optimizer may treat land as open water.
    """
    mask_path = Path(cache_dir) / "routing_land_extension.npy"
    if not mask_path.is_file():
        return grid, "NOT_AVAILABLE: routing_land_extension.npy is absent"
    mask = np.load(str(mask_path))
    if mask.ndim != 2 or mask.shape[0] != grid.n_rows - n_model_rows:
        return grid, (f"NOT_APPLIED: land mask shape {mask.shape} does not "
                      f"match the extension band of the route grid")
    band = mask.shape[0]
    grid.navigable[n_model_rows:n_model_rows + band, :] &= ~mask
    return grid, f"REAL: GEBCO land mask, {int(mask.sum())} land cells removed"


def attach_optional_layers(
    grid: EnvironmentalGrid, t_hours: float
) -> Tuple[EnvironmentalGrid, Dict[str, str], Dict[str, str]]:
    """
    Attach every Drive-backed layer that is reachable for this deployment.

    Returns ``(grid, sources, reasons)``.  A layer whose dataset cannot be
    reached is left absent on the grid; nothing is fabricated for it.
    """
    from src.data.adapters import (
        BathymetryAdapter,
        CMEMSDateAwareAdapter,
        IcebergAdapter,
        WindAdapter,
    )

    sources: Dict[str, str] = {}
    reasons: Dict[str, str] = {}
    template = grid

    wind_root = data_paths.layer_path("era5") or data_paths.layer_path("ecmwf_ens")
    if wind_root is not None and wind_root.is_dir():
        files = sorted(p for p in wind_root.rglob("*.nc"))
        if files:
            try:
                grid = WindAdapter(path=str(files[0])).load(t_hours, template)
                sources["wind_cost"] = str(files[0])
            except Exception as exc:
                reasons["wind_cost"] = f"NOT_AVAILABLE: {type(exc).__name__}: {exc}"
        else:
            reasons["wind_cost"] = f"NOT_AVAILABLE: no netCDF under {wind_root}"
    else:
        reasons["wind_cost"] = UNAVAILABLE_REASON["wind_cost"]

    cmems_root = (data_paths.layer_path("cmems_future")
                  or data_paths.layer_path("copernicus_ocean")
                  or data_paths.layer_path("cmems_phy"))
    if cmems_root is not None and cmems_root.is_dir():
        try:
            adapter = CMEMSDateAwareAdapter(
                cmems_root=str(cmems_root),
                route_start_datetime=_route_start(grid),
            )
            grid = adapter.load(t_hours, grid)
            sources["current_uo"] = str(cmems_root)
            sources["current_vo"] = str(cmems_root)
        except Exception as exc:
            reasons["current_uo"] = f"NOT_AVAILABLE: {type(exc).__name__}: {exc}"
            reasons["current_vo"] = reasons["current_uo"]
    else:
        reasons["current_uo"] = UNAVAILABLE_REASON["current_uo"]
        reasons["current_vo"] = UNAVAILABLE_REASON["current_uo"]

    iceberg = data_paths.layer_path("icebergs")
    if iceberg is not None and iceberg.exists():
        try:
            grid = IcebergAdapter(path=str(iceberg)).load(t_hours, grid)
            sources["iceberg_risk"] = str(iceberg)
        except Exception as exc:
            reasons["iceberg_risk"] = (f"NOT_AVAILABLE: {type(exc).__name__}: "
                                       f"{exc}")
    else:
        reasons["iceberg_risk"] = UNAVAILABLE_REASON["iceberg_risk"]

    gebco = data_paths.layer_path("gebco")
    if gebco is not None and gebco.is_dir():
        files = sorted(p for p in gebco.rglob("*.nc"))
        if files:
            try:
                grid = BathymetryAdapter(path=str(files[0])).load(t_hours, grid)
                sources["depth"] = str(files[0])
            except Exception as exc:
                reasons["depth"] = f"NOT_AVAILABLE: {type(exc).__name__}: {exc}"
        else:
            reasons["depth"] = f"NOT_AVAILABLE: no netCDF under {gebco}"
    else:
        reasons["depth"] = UNAVAILABLE_REASON["depth"]

    return grid, sources, reasons


def _route_start(grid: EnvironmentalGrid) -> Optional[datetime]:
    return getattr(grid, "_route_start_datetime", None)


def build_route_grid(
    t_index: int,
    *,
    cache_dir: Path,
    route_start: datetime,
    weights: Optional[CostWeights] = None,
    apply_ice_multiplier: bool = False,
) -> Tuple[EnvironmentalGrid, CostMap, Dict[str, Any]]:
    """
    Build the unified EnvironmentalGrid and its CostMap for one timestep.

    Returns ``(grid, cost_map, report)`` where ``report`` carries the layer
    registry, the land-mask status and the cost breakdown.
    """
    weights = weights or CostWeights()
    field = SICForecastField(cache_dir=str(cache_dir),
                             route_start_datetime=route_start)

    grid = native_template(field)
    setattr(grid, "_route_start_datetime", route_start)

    grid = field.load(t_hours=float(t_index) * 24.0, grid_template=grid)

    sources: Dict[str, str] = {
        "sic_mean": str(Path(cache_dir) / "routing_sic_2026.npy"),
        "sic_uncertainty": str(Path(cache_dir) / "uncertainty_2026.npy"),
    }
    reasons: Dict[str, str] = {}

    if apply_ice_multiplier:
        if field.has_multiplier:
            grid.ice_multiplier = field.multiplier(time_index=t_index)
            sources["ice_multiplier"] = str(
                Path(cache_dir) / "routing_multiplier_2026.npy")
        else:
            reasons["ice_multiplier"] = (
                "NOT_AVAILABLE: routing_multiplier_2026.npy is absent")

    n_model_rows = int(field.metadata.model_band_rows[1])
    grid, land_status = apply_land_extension_mask(grid, Path(cache_dir),
                                                  n_model_rows)

    grid, opt_sources, opt_reasons = attach_optional_layers(
        grid, float(t_index) * 24.0)
    sources.update(opt_sources)
    reasons.update(opt_reasons)

    cost_map = CostMap(grid, weights)

    # SIC is the one layer navigation *depends on*: it defines both the cost
    # and the navigable mask. Everything else is an optional cost term, so it
    # is allowed to be absent or partially covered without invalidating a
    # route that never consumed it.
    registry = build_registry(grid, cost_layers=cost_map.layers_in_cost,
                              sources=sources, reasons=reasons,
                              required_layers=REQUIRED_NAVIGATION_LAYERS)
    grid.layer_status = {k: v.status for k, v in registry.items()}
    grid.layer_provenance = {k: v.to_dict() for k, v in registry.items()}

    report = {
        "registry": registry,
        "cost_breakdown": cost_map.breakdown(),
        "land_mask": land_status,
        "grid": {
            "n_rows": grid.n_rows,
            "n_cols": grid.n_cols,
            "resolution_deg": grid.resolution_deg,
            "lat_range": [float(grid.lat[0]), float(grid.lat[-1])],
            "lon_range": [float(grid.lon[0]), float(grid.lon[-1])],
        },
    }
    return grid, cost_map, report

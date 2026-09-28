"""
Environment Function Builder
=============================

Assembles a callable env_fn(t) -> EnvironmentalGrid from configured
data adapters. This is the bridge between real datasets and td_astar.

Usage::

    from src.data.config import DataConfig
    from src.data.builder import build_env_fn, build_grid_template

    grid = build_grid_template(
        lat_min=-80.0, lat_max=-50.0,
        lon_min=-180.0, lon_max=180.0,
        resolution_deg=0.25,
    )
    config = DataConfig(
        sic_path="/content/drive/MyDrive/data/sic.nc",
        current_path="/content/drive/MyDrive/data/cmems_current.nc",
    )
    env_fn = build_env_fn(config, grid)
    result = td_astar(grid, start, goal, env_fn=env_fn)
"""

from __future__ import annotations

from typing import Callable, Iterable, Optional

import numpy as np

from src.data.adapters import (
    SICAdapter,
    CMEMSCurrentAdapter,
    CMEMSDateAwareAdapter,
    IcebergAdapter,
    WindAdapter,
    BathymetryAdapter,
    BaseAdapter,
)
from src.data.sic_forecast import SICForecastField
from src.data.config import DataConfig
from src.environment.grid import EnvironmentalGrid

#: Logical layer -> the ``paths`` dataset key used when reporting where a
#: missing layer was looked for.
_PATHS_LAYER = {
    "sic_mean": "sic",
    "iceberg_risk": "icebergs",
    "wind_cost": "era5",
    "depth": "gebco",
}


def build_grid_template(
    lat_min: float = -80.0,
    lat_max: float = -50.0,
    lon_min: float = -180.0,
    lon_max: float = 180.0,
    resolution_deg: float = 0.25,
) -> EnvironmentalGrid:
    """
    Construct an empty routing-grid template from geographic bounds.

    Returns an EnvironmentalGrid with navigable=True everywhere and
    no data layers populated.  Adapters fill sic_mean, current_uo, etc.
    at runtime.

    Parameters
    ----------
    lat_min, lat_max : float
        Southern and northern latitude bounds (degrees, WGS84).
        Must satisfy lat_min < lat_max.
    lon_min, lon_max : float
        Western and eastern longitude bounds (degrees, WGS84).
        Must satisfy lon_min < lon_max.
    resolution_deg : float
        Uniform grid spacing in degrees.  At -65 deg latitude,
        0.25 deg is approximately 28 km — a practical uniform
        geographic spacing, NOT an exact metric distance.

    Returns
    -------
    EnvironmentalGrid
        Blank grid with navigable=True everywhere.
    """
    if lat_min >= lat_max:
        raise ValueError(f"lat_min ({lat_min}) must be < lat_max ({lat_max})")
    if lon_min >= lon_max:
        raise ValueError(f"lon_min ({lon_min}) must be < lon_max ({lon_max})")
    if resolution_deg <= 0:
        raise ValueError(f"resolution_deg must be > 0, got {resolution_deg}")

    n_rows = int(round((lat_max - lat_min) / resolution_deg)) + 1
    n_cols = int(round((lon_max - lon_min) / resolution_deg)) + 1

    lat = np.linspace(lat_min, lat_max, n_rows)
    lon = np.linspace(lon_min, lon_max, n_cols)

    navigable = np.ones((n_rows, n_cols), dtype=bool)

    return EnvironmentalGrid(
        n_rows=n_rows,
        n_cols=n_cols,
        lat=lat,
        lon=lon,
        navigable=navigable,
        resolution_deg=resolution_deg,
    )


def build_env_fn(
    config: DataConfig,
    grid_template: EnvironmentalGrid,
    *,
    require: Optional[Iterable[str]] = None,
) -> Callable[[float], EnvironmentalGrid]:
    """
    Build a time-dependent environment function from a DataConfig.

    Parameters
    ----------
    config : DataConfig
        Configuration specifying dataset paths and adapter parameters.
    grid_template : EnvironmentalGrid
        Template grid defining shape, lat/lon, navigability.
        Adapters populate layers onto copies of this grid.
    require : iterable of str, optional
        Layer names that MUST reach the grid as real data (e.g. ``("sic_mean",)``).
        A required layer whose adapter is unavailable, or which produces no
        finite cell, raises ``RuntimeError`` naming the layer, the adapter and
        every path that was searched.  Defaults to ``None`` (nothing required),
        so existing callers keep their behaviour.

    Returns
    -------
    callable
        env_fn(t_hours) -> EnvironmentalGrid
        Returns the environmental grid at time t_hours.

    Notes
    -----
    Availability is explicit.  An adapter whose dataset is not reachable is
    left out of the chain and recorded in :func:`availability`, so its layer
    stays ``None`` on the grid and downstream code sees "no data" rather than a
    plausible-looking value.  A missing dataset is never replaced by
    synthetic data: ``allow_synthetic_fallback`` is rejected by
    :meth:`DataConfig.validate`, and this builder never imports
    ``src/environment/synthetic.py``.
    """
    config.validate()

    # Create adapters from config
    # SIC: prefer the teammate's committed 2026 forecast artifacts when a
    # cache dir is configured; otherwise fall back to the netCDF SICAdapter.
    if config.sic_forecast_cache_dir:
        sic_adapter: BaseAdapter = SICForecastField(
            cache_dir=config.sic_forecast_cache_dir,
            route_start_datetime=config.route_start_datetime,
            horizon=config.sic_forecast_horizon,
        )
    else:
        sic_adapter = SICAdapter(
            path=config.sic_path,
            variable=config.sic_variable,
            uncertainty_variable=config.sic_uncertainty_variable,
            time_dim=config.sic_time_dim,
            lat_dim=config.sic_lat_dim,
            lon_dim=config.sic_lon_dim,
            x_dim=config.sic_x_dim,
            y_dim=config.sic_y_dim,
            crs=config.sic_crs,
            route_start_datetime=config.route_start_datetime,
            source_format=config.sic_source_format,
            source_lon_bounds=config.sic_source_lon_bounds,
            source_lat_bounds=config.sic_source_lat_bounds,
            max_nn_distance_deg=config.sic_max_nn_distance_deg,
        )

    # Use date-aware CMEMS adapter when cmems_root + route_start_datetime
    # are configured.  Otherwise fall back to single-file adapter.
    if config.cmems_root and config.route_start_datetime:
        current_adapter: BaseAdapter = CMEMSDateAwareAdapter(
            cmems_root=config.cmems_root,
            route_start_datetime=config.route_start_datetime,
            lat_var=config.current_latitude_var,
            lon_var=config.current_longitude_var,
            uo_var=config.current_uo_var,
            vo_var=config.current_vo_var,
        )
    else:
        current_adapter = CMEMSCurrentAdapter(
            path=config.current_path,
            uo_var=config.current_uo_var,
            vo_var=config.current_vo_var,
            time_dim=config.current_time_dim,
            lat_dim=config.current_latitude_var,
            lon_dim=config.current_longitude_var,
            depth_var=config.current_depth_var,
        )

    iceberg_adapter = IcebergAdapter(
        path=config.iceberg_path,
        variable=config.iceberg_variable,
        is_numpy=config.iceberg_is_numpy,
        route_start_datetime=config.route_start_datetime,
    )

    wind_adapter = WindAdapter(
        path=config.wind_path,
        u_var=config.wind_u_var,
        v_var=config.wind_v_var,
        time_dim=config.wind_time_dim,
        lat_dim=config.current_latitude_var,
        lon_dim=config.current_longitude_var,
    )

    bathy_adapter = BathymetryAdapter(
        path=config.bathy_path,
        lat_dim=config.current_latitude_var,
        lon_dim=config.current_longitude_var,
    )

    # Every adapter, and which of them will actually run.  An unavailable
    # adapter stays out of the chain; its layer is then simply absent.
    candidates = [
        ("sic_mean", sic_adapter),
        ("current_uo", current_adapter),
        ("iceberg_risk", iceberg_adapter),
        ("wind_cost", wind_adapter),
        ("depth", bathy_adapter),
    ]
    active_adapters = [a for _, a in candidates if a.is_available()]
    report = availability(config, candidates)

    if require:
        missing = []
        for layer in require:
            owner = dict(candidates).get(layer)
            if owner is None or not owner.is_available():
                missing.append(layer)
        if missing:
            raise RuntimeError(
                "required environmental layer(s) unavailable: "
                + ", ".join(missing)
                + ". No synthetic substitute is used; supply the real dataset "
                "or drop the requirement.\n"
                + "\n".join(
                    f"  {name}: {'available' if ok else reason}"
                    for name, ok, reason in report
                )
            )

    def env_fn(t_hours: float) -> EnvironmentalGrid:
        """
        Return the environmental grid at time t_hours.

        Applies each available adapter in sequence:
        1. Start from grid_template
        2. Apply each adapter (SIC, current, iceberg, wind, bathymetry)
        3. Return the fully populated grid
        """
        grid = grid_template
        for adapter in active_adapters:
            grid = adapter.load(t_hours, grid)
        return grid

    # Expose what actually ran, so a caller can state the inputs of a route.
    env_fn.adapters = [type(a).__name__ for a in active_adapters]  # type: ignore[attr-defined]
    env_fn.availability = report  # type: ignore[attr-defined]
    env_fn.active_adapters = active_adapters  # type: ignore[attr-defined]
    return env_fn


def availability(config: DataConfig, candidates=None) -> list:
    """
    Explicit per-layer availability record: ``(layer, available, reason)``.

    A layer is reported unavailable, with the reason, rather than quietly
    omitted or replaced.  Used by :func:`build_env_fn` and available on its own
    for a deployment check before any route is planned.
    """
    from src.data import paths as _paths

    def _reason(layer: str, adapter) -> str:
        if adapter is not None and adapter.is_available():
            return "available"
        if layer == "sic_mean":
            searched = "; ".join(_paths.searched_paths("sic"))
        elif layer in ("current_uo", "current_vo"):
            searched = "; ".join(_paths.searched_paths("copernicus_ocean"))
        else:
            searched = "; ".join(_paths.searched_paths(_PATHS_LAYER.get(layer, "sic")))
        return f"no reachable real dataset (searched: {searched})"

    if candidates is None:
        return [
            (name, False, "adapter not constructed; call build_env_fn() "
                          "to get the real availability record")
            for name in ("sic_mean", "current_uo", "iceberg_risk",
                         "wind_cost", "depth")
        ]

    return [
        (name, bool(adapter is not None and adapter.is_available()),
         _reason(name, adapter))
        for name, adapter in candidates
    ]



def build_env_fn_from_adapters(
    grid_template: EnvironmentalGrid,
    adapters: list,
) -> Callable[[float], EnvironmentalGrid]:
    """
    Build env_fn from a list of pre-configured adapter instances.

    Useful when you need fine-grained control over adapter configuration.
    Unavailable adapters are left out of the chain and exposed on
    ``env_fn.availability``; they are never replaced by synthetic data.

    Parameters
    ----------
    grid_template : EnvironmentalGrid
        Template grid.
    adapters : list
        List of adapter instances (SICAdapter, CMEMSCurrentAdapter, etc.)

    Returns
    -------
    callable
        env_fn(t_hours) -> EnvironmentalGrid
    """
    active = [a for a in adapters if a.is_available()]

    def env_fn(t_hours: float) -> EnvironmentalGrid:
        grid = grid_template
        for adapter in active:
            grid = adapter.load(t_hours, grid)
        return grid

    env_fn.adapters = [type(a).__name__ for a in active]  # type: ignore[attr-defined]
    env_fn.availability = [  # type: ignore[attr-defined]
        (type(a).__name__, bool(a.is_available()),
         "available" if a.is_available()
         else f"dataset not reachable at {getattr(a, 'path', None)!r}")
        for a in adapters
    ]
    env_fn.active_adapters = active  # type: ignore[attr-defined]
    return env_fn

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

from typing import Callable, Optional

import numpy as np

from src.data.adapters import (
    SICAdapter,
    CMEMSCurrentAdapter,
    CMEMSDateAwareAdapter,
    IcebergAdapter,
    WindAdapter,
    BathymetryAdapter,
)
from src.data.sic_forecast import SICForecastField
from src.data.config import DataConfig
from src.environment.grid import EnvironmentalGrid


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

    Returns
    -------
    callable
        env_fn(t_hours) -> EnvironmentalGrid
        Returns the environmental grid at time t_hours.
    """
    # Create adapters from config
    # SIC: prefer the teammate's committed 2026 forecast artifacts when a
    # cache dir is configured; otherwise fall back to the netCDF SICAdapter.
    if config.sic_forecast_cache_dir:
        sic_adapter = SICForecastField(
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
        )

    # Use date-aware CMEMS adapter when cmems_root + route_start_datetime
    # are configured.  Otherwise fall back to single-file adapter.
    if config.cmems_root and config.route_start_datetime:
        current_adapter = CMEMSDateAwareAdapter(
            cmems_root=config.cmems_root,
            route_start_datetime=config.route_start_datetime,
        )
    else:
        current_adapter = CMEMSCurrentAdapter(
            path=config.current_path,
            uo_var=config.current_uo_var,
            vo_var=config.current_vo_var,
            time_dim=config.current_time_dim,
            lat_dim=config.current_lat_dim,
            lon_dim=config.current_lon_dim,
            depth_var=config.current_depth_var,
        )

    iceberg_adapter = IcebergAdapter(
        path=config.iceberg_path,
        variable=config.iceberg_variable,
        is_numpy=config.iceberg_is_numpy,
    )

    wind_adapter = WindAdapter(
        path=config.wind_path,
        u_var=config.wind_u_var,
        v_var=config.wind_v_var,
        time_dim=config.wind_time_dim,
        lat_dim=config.sic_lat_dim,
        lon_dim=config.sic_lon_dim,
    )

    bathy_adapter = BathymetryAdapter(
        path=config.bathy_path,
        lat_dim=config.sic_lat_dim,
        lon_dim=config.sic_lon_dim,
    )

    # Collect active adapters
    active_adapters = []
    for adapter in [sic_adapter, current_adapter, iceberg_adapter,
                    wind_adapter, bathy_adapter]:
        if adapter.is_available():
            active_adapters.append(adapter)

    def env_fn(t_hours: float) -> EnvironmentalGrid:
        """
        Return the environmental grid at time t_hours.

        Applies each active adapter in sequence:
        1. Start from grid_template
        2. Apply each adapter (SIC, current, iceberg, wind, bathymetry)
        3. Return the fully populated grid
        """
        grid = grid_template
        for adapter in active_adapters:
            grid = adapter.load(t_hours, grid)
        return grid

    return env_fn


def build_env_fn_from_adapters(
    grid_template: EnvironmentalGrid,
    adapters: list,
) -> Callable[[float], EnvironmentalGrid]:
    """
    Build env_fn from a list of pre-configured adapter instances.

    Useful when you need fine-grained control over adapter configuration.

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

    return env_fn

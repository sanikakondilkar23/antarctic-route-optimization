"""
Data Integration Module
=======================

Adapters that convert real dataset outputs (CMEMS, ERA5, GEBCO, teammate
iceberg predictions) into EnvironmentalGrid-compatible layers for the
time-dependent route optimizer.

Architecture:
    Drive/Colab datasets
            |
    data adapters/loaders
            |
    time-indexed environmental fields
            |
    EnvironmentalGrid
            |
    env_fn(t)
            |
    existing td_astar
            |
    route

Usage::

    from src.data.config import DataConfig
    from src.data.builder import build_env_fn

    config = DataConfig(sic_path="/content/drive/MyDrive/sic.nc", ...)
    env_fn = build_env_fn(config, grid_template)
    result = td_astar(grid_template, start, goal, env_fn=env_fn)

    # Date-aware CMEMS loading (M4.7):
    from datetime import datetime
    config = DataConfig(
        cmems_root="/content/drive/MyDrive/SIH_26_Sanika/dataset/Copernicus_Ocean",
        route_start_datetime=datetime(2025, 1, 1, 0, 0),
    )
    env_fn = build_env_fn(config, grid_template)
"""

from src.data.adapters import (
    SICAdapter,
    SICForecasterAdapter,
    CMEMSCurrentAdapter,
    CMEMSDateAwareAdapter,
    IcebergAdapter,
    WindAdapter,
    BathymetryAdapter,
)
from src.data.sic_forecast import SICForecastField, SICForecastMetadata
from src.data.builder import build_env_fn, build_grid_template
from src.data.config import DataConfig
from src.data.cmems_loader import (
    CMEMSDateAwareLoader,
    current_speed_from_uv,
    resolve_cmems_path,
)

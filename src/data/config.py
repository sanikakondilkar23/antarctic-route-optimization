"""
Dataset Path Configuration
===========================

Configure paths to real datasets via environment variables or direct
instantiation. Designed for Google Colab / Google Drive workflows.

Environment variables (all optional, override defaults):
    ARctic_SIC_PATH       - SIC netCDF file
    ARctic_CURRENT_PATH   - CMEMS current netCDF file
    ARctic_ICEBERG_PATH   - iceberg risk netCDF/numpy file
    ARctic_WIND_PATH      - wind netCDF file
    ARctic_BATHY_PATH     - bathymetry/netCDF file
    ARctic_GRID_rows      - grid rows (if not inferred from data)
    ARctic_GRID_cols      - grid cols
    ARctic_LAT_MIN        - latitude min
    ARctic_LAT_MAX        - latitude max
    ARctic_LON_MIN        - longitude min
    ARctic_LON_MAX        - longitude max
    ARctic_CMEMS_ROOT     - CMEMS root directory for date-aware loading
    ARctic_ROUTE_START    - route start datetime (ISO format, UTC)
    ARCTIC_SIC_FORECAST_CACHE   - directory with the teammate's committed SIC
                                  forecast artifacts (e.g. backend/cache)
    ARCTIC_SIC_FORECAST_HORIZON - uncertainty horizon (0 = D+1, 1 = D+2, 2 = D+3)
"""

import os
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class DataConfig:
    """
    Paths and parameters for all environmental datasets.

    All paths default to None (adapter disabled). Set a path to enable
    that data source. Paths can be local, Drive, or Colab paths.

    On Google Colab with Drive mounted::
        config = DataConfig(
            sic_path="/content/drive/MyDrive/data/sic_cmems.nc",
            current_path="/content/drive/MyDrive/data/cmems_current.nc",
        )
    """

    # --- Dataset paths (None = disabled) ---
    sic_path: Optional[str] = None
    current_path: Optional[str] = None
    iceberg_path: Optional[str] = None
    wind_path: Optional[str] = None
    bathy_path: Optional[str] = None

    # --- SIC adapter settings ---
    sic_variable: str = "siconc"       # CMEMS variable name for SIC
    sic_uncertainty_variable: Optional[str] = None  # e.g. cdr_seaice_conc_stdev
    sic_time_dim: str = "time"
    sic_lat_dim: str = "lat"
    sic_lon_dim: str = "lon"
    sic_x_dim: Optional[str] = None    # x coordinate (EPSG:3412 projected)
    sic_y_dim: Optional[str] = None    # y coordinate (EPSG:3412 projected)
    sic_crs: Optional[str] = None      # e.g. "EPSG:3412" for projected SIC

    # --- SIC forecast artifacts (teammate's committed inference output) ---
    # When set, build_env_fn uses SICForecastField (routing_sic_2026.npy +
    # uncertainty_2026.npy + routing_lat/lon.npy + routing_metadata.json)
    # instead of the netCDF SICAdapter.  None keeps the existing behaviour.
    sic_forecast_cache_dir: Optional[str] = None
    sic_forecast_horizon: int = 0      # 0 = D+1 (matches the day-1 SIC grid)

    # --- CMEMS current settings ---
    current_uo_var: str = "uo"         # zonal current
    current_vo_var: str = "vo"         # meridional current
    current_time_dim: str = "time"
    current_lat_dim: str = "lat"
    current_lon_dim: str = "lon"
    current_depth_var: Optional[str] = "depth"  # None = surface layer

    # --- Iceberg settings ---
    iceberg_variable: str = "risk"     # variable or field name
    iceberg_is_numpy: bool = False     # True = load as .npy, False = netCDF

    # --- Wind settings ---
    wind_u_var: str = "u10"            # zonal wind at 10m
    wind_v_var: str = "v10"            # meridional wind at 10m
    wind_time_dim: str = "time"

    # --- Grid parameters (optional, inferred from data if not set) ---
    grid_rows: Optional[int] = None
    grid_cols: Optional[int] = None
    lat_min: Optional[float] = None
    lat_max: Optional[float] = None
    lon_min: Optional[float] = None
    lon_max: Optional[float] = None

    # --- Date-aware CMEMS loading (M4.7) ---
    # When cmems_root + route_start_datetime are set, the builder uses
    # CMEMSDateAwareAdapter instead of the single-file CMEMSCurrentAdapter.
    cmems_root: Optional[str] = None
    route_start_datetime: Optional[datetime] = None

    @classmethod
    def from_env(cls) -> "DataConfig":
        """
        Create a DataConfig from environment variables.

        Returns a DataConfig with paths and parameters populated from
        environment variables, or defaults (None) if not set.
        """
        def _get(key: str, default=None):
            val = os.environ.get(key)
            if val is None:
                return default
            # Try to cast to common types
            try:
                return int(val)
            except ValueError:
                pass
            try:
                return float(val)
            except ValueError:
                pass
            return val

        # Parse route_start_datetime from ISO format string
        route_start = _get("ARctic_ROUTE_START")
        if route_start is not None and isinstance(route_start, str):
            route_start = datetime.fromisoformat(route_start)

        return cls(
            sic_path=_get("ARctic_SIC_PATH"),
            current_path=_get("ARctic_CURRENT_PATH"),
            iceberg_path=_get("ARctic_ICEBERG_PATH"),
            wind_path=_get("ARctic_WIND_PATH"),
            bathy_path=_get("ARctic_BATHY_PATH"),
            sic_variable=_get("ARctic_SIC_VAR", "siconc"),
            current_uo_var=_get("ARctic_CURRENT_UO", "uo"),
            current_vo_var=_get("ARctic_CURRENT_VO", "vo"),
            grid_rows=_get("ARctic_GRID_rows"),
            grid_cols=_get("ARctic_GRID_cols"),
            lat_min=_get("ARctic_LAT_MIN"),
            lat_max=_get("ARctic_LAT_MAX"),
            lon_min=_get("ARctic_LON_MIN"),
            lon_max=_get("ARctic_LON_MAX"),
            cmems_root=_get("ARctic_CMEMS_ROOT"),
            route_start_datetime=route_start,
            sic_forecast_cache_dir=_get("ARCTIC_SIC_FORECAST_CACHE"),
            sic_forecast_horizon=int(_get("ARCTIC_SIC_FORECAST_HORIZON", 0) or 0),
        )

    def active_adapters(self) -> list:
        """Return names of enabled adapters (those with paths set)."""
        adapters = []
        if self.sic_forecast_cache_dir:
            adapters.append("sic_forecast")
        elif self.sic_path:
            adapters.append("sic")
        if self.cmems_root and self.route_start_datetime:
            adapters.append("cmems_date_aware")
        elif self.current_path:
            adapters.append("current")
        if self.iceberg_path:
            adapters.append("iceberg")
        if self.wind_path:
            adapters.append("wind")
        if self.bathy_path:
            adapters.append("bathymetry")
        return adapters

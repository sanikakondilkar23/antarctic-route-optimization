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
from pathlib import Path
from typing import Optional, Tuple


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
    # Defaults describe the REAL NSIDC/Sea-Ice CDR product shipped in
    # DATA_ROOT/SIC/: variable ``cdr_seaice_conc`` on a polar-stereographic
    # (EPSG:3412) x/y grid.  This product has NO lat/lon coordinates, so the
    # x/y dims are populated by default and ``sic_crs`` must stay in sync with
    # them.  Clearing sic_x_dim/sic_y_dim switches to a geographic product.
    sic_variable: str = "cdr_seaice_conc"   # NSIDC CDR SIC variable
    sic_uncertainty_variable: Optional[str] = None  # e.g. cdr_seaice_conc_stdev
    sic_time_dim: str = "time"
    sic_lat_dim: str = "lat"
    sic_lon_dim: str = "lon"
    sic_x_dim: Optional[str] = "x"    # x coordinate (EPSG:3412 projected)
    sic_y_dim: Optional[str] = "y"    # y coordinate (EPSG:3412 projected)
    sic_crs: Optional[str] = "EPSG:3412"  # polar stereographic, real SIC grid

    #: ``"projected_x_y"``  -> x/y dims + sic_crs, transform to WGS84
    #: ``"geographic"``     -> sic_lat_dim/sic_lon_dim 1-D axes
    #: ``"auto"``           -> detect from the file's own dims
    sic_source_format: str = "projected_x_y"

    #: Absolute bounds of the native SIC source grid, in the target CRS
    #: (WGS84 lon/lat for a projected source).  ``None`` means "derive from the
    #: file's own coordinate axes at open time".  Set explicitly to make the
    #: coverage claim auditable without opening the (large) file.
    sic_source_lon_bounds: Optional[Tuple[float, float]] = None
    sic_source_lat_bounds: Optional[Tuple[float, float]] = None

    #: Fraction-of-half-cell tolerance used when deciding whether a target cell
    #: has a source cell.  A target cell with no source cell within this
    #: tolerance is NaN, never nearest-filled from further away.
    sic_max_nn_distance_deg: Optional[float] = None

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

    #: Real CMEMS GLORYS files name their coordinates "latitude"/"longitude".
    current_latitude_var: str = "latitude"
    current_longitude_var: str = "longitude"
    #: Native CMEMS latitude extent of the reanalysis product (-80..-50).
    #: The route grid reaches -32, so rows north of -50 are OUTSIDE the CMEMS
    #: domain and must stay NaN.  Recorded so the coverage gap is explicit.
    current_native_lat_bounds: Tuple[float, float] = (-80.0, -50.0)
    #: Do not read the whole 16.96 GB 2025 file: subset spatially and to a
    #: single 6-hour timestep before any array is materialised.
    current_allow_full_file_load: bool = False

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
    # ``cmems_root`` is DATA_ROOT/Copernicus_Ocean; resolve it with
    # :func:`src.data.paths.layer_path` rather than hardcoding a mount point.
    cmems_root: Optional[str] = None

    #: Time origin used to turn the optimizer's ``t_hours`` into an absolute
    #: datetime.  It is never inferred: without it a date-aware adapter cannot
    #: choose a file, and inventing an origin would fabricate timestamps.
    route_start_datetime: Optional[datetime] = None

    # --- Coverage policy -------------------------------------------------
    #: What to do with a target cell the source does not cover.  The only
    #: supported value is ``"nan"``:
    #:   outside native coverage          -> NaN
    #:   source NaN                       -> NaN
    #:   out-of-range / invalid value     -> NaN
    #: Zero-fill, mean-fill, shape-resize and extrapolation are all forbidden;
    #: see ``src/data/adapters.py``.  This field exists so the policy is stated
    #: in configuration and asserted at adapter construction, not implied.
    coverage_policy: str = "nan"

    #: Never substitute synthetic data for a missing real dataset.  Kept as a
    #: field so the builder can fail loudly if anything tries to.
    allow_synthetic_fallback: bool = False

    def validate(self) -> None:
        """
        Reject configurations that would violate the coverage policy.

        Raises ValueError rather than silently degrading, so a misconfigured
        run cannot quietly zero-fill or extrapolate.
        """
        if self.coverage_policy != "nan":
            raise ValueError(
                f"coverage_policy={self.coverage_policy!r} is not supported. "
                "The only safe policy is 'nan': cells outside the source's "
                "native coverage, and NaN cells inside it, must remain NaN. "
                "Zero-fill, mean-fill and extrapolation are forbidden."
            )
        if self.allow_synthetic_fallback:
            raise ValueError(
                "allow_synthetic_fallback=True is not permitted: a missing real "
                "dataset must be reported as unavailable, never replaced by "
                "synthetic data."
            )
        projected = bool(self.sic_x_dim) and bool(self.sic_y_dim)
        if projected and not self.sic_crs:
            raise ValueError(
                f"sic_x_dim={self.sic_x_dim!r}/sic_y_dim={self.sic_y_dim!r} "
                "require sic_crs (the real SIC product is EPSG:3412). The "
                "adapter will not guess a projection."
            )
        if self.sic_source_format not in ("projected_x_y", "geographic", "auto"):
            raise ValueError(
                f"sic_source_format={self.sic_source_format!r} is unknown; "
                "expected 'projected_x_y', 'geographic' or 'auto'"
            )
        if self.sic_source_format == "geographic" and projected:
            raise ValueError(
                "sic_source_format='geographic' conflicts with "
                f"sic_x_dim={self.sic_x_dim!r}/sic_y_dim={self.sic_y_dim!r}; "
                "clear the x/y dims to select a geographic product."
            )

    @classmethod
    def for_drive_datasets(
        cls,
        route_start_datetime: Optional[datetime] = None,
        *,
        sic_filename: Optional[str] = None,
        require_sic: bool = False,
        require_cmems: bool = False,
    ) -> "DataConfig":
        """
        Build a config wired to the real Drive datasets, via ``src.data.paths``.

        Resolves ``DATA_ROOT/SIC`` and ``DATA_ROOT/Copernicus_Ocean`` using the
        canonical resolver, so no mount point is hardcoded.  Returns a config
        whose adapters are enabled ONLY for roots that actually exist here;
        a missing root stays a disabled adapter, which the builder then reports
        as unavailable rather than replacing with synthetic data.

        Set ``require_sic``/``require_cmems`` to raise when the dataset is not
        present, instead of returning a partially-populated config.
        """
        from src.data import paths as _paths

        sic_dir = _paths.layer_path("sic")
        cmems_dir = _paths.layer_path("copernicus_ocean")

        sic_file = None
        if sic_dir is not None and sic_dir.is_dir():
            sic_file = str(Path(sic_dir) / sic_filename) if sic_filename else None
            if sic_file is None:
                found = sorted(Path(sic_dir).glob("*.nc"))
                sic_file = str(found[0]) if found else None

        if require_sic and sic_file is None:
            raise FileNotFoundError(
                "no SIC netCDF found; searched "
                f"{_paths.searched_paths('sic')}"
            )
        if require_cmems and not (cmems_dir is not None and cmems_dir.is_dir()):
            raise FileNotFoundError(
                "no Copernicus_Ocean root found; searched "
                f"{_paths.searched_paths('copernicus_ocean')}"
            )

        cfg = cls(
            sic_path=sic_file,
            cmems_root=(str(cmems_dir)
                        if cmems_dir is not None and cmems_dir.is_dir() else None),
            route_start_datetime=route_start_datetime,
        )
        cfg.validate()
        return cfg

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
            sic_variable=_get("ARctic_SIC_VAR", "cdr_seaice_conc"),
            sic_crs=_get("ARctic_SIC_CRS", "EPSG:3412"),
            sic_x_dim=_get("ARctic_SIC_XDIM", "x"),
            sic_y_dim=_get("ARctic_SIC_YDIM", "y"),
            sic_source_format=_get("ARctic_SIC_FORMAT", "projected_x_y"),
            current_uo_var=_get("ARctic_CURRENT_UO", "uo"),
            current_vo_var=_get("ARctic_CURRENT_VO", "vo"),
            current_latitude_var=_get("ARctic_CMEMS_LATVAR", "latitude"),
            current_longitude_var=_get("ARctic_CMEMS_LONVAR", "longitude"),
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

    def describe(self) -> dict:
        """
        Human-readable record of what this config asks for, for provenance.

        Reports the resolved dataset roots, the source formats/CRS, the time
        origin and the coverage policy, so a run's inputs can be stated without
        re-deriving them from the code.
        """
        return {
            "sic_path": self.sic_path,
            "sic_variable": self.sic_variable,
            "sic_source_format": self.sic_source_format,
            "sic_crs": self.sic_crs,
            "sic_dims": {"x": self.sic_x_dim, "y": self.sic_y_dim,
                         "lat": self.sic_lat_dim, "lon": self.sic_lon_dim},
            "sic_forecast_cache_dir": self.sic_forecast_cache_dir,
            "cmems_root": self.cmems_root,
            "current_vars": {"uo": self.current_uo_var, "vo": self.current_vo_var},
            "current_coords": {"lat": self.current_latitude_var,
                               "lon": self.current_longitude_var},
            "current_native_lat_bounds": tuple(self.current_native_lat_bounds),
            "route_start_datetime": (
                self.route_start_datetime.isoformat()
                if self.route_start_datetime is not None else None
            ),
            "coverage_policy": self.coverage_policy,
            "allow_synthetic_fallback": self.allow_synthetic_fallback,
            "active_adapters": self.active_adapters(),
        }


"""
Data Adapters
=============

Each adapter converts a real dataset into EnvironmentalGrid-compatible layers.

All adapters follow the same protocol:
    - __init__(path, **kwargs): configure with file path and parameters
    - load(t_hours, grid_template) -> EnvironmentalGrid: load data at time t
    - is_available() -> bool: check if the adapter has a valid data source

Data format expectations:
    SIC:          netCDF with [time, lat, lon] or [y, x] in range [0, 1]
                  Supports projected coordinates (EPSG:3412) with automatic
                  geographic transformation.
    CMEMS current: netCDF with [time, lat, lon] for uo and vo (m/s)
    Iceberg:      netCDF or numpy with risk field [lat, lon] or [time, lat, lon]
    Wind:         netCDF with [time, lat, lon] for u and v (m/s)
    Bathymetry:   netCDF or numpy with depth [lat, lon] (meters, negative = below sea level)

Compatible with Google Drive / Colab paths.
"""

from __future__ import annotations

import math
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional

import numpy as np

from src.environment.grid import EnvironmentalGrid

try:
    import xarray as xr
    HAS_XARRAY = True
except ImportError:
    HAS_XARRAY = False

try:
    from src.data.cmems_loader import CMEMSDateAwareLoader, current_speed_from_uv
    HAS_CMEMS_LOADER = True
except ImportError:
    HAS_CMEMS_LOADER = False

try:
    from pyproj import Transformer
    HAS_PYPROJ = True
except ImportError:
    HAS_PYPROJ = False


# ---------------------------------------------------------------------------
# Base adapter
# ---------------------------------------------------------------------------

class BaseAdapter(ABC):
    """Base class for all data adapters."""

    def __init__(self, path: Optional[str] = None):
        self._path = path

    @property
    def path(self) -> Optional[str]:
        return self._path

    def is_available(self) -> bool:
        """Check if this adapter has a valid data source."""
        if self._path is None:
            return False
        return Path(self._path).exists()

    @abstractmethod
    def load(self, t_hours: float, grid_template: EnvironmentalGrid) -> EnvironmentalGrid:
        """
        Load data at time t and return grid_template with new layer(s) set.

        Parameters
        ----------
        t_hours : float
            Time in hours since departure.
        grid_template : EnvironmentalGrid
            Template grid with correct shape, lat/lon, navigability.
            The adapter populates the relevant layer(s) on this grid.

        Returns
        -------
        EnvironmentalGrid
            Copy of grid_template with the adapter's layer(s) populated.
        """
        ...

    def _copy_grid(self, template: EnvironmentalGrid) -> EnvironmentalGrid:
        """Create a shallow copy of the template grid."""
        return EnvironmentalGrid(
            n_rows=template.n_rows,
            n_cols=template.n_cols,
            lat=template.lat.copy(),
            lon=template.lon.copy(),
            navigable=template.navigable.copy(),
            sic_mean=template.sic_mean.copy() if template.sic_mean is not None else None,
            sic_uncertainty=(template.sic_uncertainty.copy()
                             if template.sic_uncertainty is not None else None),
            iceberg_risk=(template.iceberg_risk.copy()
                          if template.iceberg_risk is not None else None),
            iceberg_risk_uncertainty=(template.iceberg_risk_uncertainty.copy()
                                      if template.iceberg_risk_uncertainty is not None else None),
            iceberg_uncertainty=(template.iceberg_uncertainty.copy()
                                 if template.iceberg_uncertainty is not None else None),
            wind_cost=template.wind_cost.copy() if template.wind_cost is not None else None,
            current_cost=(template.current_cost.copy()
                          if template.current_cost is not None else None),
            current_uo=(template.current_uo.copy()
                        if template.current_uo is not None else None),
            current_vo=(template.current_vo.copy()
                        if template.current_vo is not None else None),
            depth=template.depth.copy() if template.depth is not None else None,
            ice_multiplier=(template.ice_multiplier.copy()
                            if template.ice_multiplier is not None else None),
            layer_status=(dict(template.layer_status)
                          if template.layer_status is not None else None),
            layer_provenance=(dict(template.layer_provenance)
                              if template.layer_provenance is not None else None),
            resolution_deg=template.resolution_deg,
        )


# ---------------------------------------------------------------------------
# SIC Adapter
# ---------------------------------------------------------------------------

class SICAdapter(BaseAdapter):
    """
    Load sea-ice concentration from CMEMS, NSIDC, or similar netCDF.

    Supports two coordinate conventions:

    1. Geographic: file has 1D ``lat_dim`` / ``lon_dim`` coordinates.
       The adapter reads them directly.

    2. Projected (e.g. EPSG:3412): file has 1D ``x_dim`` / ``y_dim``
       coordinates in metres.  The adapter transforms them to WGS84
       geographic lon/lat using ``pyproj.Transformer`` before interpolation.

    Fill-value handling:
        NaN and values outside [0, 1] are treated as missing.
        Missing SIC is NOT silently set to zero; it is set to NaN
        so that downstream code (scenario generation, cost evaluation)
        can distinguish "unknown ice" from "known open water".

    On Google Colab::
        adapter = SICAdapter(
            path="/content/drive/MyDrive/data/sic_pss25_20211231_F17_v06r00.nc",
            variable="cdr_seaice_conc",
            x_dim="x", y_dim="y", crs="EPSG:3412",
        )
        grid = adapter.load(t_hours=0.0, grid_template=grid)
    """

    def __init__(
        self,
        path: Optional[str] = None,
        variable: str = "siconc",
        uncertainty_variable: Optional[str] = None,
        time_dim: str = "time",
        lat_dim: str = "lat",
        lon_dim: str = "lon",
        x_dim: Optional[str] = None,
        y_dim: Optional[str] = None,
        crs: Optional[str] = None,
    ):
        super().__init__(path)
        self.variable = variable
        self.uncertainty_variable = uncertainty_variable
        self.time_dim = time_dim
        self.lat_dim = lat_dim
        self.lon_dim = lon_dim
        self.x_dim = x_dim
        self.y_dim = y_dim
        self.crs = crs
        self._ds = None  # lazy-loaded dataset
        self._src_lats = None  # cached geographic source latitudes
        self._src_lons = None  # cached geographic source longitudes

    def _open_dataset(self):
        """Lazy-load the netCDF file."""
        if self._ds is None and self.is_available():
            if not HAS_XARRAY:
                raise ImportError("xarray is required for SIC adapter")
            self._ds = xr.open_dataset(self._path)
            self._prepare_source_coords()

    def _prepare_source_coords(self):
        """
        Prepare geographic source coordinate arrays.

        If the dataset uses projected x/y coordinates (e.g. EPSG:3412),
        transform them to WGS84 lon/lat.  Otherwise read lat/lon directly.
        """
        ds = self._ds

        # Check whether projected x/y coordinates are present
        if (self.x_dim and self.y_dim
                and self.x_dim in ds.dims and self.y_dim in ds.dims):
            if not HAS_PYPROJ:
                raise ImportError(
                    "pyproj is required for projected SIC coordinates "
                    f"(detected {self.crs}).  Install with: pip install pyproj"
                )
            if self.crs is None:
                raise ValueError(
                    "crs must be specified when x_dim/y_dim are set "
                    "(e.g. 'EPSG:3412')"
                )

            x_vals = ds[self.x_dim].values  # metres
            y_vals = ds[self.y_dim].values  # metres

            # Build 2D meshgrid of source coordinates
            x_mesh, y_mesh = np.meshgrid(x_vals, y_vals)

            # Transform to WGS84 (lon, lat)
            transformer = Transformer.from_crs(
                self.crs, "EPSG:4326", always_xy=True,
            )
            lons_2d, lats_2d = transformer.transform(x_mesh, y_mesh)

            # Store as 1D arrays (ascending) for RegularGridInterpolator
            self._src_lats = np.unique(lats_2d)
            self._src_lons = np.unique(lons_2d)
            self._src_lats.sort()
            self._src_lons.sort()
            self._is_projected = True

            # Also build 2D index maps for regridding the data array
            self._lat_idx_map = np.searchsorted(self._src_lats, lats_2d.ravel())
            self._lon_idx_map = np.searchsorted(self._src_lons, lons_2d.ravel())
        else:
            # Geographic coordinates — read directly
            self._src_lats = ds[self.lat_dim].values
            self._src_lons = ds[self.lon_dim].values
            self._is_projected = False

    def load(self, t_hours: float, grid_template: EnvironmentalGrid) -> EnvironmentalGrid:
        """
        Load SIC at time t and populate sic_mean on the grid.

        Missing/invalid SIC values are stored as NaN, not zero.
        """
        grid = self._copy_grid(grid_template)

        if not self.is_available():
            grid.sic_mean = np.full((grid.n_rows, grid.n_cols), np.nan)
            grid.sic_uncertainty = np.full((grid.n_rows, grid.n_cols), np.nan)
            return grid

        self._open_dataset()
        ds = self._ds

        # --- Select variable and nearest time ---
        da = ds[self.variable]
        if self.time_dim in da.dims:
            da_t = da.sel({self.time_dim: t_hours}, method="nearest")
        else:
            da_t = da

        sic_2d = da_t.values.astype(np.float64)

        # --- Handle projected data: remap from (y, x) to geographic grid ---
        if self._is_projected:
            sic_2d = self._reproject_to_geo(sic_2d)

        # --- Handle fill values: NaN stays NaN, values outside [0,1] → NaN ---
        valid = (sic_2d >= 0.0) & (sic_2d <= 1.0)
        sic_2d = np.where(valid, sic_2d, np.nan)

        # --- Interpolate to grid if shapes differ ---
        if sic_2d.shape != (grid.n_rows, grid.n_cols):
            sic_2d = self._interpolate_to_grid(sic_2d, grid)

        grid.sic_mean = sic_2d

        # --- Load uncertainty if available ---
        if (self.uncertainty_variable
                and self.uncertainty_variable in ds.data_vars):
            da_std = ds[self.uncertainty_variable]
            if self.time_dim in da_std.dims:
                da_std_t = da_std.sel({self.time_dim: t_hours}, method="nearest")
            else:
                da_std_t = da_std
            std_2d = da_std_t.values.astype(np.float64)
            if self._is_projected:
                std_2d = self._reproject_to_geo(std_2d)
            # NaN where SIC is NaN
            std_2d = np.where(valid, std_2d, np.nan)
            if std_2d.shape != (grid.n_rows, grid.n_cols):
                std_2d = self._interpolate_to_grid(std_2d, grid)
            grid.sic_uncertainty = std_2d

        return grid

    def _reproject_to_geo(self, data_2d: np.ndarray) -> np.ndarray:
        """
        Remap a (y, x) projected array onto geographic lat/lon grids.

        The source data has shape (n_y, n_x) with EPSG:3412 coordinates.
        This method scatters values onto a geographic grid indexed by
        the unique sorted lat/lon arrays from _prepare_source_coords.
        """
        n_geo_lat = len(self._src_lats)
        n_geo_lon = len(self._src_lons)
        result = np.full((n_geo_lat, n_geo_lon), np.nan)

        # data_2d is (n_y, n_x); flatten in row-major order
        flat_data = data_2d.ravel()

        # Clip indices to valid range
        lat_idx = np.clip(self._lat_idx_map, 0, n_geo_lat - 1)
        lon_idx = np.clip(self._lon_idx_map, 0, n_geo_lon - 1)

        # Scatter values (last-write wins for duplicate cells)
        for i in range(len(flat_data)):
            result[lat_idx[i], lon_idx[i]] = flat_data[i]

        return result

    def _interpolate_to_grid(
        self, data: np.ndarray, grid: EnvironmentalGrid,
    ) -> np.ndarray:
        """Nearest-neighbour interpolation from source to target grid."""
        from scipy.interpolate import RegularGridInterpolator

        lats_src = self._src_lats
        lons_src = self._src_lons

        # Out-of-extent target cells are filled with NaN, never with the mean
        # of the source field: a target cell the source does not cover has no
        # measurement, and substituting a domain average would silently invent
        # one.  Interior NaN is carried through by ``method="nearest"``.
        fill_val = np.nan

        interp = RegularGridInterpolator(
            (lats_src, lons_src), data,
            method="nearest", bounds_error=False, fill_value=np.nan,
        )


        lon_mesh, lat_mesh = np.meshgrid(grid.lon, grid.lat)
        target_points = np.stack([lat_mesh.ravel(), lon_mesh.ravel()], axis=-1)

        result = interp(target_points).reshape(grid.n_rows, grid.n_cols)
        return result


# ---------------------------------------------------------------------------
# CMEMS Current Adapter
# ---------------------------------------------------------------------------

class CMEMSCurrentAdapter(BaseAdapter):
    """
    Load ocean current from CMEMS GLORYS or similar product.

    Expected file format:
        - netCDF with uo [time, depth, lat/latitude, lon/longitude]
          and vo [time, depth, lat/latitude, lon/longitude]
        - uo: zonal current velocity (m/s), positive = eastward
        - vo: meridional current velocity (m/s), positive = northward

    Real CMEMS naming: dimensions use "latitude"/"longitude" (not "lat"/"lon").
    The adapter auto-detects both naming conventions.

    Conversion to current_cost:
        speed = sqrt(uo^2 + vo^2)  (always >= 0)
        current_cost = speed  (positive = adverse, consistent with cost.py)

    NaN handling:
        Missing/NaN values in uo/vo are treated as zero current.

    On Google Colab::
        adapter = CMEMSCurrentAdapter("/content/drive/MyDrive/data/cmems_current.nc")
        grid = adapter.load(t_hours=24.0, grid_template=grid)
    """

    def __init__(
        self,
        path: Optional[str] = None,
        uo_var: str = "uo",
        vo_var: str = "vo",
        time_dim: str = "time",
        lat_dim: str = "lat",
        lon_dim: str = "lon",
        depth_var: Optional[str] = "depth",
    ):
        super().__init__(path)
        self.uo_var = uo_var
        self.vo_var = vo_var
        self.time_dim = time_dim
        self.lat_dim = lat_dim
        self.lon_dim = lon_dim
        self.depth_var = depth_var
        self._ds = None

    def _open_dataset(self):
        if self._ds is None and self.is_available():
            if not HAS_XARRAY:
                raise ImportError("xarray is required for CMEMS current adapter")
            try:
                import dask  # noqa: F401
                self._ds = xr.open_dataset(self._path, chunks={"time": 1})
            except ImportError:
                self._ds = xr.open_dataset(self._path)

    def _detect_coords(self, ds):
        """Auto-detect latitude/longitude coordinate names."""
        lat_var = None
        lon_var = None
        for name in ("latitude", "lat"):
            if name in ds.dims or name in ds.coords:
                lat_var = name
                break
        for name in ("longitude", "lon"):
            if name in ds.dims or name in ds.coords:
                lon_var = name
                break
        return lat_var, lon_var

    def load(self, t_hours: float, grid_template: EnvironmentalGrid) -> EnvironmentalGrid:
        """
        Load ocean current at time t and populate current_cost on the grid.

        current_cost = sqrt(uo^2 + vo^2)  (current speed in m/s)
        This is always >= 0, so max(current_cost, 0) = current_cost.
        Adverse current adds positive cost; the optimizer avoids it.

        NaN values in uo/vo are filled with 0 before computing speed.
        """
        grid = self._copy_grid(grid_template)

        if not self.is_available():
            grid.current_cost = np.full((grid.n_rows, grid.n_cols), np.nan)
            grid.current_uo = np.full((grid.n_rows, grid.n_cols), np.nan)
            grid.current_vo = np.full((grid.n_rows, grid.n_cols), np.nan)
            return grid

        self._open_dataset()
        ds = self._ds

        # Auto-detect coordinate names
        lat_var, lon_var = self._detect_coords(ds)
        if lat_var is None:
            lat_var = self.lat_dim
        if lon_var is None:
            lon_var = self.lon_dim

        # Select uo and vo
        da_uo = ds[self.uo_var]
        da_vo = ds[self.vo_var]

        # Select nearest time step
        if self.time_dim in da_uo.dims:
            # CMEMS time is typically datetime64; convert t_hours to datetime
            time_coord = ds[self.time_dim].values
            if hasattr(time_coord[0], 'astype') and np.issubdtype(time_coord.dtype, np.datetime64):
                # Convert hours since first timestep to datetime64
                import pandas as pd
                t_target = time_coord[0] + pd.Timedelta(hours=t_hours)
                da_uo_t = da_uo.sel({self.time_dim: t_target}, method="nearest")
                da_vo_t = da_vo.sel({self.time_dim: t_target}, method="nearest")
            else:
                da_uo_t = da_uo.sel({self.time_dim: t_hours}, method="nearest")
                da_vo_t = da_vo.sel({self.time_dim: t_hours}, method="nearest")
        else:
            da_uo_t = da_uo
            da_vo_t = da_vo

        # Select surface layer if depth dimension exists
        depth_var = self.depth_var
        if depth_var and depth_var in da_uo_t.dims:
            da_uo_t = da_uo_t.isel({depth_var: 0})
            da_vo_t = da_vo_t.isel({depth_var: 0})

        # Read values and fill NaN with 0
        uo = da_uo_t.values.astype(np.float64)
        vo = da_vo_t.values.astype(np.float64)
        # NaN preserved: a cell without a current measurement is not a cell
        # with zero current.  The cost map omits the term there and counts it.

        # Compute current speed (always >= 0)
        speed = np.sqrt(uo ** 2 + vo ** 2)

        # Interpolate to grid if shapes differ
        if speed.shape != (grid.n_rows, grid.n_cols):
            # Get source coordinates for interpolation
            lats_src = ds[lat_var].values
            lons_src = ds[lon_var].values
            # If 3D (depth was not a dim), try to get lat/lon from the 2D result
            if speed.ndim == 2 and lats_src.ndim == 1 and lons_src.ndim == 1:
                speed = self._interpolate_to_grid(speed, grid, lats_src, lons_src)
                uo = self._interpolate_to_grid(uo, grid, lats_src, lons_src)
                vo = self._interpolate_to_grid(vo, grid, lats_src, lons_src)
            else:
                raise ValueError(
                    f"current field shape {speed.shape} is not a 2-D "
                    "lat/lon field with 1-D coordinate axes, so it cannot be "
                    "aligned to the route grid. The adapter will not crop by "
                    "array index, because that assumes a spatial alignment "
                    "that has not been verified.")

        grid.current_cost = speed
        grid.current_uo = uo
        grid.current_vo = vo
        return grid

    def _interpolate_to_grid(
        self, data: np.ndarray, grid: EnvironmentalGrid,
        lats_src: np.ndarray = None, lons_src: np.ndarray = None,
    ) -> np.ndarray:
        """Nearest-neighbour resampling onto the route grid by coordinate."""
        from scipy.interpolate import RegularGridInterpolator

        if lats_src is None or lons_src is None:
            raise ValueError(
                "cannot align the current field to the route grid: the source "
                "latitude/longitude axes are unknown. The adapter will not "
                "crop by array index, because that assumes a spatial "
                "alignment that has not been verified.")

        lats_src = np.asarray(lats_src, dtype=np.float64)
        lons_src = np.asarray(lons_src, dtype=np.float64)
        data = np.asarray(data, dtype=np.float64)
        if lats_src.size != data.shape[0] or lons_src.size != data.shape[1]:
            raise ValueError(
                f"current field {data.shape} does not match its coordinate "
                f"axes ({lats_src.size}, {lons_src.size})")

        order = np.argsort(lats_src)
        interp = RegularGridInterpolator(
            (lats_src[order], lons_src), data[order],
            method="nearest", bounds_error=False, fill_value=np.nan,
        )

        lon_mesh, lat_mesh = np.meshgrid(grid.lon, grid.lat)
        target_points = np.stack([lat_mesh.ravel(), lon_mesh.ravel()], axis=-1)
        return interp(target_points).reshape(grid.n_rows, grid.n_cols)


# ---------------------------------------------------------------------------
# Iceberg Adapter
# ---------------------------------------------------------------------------

class IcebergAdapter(BaseAdapter):
    """
    Load iceberg risk from teammate's prediction output.

    Expected formats:
        - netCDF with risk variable [lat, lon] or [time, lat, lon]
        - numpy .npy file with [lat, lon] or [time, lat, lon]

    The teammate's iceberg trajectory predictor should populate this
    adapter with predicted iceberg positions/uncertainty converted to
    a risk field in [0, 1].

    On Google Colab::
        adapter = IcebergAdapter("/content/drive/MyDrive/data/iceberg_risk.nc")
        grid = adapter.load(t_hours=24.0, grid_template=grid)
    """

    def __init__(
        self,
        path: Optional[str] = None,
        variable: str = "risk",
        is_numpy: bool = False,
        time_dim: str = "time",
        lat_dim: str = "lat",
        lon_dim: str = "lon",
        dates_path: Optional[str] = None,
        route_start_datetime=None,
        src_lat: Optional[np.ndarray] = None,
        src_lon: Optional[np.ndarray] = None,
    ):
        super().__init__(path)
        self.variable = variable
        self.is_numpy = is_numpy
        self.time_dim = time_dim
        self.lat_dim = lat_dim
        self.lon_dim = lon_dim
        self.dates_path = dates_path
        self.route_start_datetime = route_start_datetime
        self.src_lat = src_lat
        self.src_lon = src_lon
        self._data = None
        self._dates = None

    def load(self, t_hours: float, grid_template: EnvironmentalGrid) -> EnvironmentalGrid:
        """Load iceberg risk at time t and populate iceberg_risk on the grid."""
        grid = self._copy_grid(grid_template)

        if not self.is_available():
            grid.iceberg_risk = np.full((grid.n_rows, grid.n_cols), np.nan)
            return grid

        risk = self._load_data(t_hours)

        if risk.shape != (grid.n_rows, grid.n_cols):
            risk = self._interpolate_to_grid(risk, grid)

        grid.iceberg_risk = np.clip(risk, 0.0, 1.0)
        return grid

    def _load_data(self, t_hours: float) -> np.ndarray:
        """Load risk data from file."""
        path = Path(self._path)

        if self.is_numpy:
            data = np.load(str(path))
        else:
            if not HAS_XARRAY:
                raise ImportError("xarray is required for netCDF iceberg adapter")
            ds = xr.open_dataset(str(path))
            da = ds[self.variable]
            if self.time_dim in da.dims:
                da = da.sel({self.time_dim: t_hours}, method="nearest")
            data = da.values.astype(np.float64)

        # If 3D [time, lat, lon], the requested time slice must be selected.
        # A companion dates array is required: silently returning frame 0 for
        # every requested time would report one forecast step as if it were
        # all of them.
        if data.ndim == 3:
            data = data[self._time_index(data.shape[0], t_hours)]

        return data

    def _time_index(self, n_time: int, t_hours: float) -> int:
        """Index of the frame closest to ``t_hours``; raises if unknowable."""
        if self._dates is None:
            if self.dates_path and Path(self.dates_path).is_file():
                self._dates = np.load(str(self.dates_path),
                                      allow_pickle=True).astype("datetime64[ns]")
            elif self.route_start_datetime is not None:
                base = np.datetime64(self.route_start_datetime, "ns")
                self._dates = base + np.arange(n_time) * np.timedelta64(1, "D")

        if self._dates is None or len(self._dates) != n_time:
            raise ValueError(
                "iceberg risk array has a time axis of length "
                f"{n_time} but no matching dates are available, so the frame "
                f"for t_hours={t_hours} cannot be identified. Pass "
                "dates_path= or route_start_datetime= to IcebergAdapter; the "
                "adapter will not default to the first timestep.")

        if self.route_start_datetime is not None:
            target = np.datetime64(
                self.route_start_datetime, "ns") + np.timedelta64(
                    int(round(t_hours * 3600 * 1e6)), "us")
        else:
            target = self._dates[0] + np.timedelta64(
                int(round(t_hours * 3600 * 1e6)), "us")

        return int(np.argmin(np.abs(self._dates - target)))

    def _interpolate_to_grid(
        self, data: np.ndarray, grid: EnvironmentalGrid,
    ) -> np.ndarray:
        """Nearest-neighbour resampling onto the route grid."""
        from scipy.interpolate import RegularGridInterpolator

        if self.is_numpy or not HAS_XARRAY:
            lats_src = self.src_lat
            lons_src = self.src_lon
            if lats_src is None or lons_src is None:
                raise ValueError(
                    "iceberg risk was supplied as a bare array with no "
                    "coordinates, so it cannot be aligned to the route grid. "
                    "Pass src_lat=/src_lon= (the 1-D axes of the array) or "
                    "supply a netCDF file. The adapter will not resample by "
                    "array index, because that assumes a spatial alignment "
                    "that has not been verified.")
        else:
            ds = xr.open_dataset(self._path)
            lats_src = ds[self.lat_dim].values
            lons_src = ds[self.lon_dim].values
            ds.close()

        lats_src = np.asarray(lats_src, dtype=np.float64)
        lons_src = np.asarray(lons_src, dtype=np.float64)
        if lats_src.size != data.shape[0] or lons_src.size != data.shape[1]:
            raise ValueError(
                f"iceberg risk array {data.shape} does not match its "
                f"coordinate axes ({lats_src.size}, {lons_src.size})")

        order = np.argsort(lats_src)
        interp = RegularGridInterpolator(
            (lats_src[order], lons_src), np.asarray(data)[order],
            method="nearest", bounds_error=False, fill_value=np.nan,
        )
        lon_mesh, lat_mesh = np.meshgrid(grid.lon, grid.lat)
        target = np.stack([lat_mesh.ravel(), lon_mesh.ravel()], axis=-1)
        return interp(target).reshape(grid.n_rows, grid.n_cols)


# ---------------------------------------------------------------------------
# Wind Adapter
# ---------------------------------------------------------------------------

class WindAdapter(BaseAdapter):
    """
    Load wind field from ERA5 or forecast data.

    Expected file format:
        - netCDF with u10 [time, lat, lon] and v10 [time, lat, lon]
        - Wind speed in m/s

    Conversion to wind_cost:
        wind_cost = sqrt(u10^2 + v10^2)  (wind speed magnitude)

    On Google Colab::
        adapter = WindAdapter("/content/drive/MyDrive/data/era5_wind.nc")
        grid = adapter.load(t_hours=24.0, grid_template=grid)
    """

    def __init__(
        self,
        path: Optional[str] = None,
        u_var: str = "u10",
        v_var: str = "v10",
        time_dim: str = "time",
        lat_dim: str = "lat",
        lon_dim: str = "lon",
    ):
        super().__init__(path)
        self.u_var = u_var
        self.v_var = v_var
        self.time_dim = time_dim
        self.lat_dim = lat_dim
        self.lon_dim = lon_dim
        self._ds = None

    def _open_dataset(self):
        if self._ds is None and self.is_available():
            if not HAS_XARRAY:
                raise ImportError("xarray is required for wind adapter")
            self._ds = xr.open_dataset(self._path)

    def load(self, t_hours: float, grid_template: EnvironmentalGrid) -> EnvironmentalGrid:
        """Load wind at time t and populate wind_cost on the grid."""
        grid = self._copy_grid(grid_template)

        if not self.is_available():
            grid.wind_cost = np.full((grid.n_rows, grid.n_cols), np.nan)
            return grid

        self._open_dataset()
        ds = self._ds

        da_u = ds[self.u_var]
        da_v = ds[self.v_var]

        if self.time_dim in da_u.dims:
            da_u_t = da_u.sel({self.time_dim: t_hours}, method="nearest")
            da_v_t = da_v.sel({self.time_dim: t_hours}, method="nearest")
        else:
            da_u_t = da_u
            da_v_t = da_v

        u = da_u_t.values.astype(np.float64)
        v = da_v_t.values.astype(np.float64)
        speed = np.sqrt(u ** 2 + v ** 2)

        if speed.shape != (grid.n_rows, grid.n_cols):
            speed = self._interpolate_to_grid(speed, grid)

        grid.wind_cost = speed
        return grid

    def _interpolate_to_grid(
        self, data: np.ndarray, grid: EnvironmentalGrid,
    ) -> np.ndarray:
        from scipy.interpolate import RegularGridInterpolator

        lats_src = self._ds[self.lat_dim].values
        lons_src = self._ds[self.lon_dim].values

        interp = RegularGridInterpolator(
            (lats_src, lons_src), data,
            method="nearest", bounds_error=False, fill_value=np.nan,
        )
        lon_mesh, lat_mesh = np.meshgrid(grid.lon, grid.lat)
        target = np.stack([lat_mesh.ravel(), lon_mesh.ravel()], axis=-1)
        return interp(target).reshape(grid.n_rows, grid.n_cols)


# ---------------------------------------------------------------------------
# Bathymetry Adapter
# ---------------------------------------------------------------------------

class BathymetryAdapter(BaseAdapter):
    """
    Load bathymetry/depth from GEBCO or similar.

    Expected file format:
        - netCDF with elevation/depth [lat, lon] in meters
        - Negative values = below sea level

    Conversion to navigability:
        Cells with depth > vessel_draft are navigable.
        Cells with depth <= vessel_draft (too shallow) are blocked.

    On Google Colab::
        adapter = BathymetryAdapter("/content/drive/MyDrive/data/gebco.nc")
        grid = adapter.load(t_hours=0.0, grid_template=grid)
    """

    def __init__(
        self,
        path: Optional[str] = None,
        depth_var: str = "elevation",
        lat_dim: str = "lat",
        lon_dim: str = "lon",
        vessel_draft_m: float = 6.5,
    ):
        super().__init__(path)
        self.depth_var = depth_var
        self.lat_dim = lat_dim
        self.lon_dim = lon_dim
        self.vessel_draft_m = vessel_draft_m
        self._ds = None

    def _open_dataset(self):
        if self._ds is None and self.is_available():
            if not HAS_XARRAY:
                raise ImportError("xarray is required for bathymetry adapter")
            self._ds = xr.open_dataset(self._path)

    def load(self, t_hours: float, grid_template: EnvironmentalGrid) -> EnvironmentalGrid:
        """Load bathymetry and update navigability based on vessel draft."""
        grid = self._copy_grid(grid_template)

        if not self.is_available():
            grid.depth = np.full((grid.n_rows, grid.n_cols), np.nan)
            return grid

        self._open_dataset()
        ds = self._ds

        da = ds[self.depth_var]
        elevation = da.values.astype(np.float64)

        if elevation.shape != (grid.n_rows, grid.n_cols):
            elevation = self._interpolate_to_grid(elevation, grid)

        # GEBCO elevation is negative below sea level; depth is positive down.
        depth = -np.asarray(elevation, dtype=np.float64)
        depth[~np.isfinite(depth)] = np.nan
        grid.depth = depth

        # Update navigability: cells deeper than vessel draft are navigable.
        # Unknown depth fails closed -- NaN < -draft is False -- so a cell with
        # no bathymetry is never assumed navigable.
        navigable = depth > self.vessel_draft_m
        grid.navigable = grid.navigable & navigable

        return grid

    def _interpolate_to_grid(
        self, data: np.ndarray, grid: EnvironmentalGrid,
    ) -> np.ndarray:
        from scipy.interpolate import RegularGridInterpolator

        lats_src = np.asarray(self._ds[self.lat_dim].values, dtype=np.float64)
        lons_src = np.asarray(self._ds[self.lon_dim].values, dtype=np.float64)
        data = np.asarray(data, dtype=np.float64)
        if lats_src.size != data.shape[0] or lons_src.size != data.shape[1]:
            raise ValueError(
                f"bathymetry {data.shape} does not match its coordinate axes "
                f"({lats_src.size}, {lons_src.size})")
        order = np.argsort(lats_src)

        interp = RegularGridInterpolator(
            (lats_src[order], lons_src), data[order],
            method="nearest", bounds_error=False, fill_value=np.nan,
        )
        lon_mesh, lat_mesh = np.meshgrid(grid.lon, grid.lat)
        target = np.stack([lat_mesh.ravel(), lon_mesh.ravel()], axis=-1)
        return interp(target).reshape(grid.n_rows, grid.n_cols)


# ---------------------------------------------------------------------------
# Date-Aware CMEMS Current Adapter (M4.7)
# ---------------------------------------------------------------------------

class CMEMSDateAwareAdapter(BaseAdapter):
    """
    Date-aware CMEMS current adapter with automatic file selection.

    Wraps CMEMSDateAwareLoader to conform to the BaseAdapter protocol.
    Automatically selects the correct CMEMS file based on the query datetime
    derived from route_start_datetime + t_hours.

    File selection:
        2021-2024:  {cmems_root}/{year}/Ocean_{year}_{month:02d}.nc
        2025:       {cmems_root}/2025/CMEMS_Current_2025_6hourly.nc

    The route_start_datetime is explicit and NEVER hidden inside the adapter.
    t_hours from the route optimizer is converted to an absolute datetime
    using: query_datetime = route_start_datetime + timedelta(hours=t_hours)

    Handles different longitude grid sizes (4320 vs 4319) automatically via
    xarray's coordinate-based selection.

    Current cost conversion:
        uo, vo -> current_speed_from_uv(uo, vo) = sqrt(uo^2 + vo^2)
        This is a PLACEHOLDER. See cmems_loader.current_speed_from_uv.

    On Google Colab::
        from datetime import datetime
        adapter = CMEMSDateAwareAdapter(
            cmems_root="/content/drive/MyDrive/SIH_26_Sanika/dataset/Copernicus_Ocean",
            route_start_datetime=datetime(2025, 1, 1, 0, 0),
        )
        grid = adapter.load(t_hours=24.0, grid_template=grid)
    """

    def __init__(
        self,
        cmems_root: str,
        route_start_datetime,
        lat_var: str = "latitude",
        lon_var: str = "longitude",
        uo_var: str = "uo",
        vo_var: str = "vo",
        lat_bounds=None,
        lon_bounds=None,
    ):
        super().__init__(path=cmems_root)
        self._cmems_root = cmems_root
        self._route_start_datetime = route_start_datetime
        self._lat_var = lat_var
        self._lon_var = lon_var
        self._uo_var = uo_var
        self._vo_var = vo_var
        self._lat_bounds = lat_bounds
        self._lon_bounds = lon_bounds
        self._loader = None
        self._cache = {}  # {t_hours_rounded: (current_cost, uo, vo)}

    def is_available(self) -> bool:
        from pathlib import Path
        if self._cmems_root is None:
            return False
        return Path(self._cmems_root).exists()

    def _get_loader(self):
        if self._loader is None:
            if not HAS_CMEMS_LOADER:
                raise ImportError(
                    "CMEMSDateAwareLoader requires xarray. "
                    "Install with: pip install xarray"
                )
            self._loader = CMEMSDateAwareLoader(
                cmems_root=self._cmems_root,
                route_start_datetime=self._route_start_datetime,
                lat_var=self._lat_var,
                lon_var=self._lon_var,
                uo_var=self._uo_var,
                vo_var=self._vo_var,
            )
        return self._loader

    def load(self, t_hours: float, grid_template: EnvironmentalGrid) -> EnvironmentalGrid:
        grid = self._copy_grid(grid_template)

        if not self.is_available():
            grid.current_cost = np.full((grid.n_rows, grid.n_cols), np.nan)
            grid.current_uo = np.full((grid.n_rows, grid.n_cols), np.nan)
            grid.current_vo = np.full((grid.n_rows, grid.n_cols), np.nan)
            return grid

        # Round t_hours to avoid floating-point key issues; CMEMS has
        # discrete timesteps so nearby t_hours map to the same data.
        cache_key = round(t_hours, 2)

        if cache_key in self._cache:
            cached = self._cache[cache_key]
            grid.current_cost = cached[0].copy()
            grid.current_uo = cached[1].copy()
            grid.current_vo = cached[2].copy()
            return grid

        loader = self._get_loader()

        lat_min = float(grid.lat.min())
        lat_max = float(grid.lat.max())
        lon_min = float(grid.lon.min())
        lon_max = float(grid.lon.max())

        lat_bounds = self._lat_bounds if self._lat_bounds else (lat_min, lat_max)
        lon_bounds = self._lon_bounds if self._lon_bounds else (lon_min, lon_max)

        uo, vo, cmems_lat, cmems_lon = loader.load_uo_vo(
            t_hours=t_hours,
            lat_bounds=lat_bounds,
            lon_bounds=lon_bounds,
        )

        # Compute speed magnitude
        current_cost = np.sqrt(uo ** 2 + vo ** 2)

        if current_cost.shape != (grid.n_rows, grid.n_cols):
            current_cost = self._interpolate_to_grid(
                current_cost, grid, cmems_lat, cmems_lon
            )
            uo = self._interpolate_to_grid(uo, grid, cmems_lat, cmems_lon)
            vo = self._interpolate_to_grid(vo, grid, cmems_lat, cmems_lon)

        self._cache[cache_key] = (current_cost.copy(), uo.copy(), vo.copy())
        grid.current_cost = current_cost
        grid.current_uo = uo
        grid.current_vo = vo
        return grid

    def _interpolate_to_grid(
        self, data: np.ndarray, grid: EnvironmentalGrid,
        lats_src: np.ndarray = None, lons_src: np.ndarray = None,
    ) -> np.ndarray:
        from scipy.interpolate import RegularGridInterpolator

        if lats_src is None or lons_src is None:
            raise ValueError(
                "cannot align this layer to the route grid: the source "
                "latitude/longitude axes are unknown. The adapter will not "
                "crop by array index, because that assumes a spatial "
                "alignment that has not been verified.")

        interp = RegularGridInterpolator(
            (lats_src, lons_src), data,
            method="nearest", bounds_error=False, fill_value=np.nan,
        )

        lon_mesh, lat_mesh = np.meshgrid(grid.lon, grid.lat)
        target_points = np.stack([lat_mesh.ravel(), lon_mesh.ravel()], axis=-1)
        return interp(target_points).reshape(grid.n_rows, grid.n_cols)

    # -----------------------------------------------------------------
    # SIC Forecaster Adapter (.npy files from teammate's model)
    # -----------------------------------------------------------------

class SICForecasterAdapter(BaseAdapter):
    """
    Load sea-ice concentration forecasts from teammate's .npy cache files.

    Expected files in ``cache_dir``:
        routing_sic_2026.npy  : (n_time, n_lat, n_lon) float32 SIC in [0,1]
        routing_lat.npy      : (n_lat,) latitudes (degrees, ascending)
        routing_lon.npy      : (n_lon,) longitudes (degrees, ascending)
        dates_2026.npy       : (n_time,) datetime64[ns] daily timestamps

    The adapter converts ``t_hours`` (hours since departure) to a calendar
    date using ``route_start_datetime`` and selects the nearest available
    daily forecast step.

    Grid mapping:
        The forecaster grid (173x369, 0.25 deg, lat -75..-32, lon -10..82)
        is mapped to any target EnvironmentalGrid via nearest-neighbour
        interpolation.  Values outside the forecaster domain become NaN.

    NaN policy:
        - Cells outside the forecaster lat/lon extent → NaN
        - Cells in the model-band extension columns (lon > 80, lat > -50)
          that are known to be outside the model domain → NaN
        - NaN in the source data is preserved (not replaced with 0)

    Usage::

        adapter = SICForecasterAdapter(
            cache_dir="backend/cache",
            route_start_datetime=datetime(2026, 1, 6, tzinfo=timezone.utc),
        )
        grid = adapter.load(t_hours=24.0, grid_template=grid)
    """

    def __init__(
        self,
        cache_dir: Optional[str] = None,
        route_start_datetime=None,
    ):
        super().__init__(path=cache_dir)
        self._route_start_datetime = route_start_datetime
        self._sic = None       # (n_time, n_lat, n_lon)
        self._lat = None       # (n_lat,)
        self._lon = None       # (n_lon,)
        self._dates = None     # (n_time,) datetime64[ns]
        self._loaded = False

    def _lazy_load(self):
        """Load all .npy files from cache_dir."""
        if self._loaded:
            return
        if not self.is_available():
            return

        cache = Path(self._path)
        self._sic = np.load(str(cache / "routing_sic_2026.npy"))
        self._lat = np.load(str(cache / "routing_lat.npy"))
        self._lon = np.load(str(cache / "routing_lon.npy"))
        self._dates = np.load(str(cache / "dates_2026.npy"), allow_pickle=True)
        self._loaded = True

    def _t_hours_to_time_index(self, t_hours: float) -> int:
        """
        Convert hours since departure to the nearest daily time index.

        Uses ``route_start_datetime + timedelta(hours=t_hours)`` to get
        the absolute date, then finds the closest entry in ``self._dates``.
        """
        if self._route_start_datetime is None:
            raise ValueError(
                "route_start_datetime must be set to convert t_hours to a date"
            )
        self._lazy_load()
        from datetime import timedelta
        query_dt = self._route_start_datetime + timedelta(hours=t_hours)
        query_np = np.datetime64(query_dt.replace(tzinfo=None))
        idx = int(np.argmin(np.abs(self._dates - query_np)))
        return idx

    def load(self, t_hours: float, grid_template: EnvironmentalGrid) -> EnvironmentalGrid:
        """
        Load SIC forecast at time t_hours and populate sic_mean.

        Missing/invalid values are NaN, not zero.
        """
        grid = self._copy_grid(grid_template)

        self._lazy_load()
        if not self._loaded or self._sic is None:
            grid.sic_mean = np.full((grid.n_rows, grid.n_cols), np.nan)
            grid.sic_uncertainty = np.full((grid.n_rows, grid.n_cols), np.nan)
            return grid

        t_idx = self._t_hours_to_time_index(t_hours)
        sic_2d = self._sic[t_idx].astype(np.float64)

        # Map forecaster grid → target grid
        if sic_2d.shape != (grid.n_rows, grid.n_cols):
            sic_2d = self._interpolate_to_grid(sic_2d, grid)

        grid.sic_mean = sic_2d
        return grid

    def get_forecaster_grid(self) -> EnvironmentalGrid:
        """
        Return the raw forecaster grid as an EnvironmentalGrid (no time selection).

        Useful for inspection / tests.
        """
        self._lazy_load()
        if not self._loaded:
            raise FileNotFoundError(
                f"SIC forecaster files not found in {self._path}"
            )
        n_rows, n_cols = self._lat.shape[0], self._lon.shape[0]
        navigable = np.ones((n_rows, n_cols), dtype=bool)
        return EnvironmentalGrid(
            n_rows=n_rows,
            n_cols=n_cols,
            lat=self._lat.copy(),
            lon=self._lon.copy(),
            navigable=navigable,
            resolution_deg=0.25,
        )

    def _interpolate_to_grid(
        self, data: np.ndarray, grid: EnvironmentalGrid,
    ) -> np.ndarray:
        """Nearest-neighbour from forecaster grid to target grid."""
        from scipy.interpolate import RegularGridInterpolator

        interp = RegularGridInterpolator(
            (self._lat, self._lon), data,
            method="nearest", bounds_error=False, fill_value=np.nan,
        )

        lon_mesh, lat_mesh = np.meshgrid(grid.lon, grid.lat)
        target_points = np.stack([lat_mesh.ravel(), lon_mesh.ravel()], axis=-1)
        result = interp(target_points).reshape(grid.n_rows, grid.n_cols)
        return result

    @property
    def n_time_steps(self) -> int:
        self._lazy_load()
        return self._dates.shape[0] if self._loaded else 0

    @property
    def date_range(self):
        """Return (first_date, last_date) as datetime objects."""
        self._lazy_load()
        if not self._loaded:
            return None, None
        import pandas as pd
        return (
            pd.Timestamp(self._dates[0]).to_pydatetime(),
            pd.Timestamp(self._dates[-1]).to_pydatetime(),
        )


    def load_uo_vo(self, t_hours: float, grid_template: EnvironmentalGrid):
        if not self.is_available():
            n_rows, n_cols = grid_template.n_rows, grid_template.n_cols
            return (
                np.zeros((n_rows, n_cols)),
                np.zeros((n_rows, n_cols)),
                grid_template.lat,
                grid_template.lon,
            )

        loader = self._get_loader()

        lat_min = float(grid_template.lat.min())
        lat_max = float(grid_template.lat.max())
        lon_min = float(grid_template.lon.min())
        lon_max = float(grid_template.lon.max())

        lat_bounds = self._lat_bounds if self._lat_bounds else (lat_min, lat_max)
        lon_bounds = self._lon_bounds if self._lon_bounds else (lon_min, lon_max)

        return loader.load_uo_vo(
            t_hours=t_hours,
            lat_bounds=lat_bounds,
            lon_bounds=lon_bounds,
        )

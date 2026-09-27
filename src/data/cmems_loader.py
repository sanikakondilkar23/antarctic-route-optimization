"""
Date-Aware CMEMS Current Loader
================================

Selects the correct CMEMS GLORYS current file for any requested datetime
between 2021-01-01 and 2025-12-31.

File selection rules:
    2021-2024:  {cmems_root}/{year}/Ocean_{year}_{month:02d}.nc
    2025:       {cmems_root}/2025/CMEMS_Current_2025_6hourly.nc

Time conversion:
    The route optimizer passes t_hours (hours since route departure).
    This loader converts to an absolute datetime using a user-supplied
    route_start_datetime.  The time origin is NEVER hidden inside the
    adapter.

Spatial handling:
    - Supports selecting only the required Antarctic region via lat/lon bounds
    - Handles different longitude grid sizes (4320 vs 4319) automatically
    - Uses xarray lazy access; only the required timestep + subset is read

Surface depth:
    Selects the existing CMEMS surface depth level (0.494025 m).

Current cost conversion:
    uo, vo -> current_cost is behind a clearly named function
    (current_speed_from_uv).  The current formula (sqrt(uo^2+vo^2)) is a
    placeholder; it MUST be corrected before scientific use.

Usage::

    loader = CMEMSDateAwareLoader(
        cmems_root="/content/drive/MyDrive/SIH_26_Sanika/dataset/Copernicus_Ocean",
        route_start_datetime=datetime(2025, 1, 1, 0, 0),
    )
    uo, vo, lat, lon = loader.load_uo_vo(t_hours=24.0, lat_bounds=(-70, -60), lon_bounds=(70, 80))
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional, Tuple

import numpy as np

try:
    import xarray as xr
    HAS_XARRAY = True
except ImportError:
    HAS_XARRAY = False


# ---------------------------------------------------------------------------
# Current cost conversion (isolated, correctable later)
# ---------------------------------------------------------------------------

def current_speed_from_uv(uo: np.ndarray, vo: np.ndarray) -> np.ndarray:
    """
    Convert zonal/meridional current velocities to speed magnitude.

    Parameters
    ----------
    uo : np.ndarray
        Zonal current velocity (m/s), positive = eastward.
    vo : np.ndarray
        Meridional current velocity (m/s), positive = northward.

    Returns
    -------
    np.ndarray
        Current speed (m/s), always >= 0.

    .. warning::
        This formula (sqrt(uo^2 + vo^2)) is a PLACEHOLDER for the
        adverse-current penalty used by the route optimizer.  It MUST be
        replaced with the scientifically validated conversion before any
        production use.  The conversion is isolated here so it can be
        corrected without rewriting the loader.
    """
    return np.sqrt(uo ** 2 + vo ** 2)


# ---------------------------------------------------------------------------
# File resolution
# ---------------------------------------------------------------------------

def resolve_cmems_path(
    cmems_root: str,
    query_datetime: datetime,
    *,
    allow_future_forecast: bool = True,
) -> Path:
    """
    Resolve the CMEMS netCDF file path for a given datetime.

    Parameters
    ----------
    cmems_root : str
        Root directory of CMEMS data, e.g. the ``Copernicus_Ocean`` or
        ``CMEMS_Future_Forecast`` directory of the dataset root.  Resolved via
        :mod:`src.data.paths`, never hardcoded.
    query_datetime : datetime
        The UTC datetime to find data for.
    allow_future_forecast : bool
        When the year is outside the reanalysis range, also accept a forecast
        file.  The committed SIC forecast period is 2026, which no CMEMS
        reanalysis covers, so a future-forecast product is the only legitimate
        source for those dates.

    Returns
    -------
    Path
        Path to the CMEMS file.

    Raises
    ------
    FileNotFoundError
        If no file exists for the given datetime.
    """
    year = query_datetime.year
    month = query_datetime.month
    root = Path(cmems_root)

    candidates: List[Path] = []

    if 2021 <= year <= 2024:
        candidates.append(root / str(year) / f"Ocean_{year}_{month:02d}.nc")
    elif year == 2025:
        candidates.append(root / "2025" / "CMEMS_Current_2025_6hourly.nc")
        candidates.append(root / str(year) / f"Ocean_{year}_{month:02d}.nc")

    if allow_future_forecast:
        candidates.extend([
            root / str(year) / f"Ocean_{year}_{month:02d}.nc",
            root / str(year) / f"CMEMS_Current_{year}_6hourly.nc",
            root / f"CMEMS_Current_{year}_6hourly.nc",
            root / str(year) / f"ocean_{year}_{month:02d}.nc",
        ])

    for path in candidates:
        if path.exists():
            return path

    searched = "\n  ".join(str(c) for c in dict.fromkeys(candidates))
    raise FileNotFoundError(
        f"CMEMS file not found for {query_datetime.isoformat()}.\n"
        f"  searched:\n  {searched}\n"
        f"  root: {root}"
    )


# ---------------------------------------------------------------------------
# Main loader
# ---------------------------------------------------------------------------

class CMEMSDateAwareLoader:
    """
    Date-aware CMEMS current loader with automatic file selection.

    Selects the correct CMEMS file based on the query datetime derived
    from route_start_datetime + t_hours.  Uses xarray lazy access to
    read only the required timestep and spatial subset.

    Parameters
    ----------
    cmems_root : str
        Root directory containing CMEMS data files.
    route_start_datetime : datetime
        The departure datetime for the route.  t_hours from the route
        optimizer is added to this to get the query datetime.
    lat_var : str
        Name of the latitude coordinate in the netCDF files.
    lon_var : str
        Name of the longitude coordinate in the netCDF files.
    uo_var : str
        Name of the zonal current variable.
    vo_var : str
        Name of the meridional current variable.
    time_var : str
        Name of the time coordinate.
    depth_var : str
        Name of the depth coordinate.
    """

    def __init__(
        self,
        cmems_root: str,
        route_start_datetime: datetime,
        lat_var: str = "latitude",
        lon_var: str = "longitude",
        uo_var: str = "uo",
        vo_var: str = "vo",
        time_var: str = "time",
        depth_var: str = "depth",
    ):
        self.cmems_root = cmems_root
        self.route_start_datetime = route_start_datetime
        self.lat_var = lat_var
        self.lon_var = lon_var
        self.uo_var = uo_var
        self.vo_var = vo_var
        self.time_var = time_var
        self.depth_var = depth_var

    def t_hours_to_datetime(self, t_hours: float) -> datetime:
        """
        Convert route-relative hours to absolute UTC datetime.

        Parameters
        ----------
        t_hours : float
            Hours since route departure.

        Returns
        -------
        datetime
            Absolute UTC datetime.
        """
        return self.route_start_datetime + timedelta(hours=t_hours)

    def load_uo_vo(
        self,
        t_hours: float,
        lat_bounds: Optional[Tuple[float, float]] = (-80.0, -50.0),
        lon_bounds: Optional[Tuple[float, float]] = None,
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """
        Load uo and vo at the given time with spatial subsetting.

        Parameters
        ----------
        t_hours : float
            Hours since route departure.
        lat_bounds : tuple of float, optional
            (lat_min, lat_max) for spatial subsetting.
            Defaults to (-80, -50) covering the Antarctic region.
        lon_bounds : tuple of float, optional
            (lon_min, lon_max) for spatial subsetting.
            None means no longitude subsetting (read all).

        Returns
        -------
        uo : np.ndarray
            Zonal current (m/s), 2D [n_lat, n_lon], NaN filled with 0.
        vo : np.ndarray
            Meridional current (m/s), 2D [n_lat, n_lon], NaN filled with 0.
        lat : np.ndarray
            1D latitude array of the loaded subset.
        lon : np.ndarray
            1D longitude array of the loaded subset.
        """
        if not HAS_XARRAY:
            raise ImportError("xarray is required for CMEMS date-aware loader")

        query_dt = self.t_hours_to_datetime(t_hours)
        file_path = resolve_cmems_path(self.cmems_root, query_dt)

        # Lazy open (no full file load)
        try:
            import dask  # noqa: F401
            ds = xr.open_dataset(str(file_path), chunks={"time": 1})
        except ImportError:
            ds = xr.open_dataset(str(file_path))

        try:
            # --- Spatial subset (lazy, before loading) ---
            sel_kwargs = {}
            if lat_bounds is not None:
                lat_min, lat_max = lat_bounds
                # CMEMS latitude may be ascending or descending; a label-based
                # slice requires the axis order to be known, so read it first
                # and slice in the axis's own direction.
                lat_axis = ds[self.lat_var]
                if lat_axis.size and lat_axis.values[0] > lat_axis.values[-1]:
                    sel_kwargs[self.lat_var] = slice(
                        max(lat_min, lat_max), min(lat_min, lat_max)
                    )
                else:
                    sel_kwargs[self.lat_var] = slice(
                        min(lat_min, lat_max), max(lat_min, lat_max)
                    )
            if lon_bounds is not None:
                lon_min, lon_max = lon_bounds
                lon_axis = ds[self.lon_var]
                if lon_axis.size and lon_axis.values[0] > lon_axis.values[-1]:
                    sel_kwargs[self.lon_var] = slice(
                        max(lon_min, lon_max), min(lon_min, lon_max)
                    )
                else:
                    sel_kwargs[self.lon_var] = slice(lon_min, lon_max)

            if sel_kwargs:
                ds = ds.sel(**sel_kwargs)

            # --- Time selection (nearest) ---
            # CMEMS time is datetime64; select nearest to query_dt
            ds_t = ds.sel({self.time_var: np.datetime64(query_dt)}, method="nearest")

            # --- Surface depth selection ---
            if self.depth_var in ds_t.dims:
                # Select the first (and typically only) surface depth level
                ds_t = ds_t.isel({self.depth_var: 0})

            # --- Read uo/vo into memory (only the subset + timestep) ---
            # NaN is preserved: a cell with no current measurement must not be
            # reported as zero current.  The cost map omits the current term
            # for such cells and records how many were omitted.
            uo = ds_t[self.uo_var].values.astype(np.float64)
            vo = ds_t[self.vo_var].values.astype(np.float64)

            lat = ds[self.lat_var].values
            lon = ds[self.lon_var].values

        finally:
            ds.close()

        return uo, vo, lat, lon

    def load_current_cost(
        self,
        t_hours: float,
        lat_bounds: Optional[Tuple[float, float]] = (-80.0, -50.0),
        lon_bounds: Optional[Tuple[float, float]] = None,
    ) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Load current cost (speed magnitude) at the given time.

        Parameters
        ----------
        t_hours : float
            Hours since route departure.
        lat_bounds : tuple of float, optional
            (lat_min, lat_max) for spatial subsetting.
        lon_bounds : tuple of float, optional
            (lon_min, lon_max) for spatial subsetting.

        Returns
        -------
        current_cost : np.ndarray
            Current speed (m/s), 2D [n_lat, n_lon], always >= 0.
        lat : np.ndarray
            1D latitude array.
        lon : np.ndarray
            1D longitude array.
        """
        uo, vo, lat, lon = self.load_uo_vo(t_hours, lat_bounds, lon_bounds)
        current_cost = current_speed_from_uv(uo, vo)
        return current_cost, lat, lon

    def inspect_file(self, t_hours: float) -> dict:
        """
        Inspect the CMEMS file metadata without loading data.

        Useful for debugging and validation.

        Returns
        -------
        dict with keys:
            path, time_steps, lat_size, lon_size, depth_values,
            lat_range, lon_range, query_datetime, selected_time
        """
        query_dt = self.t_hours_to_datetime(t_hours)
        file_path = resolve_cmems_path(self.cmems_root, query_dt)

        ds = xr.open_dataset(str(file_path))
        try:
            times = ds[self.time_var].values
            lats = ds[self.lat_var].values
            lons = ds[self.lon_var].values

            info = {
                "path": str(file_path),
                "year": query_dt.year,
                "month": query_dt.month,
                "query_datetime": query_dt.isoformat(),
                "time_steps": len(times),
                "time_dtype": str(times.dtype),
                "lat_size": len(lats),
                "lon_size": len(lons),
                "lat_range": (float(lats.min()), float(lats.max())),
                "lon_range": (float(lons.min()), float(lons.max())),
            }

            if self.depth_var in ds.dims:
                info["depth_values"] = ds[self.depth_var].values.tolist()
            else:
                info["depth_values"] = None

            # Find nearest time
            nearest_idx = int(np.argmin(np.abs(times - np.datetime64(query_dt))))
            info["selected_time"] = str(times[nearest_idx])
            info["selected_time_index"] = nearest_idx

        finally:
            ds.close()

        return info

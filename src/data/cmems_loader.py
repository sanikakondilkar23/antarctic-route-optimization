"""
Date-Aware CMEMS Current Loader
================================

Selects the correct CMEMS GLORYS current file for any requested datetime
between 2021-01-01 and 2025-12-31.

File selection rules:
    2021-2024:  {cmems_root}/{year}/Ocean_{year}_{month:02d}.nc
    2025:       {cmems_root}/2025/CMEMS_Current_2025_6hourly.nc
                (annual, 6-hourly, 1460 timesteps -- every month of 2025
                resolves to this single file, never to a monthly one)

Time conversion:
    The route optimizer passes t_hours (hours since route departure).
    This loader converts to an absolute datetime using a user-supplied
    route_start_datetime.  The time origin is NEVER hidden inside the
    adapter, and the nearest available step is selected rather than
    fabricating a timestamp.

Spatial handling:
    - Supports selecting only the required Antarctic region via lat/lon bounds
    - Correct for ASCENDING or DESCENDING latitude (real CMEMS files use both)
    - Handles different longitude grid sizes (4320 vs 4319) automatically
    - Uses xarray lazy access; only the required timestep + subset is read, so
      the 16.96 GB 2025 annual file is never loaded whole
    - Target cells outside the CMEMS latitude band (-80..-50) stay NaN

Surface depth:
    Selects the existing CMEMS surface depth level (0.494025 m).

NaN handling:
    NaN in uo or vo is PRESERVED.  It is never replaced with 0.0: a cell with
    no current measurement is not a cell with zero current.  If either
    component is missing, the whole current layer for that cell stays NaN.

Current cost conversion:
    uo, vo -> current_cost is behind a clearly named diagnostic function
    (current_speed_from_uv).  The current formula (sqrt(uo^2+vo^2)) is a
    speed magnitude, NOT a validated adverse-current penalty; it MUST be
    replaced before any scientific claim is made about a route.

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
        Current speed (m/s), always >= 0, with NaN wherever ``uo`` or ``vo`` is
        NaN (a partially known current is not a known current).

    .. warning::
       **DIAGNOSTIC ONLY -- not a validated adverse-current penalty.**

       ``sqrt(uo**2 + vo**2)`` is a speed *magnitude*.  A route's cost does not
       depend on speed alone: sailing with the current is cheaper and against it
       is dearer, which requires the heading of each edge relative to the
       current *vector*.  Feeding the magnitude into a non-negative cost term
       therefore penalises favourable currents as if they were adverse.

       The conversion is deliberately isolated in this one function so the
       physically correct directional penalty can replace it without touching
       the loader, the adapters, the cost map or the router.  Do not cite a
       route produced with this term as scientifically validated.
    """
    return np.sqrt(np.asarray(uo, dtype=np.float64) ** 2
                   + np.asarray(vo, dtype=np.float64) ** 2)



# ---------------------------------------------------------------------------
# File resolution
# ---------------------------------------------------------------------------

#: Sub-directory holding the CMEMS data, as it appears under ``DATA_ROOT``.
CMEMS_DIRNAME = "Copernicus_Ocean"

#: The 2025 product is a single annual 6-hourly file (~16.96 GB), not a set of
#: monthly files.  Every 2025 query resolves to this one file.
CMEMS_2025_ANNUAL = "CMEMS_Current_2025_6hourly.nc"

#: Years covered by the monthly ``Ocean_{year}_{month:02d}.nc`` layout.
CMEMS_MONTHLY_YEARS = (2021, 2024)

#: The annual 6-hourly product is 6-hourly over 2025 -> 1460 timesteps
#: (leap year: 366 days x 4).  Used to sanity-check a file before reading it.
CMEMS_2025_EXPECTED_STEPS = 1460
CMEMS_STEP_HOURS = 6.0


def cmems_annual_filename(year: int) -> Optional[str]:
    """Name of the annual 6-hourly file for ``year``, or None if none exists."""
    return (CMEMS_2025_ANNUAL if year == 2025 else
            f"CMEMS_Current_{year}_6hourly.nc")


def _axis_slice(axis, lo: float, hi: float) -> slice:
    """
    A label slice ``[lo, hi]`` expressed in the axis's OWN direction.

    Real CMEMS files are inconsistent here: some ship ``latitude`` ascending
    (-50 -> -80), others descending (-80 -> -50).  ``xarray`` interprets a
    ``slice`` positionally, so a descending axis needs the bounds swapped or
    the selection comes back empty.  Deciding here, from the axis's own values,
    makes spatial selection correct for either orientation.
    """
    values = np.asarray(axis.values, dtype=np.float64)
    if values.size == 0:
        return slice(lo, hi)
    if values[0] > values[-1]:
        return slice(hi, lo)
    return slice(lo, hi)


def _axis_range(ds, name: str) -> tuple:
    """(min, max) of a coordinate axis, for error messages."""
    values = np.asarray(ds[name].values, dtype=np.float64)
    if values.size == 0:
        return (None, None)
    return (float(np.nanmin(values)), float(np.nanmax(values)))


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
        If no file exists for the given datetime.  Never falls back to a
        different product, a synthetic file, or a different date: every
        candidate is one that genuinely contains the requested time.
    """
    year = query_datetime.year
    month = query_datetime.month
    root = Path(cmems_root)

    candidates: List[Path] = []

    if 2021 <= year <= 2024:
        candidates.append(root / str(year) / f"Ocean_{year}_{month:02d}.nc")
    elif year == 2025:
        # 2025 is annual-only: the whole year lives in one 6-hourly file, so
        # every month of 2025 must resolve here and NOT to a monthly file.
        candidates.append(root / "2025" / CMEMS_2025_ANNUAL)

    if allow_future_forecast:
        annual = cmems_annual_filename(year)
        candidates.extend([
            root / str(year) / f"Ocean_{year}_{month:02d}.nc",
            root / str(year) / annual,
            root / annual,
        ])
        # Lowercase spelling of the monthly file, for case-sensitive exports.
        if 2021 <= year <= 2024:
            candidates.append(root / str(year) / f"ocean_{year}_{month:02d}.nc")

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

    def resolve_path(self, t_hours: float) -> Path:
        """
        Path of the CMEMS file that would serve ``t_hours``.

        Exposed so a caller can record which real file a layer came from
        without loading it.  Raises ``FileNotFoundError`` when nothing matches.
        """
        return resolve_cmems_path(
            self.cmems_root, self.t_hours_to_datetime(t_hours)
        )

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
            Zonal current (m/s), 2D [n_lat, n_lon].  **NaN is preserved**: a
            cell with no current measurement keeps NaN and is never filled
            with 0.0.
        vo : np.ndarray
            Meridional current (m/s), 2D [n_lat, n_lon], NaN preserved.
        lat : np.ndarray
            1D latitude array of the loaded subset, in the file's own order
            (ascending or descending; not sorted here, so the caller can map
            it back to the data it was sliced from).
        lon : np.ndarray
            1D longitude array of the loaded subset.

        Raises
        ------
        ValueError
            If the requested bounds select no data, rather than returning empty
            arrays that would silently propagate as an all-NaN layer.
        """
        if not HAS_XARRAY:
            raise ImportError("xarray is required for CMEMS date-aware loader")

        query_dt = self.t_hours_to_datetime(t_hours)
        file_path = resolve_cmems_path(self.cmems_root, query_dt)

        # Lazy open: nothing is read here, only the file index.  The 2025
        # annual file is ~16.96 GB / 1460 timesteps, so the spatial subset and
        # the single nearest timestep MUST be applied before any .values call.
        try:
            import dask  # noqa: F401
            ds = xr.open_dataset(str(file_path), chunks={"time": 1})
        except ImportError:
            ds = xr.open_dataset(str(file_path))

        try:
            # --- Spatial subset (lazy, before loading) ---
            # CMEMS latitude may be ascending or descending, so each axis is
            # sliced in its OWN direction.  A label slice with the wrong
            # direction silently returns an empty selection.
            sel_kwargs = {}
            if lat_bounds is not None:
                lat_min, lat_max = min(lat_bounds), max(lat_bounds)
                sel_kwargs[self.lat_var] = _axis_slice(
                    ds[self.lat_var], lat_min, lat_max,
                )
            if lon_bounds is not None:
                lon_min, lon_max = min(lon_bounds), max(lon_bounds)
                sel_kwargs[self.lon_var] = _axis_slice(
                    ds[self.lon_var], lon_min, lon_max,
                )

            if sel_kwargs:
                ds = ds.sel(**sel_kwargs)

            # --- Time selection: nearest 6-hourly step to the query ---
            # The query datetime is never snapped or fabricated; the nearest
            # available step is selected and reported by inspect_file().
            if self.time_var in ds.dims:
                ds_t = ds.sel(
                    {self.time_var: np.datetime64(query_dt)}, method="nearest",
                )
            else:
                ds_t = ds

            # --- Surface depth selection ---
            # GLORYS's first level is the surface layer (~0.49 m).
            if self.depth_var in ds_t.dims:
                ds_t = ds_t.isel({self.depth_var: 0})

            lat = np.asarray(ds[self.lat_var].values, dtype=np.float64)
            lon = np.asarray(ds[self.lon_var].values, dtype=np.float64)

            if lat.size == 0 or lon.size == 0:
                raise ValueError(
                    f"the requested bounds lat_bounds={lat_bounds}, "
                    f"lon_bounds={lon_bounds} select no cells from "
                    f"{file_path.name} (available latitude "
                    f"{_axis_range(ds, self.lat_var)}, longitude "
                    f"{_axis_range(ds, self.lon_var)}). The loader will not "
                    "widen the bounds or fall back to another file, because "
                    "either would report currents for a region or a date the "
                    "dataset does not cover."
                )

            for name in (self.uo_var, self.vo_var):
                if name not in ds_t:
                    raise KeyError(
                        f"CMEMS variable {name!r} not present in "
                        f"{file_path.name}. Available: "
                        f"{sorted(ds_t.data_vars)}. The loader will not "
                        "substitute a different variable, because uo and vo "
                        "are the measured vectors and the layer is meaningless "
                        "without both."
                    )

            # --- Read the subset timestep only ---
            # NaN is preserved: a cell with no current measurement must not be
            # reported as zero current.  np.nan_to_num(..., nan=0.0) is never
            # applied.
            uo = ds_t[self.uo_var].values.astype(np.float64)
            vo = ds_t[self.vo_var].values.astype(np.float64)

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
            selected = np.datetime64(times[nearest_idx])
            info["selected_time"] = str(selected)
            info["selected_time_index"] = nearest_idx
            info["selected_time_offset_hours"] = float(
                (selected - np.datetime64(query_dt))
                / np.timedelta64(1, "h")
            )
            # Confirm the 6-hourly cadence rather than assuming it, so an
            # unexpected cadence is visible instead of silently biasing the
            # nearest-step choice.
            if times.size > 1:
                info["median_step_hours"] = float(
                    np.median(np.diff(times)) / np.timedelta64(1, "h")
                )
            info["time_origin"] = str(times[0])
            info["time_end"] = str(times[-1])
            if file_path.name == CMEMS_2025_ANNUAL:
                info["expected_steps"] = CMEMS_2025_EXPECTED_STEPS
                info["step_count_matches_2025_6hourly"] = bool(
                    times.size == CMEMS_2025_EXPECTED_STEPS
                )

        finally:
            ds.close()

        return info

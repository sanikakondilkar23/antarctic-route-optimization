"""
Faithful stand-ins for the real Google Drive datasets.

The Drive tree (``/content/drive/MyDrive/SIH_26_Sanika/dataset``) is not
mounted in CI, so these builders write netCDF files that reproduce the
*structure* of the real products exactly as documented:

SIC  (``DATA_ROOT/SIC/``)
    NSIDC / Sea-Ice CDR style:
        ``cdr_seaice_conc(time, y, x)`` on an EPSG:3412 polar-stereographic
        x/y grid in metres, with **no** lat/lon coordinate in the file.
    Real products cover only part of the route domain, which these fixtures
    reproduce: the source grid is deliberately smaller than the route grid so
    "outside coverage" is a real condition and not a hypothetical.

CMEMS (``DATA_ROOT/Copernicus_Ocean/``)
    2021-2024: ``{year}/Ocean_{year}_{month:02d}.nc``
    2025:      ``2025/CMEMS_Current_2025_6hourly.nc``
        ``uo, vo(time, depth, latitude, longitude)``, latitude -80..-50,
        6-hourly.  The real 2025 file has 1460 timesteps and 4319 longitudes;
        the fixture matches both counts, but at a reduced spatial size so it
        stays cheap.  Latitude is written DESCENDING (-80 -> -50) by default,
        which is the orientation real GLORYS files ship.

These fixtures are test scaffolding.  They are never used as a runtime data
source, and no test asserts a scientific result from them.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Optional, Sequence

import numpy as np
import xarray as xr

# ---------------------------------------------------------------------------
# Shared constants describing the real products
# ---------------------------------------------------------------------------

#: NSIDC CDR variable name.  Reading anything else is a different product.
SIC_VAR = "cdr_seaice_conc"

#: Real SIC grid CRS.
SIC_CRS = "EPSG:3412"

#: Real CMEMS coordinate names.
CMEMS_LAT_VAR = "latitude"
CMEMS_LON_VAR = "longitude"

#: Real CMEMS latitude band.  The route grid reaches -32, so rows north of
#: -50 are genuinely outside the CMEMS domain.
CMEMS_LAT_MIN, CMEMS_LAT_MAX = -80.0, -50.0

#: Real 2025 annual file: 6-hourly over a leap year.
CMEMS_2025_STEPS = 1460
CMEMS_2025_LON_COUNT = 4319

#: The project's target routing grid (see dataset/audit/dataset_audit.json).
ROUTE_LAT_MIN, ROUTE_LAT_MAX = -75.0, -32.0
ROUTE_LON_MIN, ROUTE_LON_MAX = -10.0, 82.0
ROUTE_RESOLUTION = 0.25
ROUTE_ROWS, ROUTE_COLS = 173, 369


# ---------------------------------------------------------------------------
# SIC fixture
# ---------------------------------------------------------------------------

def epsg3412_axes(
    half_width_km: float = 3000.0,
    step_km: float = 50.0,
):
    """
    Symmetric EPSG:3412 x/y axes in metres, as the CDR product stores them.

    A polar-stereographic axis is NOT a latitude axis, which is precisely why
    the adapter must transform coordinates instead of indexing by position.
    """
    half = half_width_km * 1000.0
    step = step_km * 1000.0
    n = int(2 * half / step) + 1
    return np.linspace(-half, half, n).astype(np.float64)


def write_sic_cdr(
    path: Path,
    times: Sequence[datetime],
    *,
    x: Optional[np.ndarray] = None,
    y: Optional[np.ndarray] = None,
    variable: str = SIC_VAR,
    fill=None,
    time_dim: str = "time",
) -> Path:
    """
    Write an NSIDC/Sea-Ice CDR style SIC file.

    Parameters
    ----------
    times : sequence of datetime
        Time stamps for the (time, y, x) axis.
    x, y : np.ndarray, optional
        Projected axes in metres.  Defaults to :func:`epsg3412_axes`.
    fill : callable, optional
        ``fill(x2d, y2d) -> array`` giving the SIC field for one timestep, so a
        test can plant a known pattern (including NaN) in known source cells.
        Defaults to a smooth 0..1 field.
    variable : str
        Variable name to write.  Overridden to a wrong name by the test that
        checks the adapter does not silently substitute a different variable.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    x = epsg3412_axes() if x is None else np.asarray(x, dtype=np.float64)
    y = epsg3412_axes() if y is None else np.asarray(y, dtype=np.float64)
    xx, yy = np.meshgrid(x, y)

    n_t = len(times)
    data = np.empty((n_t, y.size, x.size), dtype=np.float32)
    for i in range(n_t):
        if fill is None:
            data[i] = (0.05 + 0.9 * (1.0 - np.abs(yy) / np.abs(yy).max())).astype(
                np.float32)
        else:
            data[i] = np.asarray(fill(xx, yy), dtype=np.float32)

    ds = xr.Dataset(
        {variable: (("time", "y", "x"), data)},
        coords={
            time_dim: np.array(
                [np.datetime64(t.replace(tzinfo=None), "ns") for t in times],
                dtype="datetime64[ns]",
            ),
            "y": ("y", y),
            "x": ("x", x),
        },
        attrs={"Conventions": "CF-1.6"},
    )
    ds.to_netcdf(str(path))
    ds.close()
    return path


# ---------------------------------------------------------------------------
# CMEMS fixture
# ---------------------------------------------------------------------------

def write_cmems(
    path: Path,
    times: Sequence[datetime],
    *,
    n_lat: int = 61,
    n_lon: int = 24,
    lat_descending: bool = True,
    uo: Optional[np.ndarray] = None,
    vo: Optional[np.ndarray] = None,
    n_depth: int = 1,
    depth: Optional[np.ndarray] = None,
    time_dim: str = "time",
) -> Path:
    """
    Write a CMEMS GLORYS style current file: uo, vo(time, depth, latitude, longitude).

    ``lat_descending`` writes latitude as -80 -> -50 (the real orientation).
    Set it False to write -50 -> -80 and prove the loader handles both.

    ``uo``/``vo`` are full ``(time, depth, lat, lon)`` arrays when given, so a
    test can plant NaNs in specific cells.  Otherwise a constant field is
    written, which keeps the 1460-timestep fixture cheap.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    # linspace is ascending (-80 -> -50); a DESCENDING axis (what real GLORYS
    # files ship) is the reversed array, so flip only when asked to.
    lats = np.linspace(CMEMS_LAT_MIN, CMEMS_LAT_MAX, n_lat)
    if lat_descending:
        lats = lats[::-1]
    lons = np.linspace(0.0, 360.0 - 360.0 / n_lon, n_lon)
    if depth is None:
        depth = np.linspace(0.494025, 4000.0, n_depth) if n_depth > 1 \
            else np.array([0.494025])
    depth = np.asarray(depth, dtype=np.float64)

    shape = (len(times), n_depth, n_lat, n_lon)
    if uo is None:
        uo = np.full(shape, 0.10, dtype=np.float32)
    if vo is None:
        vo = np.full(shape, -0.05, dtype=np.float32)
    uo = np.asarray(uo, dtype=np.float32)
    vo = np.asarray(vo, dtype=np.float32)
    if uo.shape != shape or vo.shape != shape:
        raise ValueError(
            f"uo/vo shape {uo.shape}/{vo.shape} does not match the requested "
            f"file shape {shape}"
        )

    ds = xr.Dataset(
        {
            "uo": ((time_dim, "depth", CMEMS_LAT_VAR, CMEMS_LON_VAR), uo),
            "vo": ((time_dim, "depth", CMEMS_LAT_VAR, CMEMS_LON_VAR), vo),
        },
        coords={
            time_dim: np.array(
                [np.datetime64(t.replace(tzinfo=None), "ns") for t in times],
                dtype="datetime64[ns]",
            ),
            "depth": ("depth", depth),
            CMEMS_LAT_VAR: (CMEMS_LAT_VAR, lats),
            CMEMS_LON_VAR: (CMEMS_LON_VAR, lons),
        },
        attrs={"Conventions": "CF-1.6"},
    )
    ds.to_netcdf(str(path))
    ds.close()
    return path


def _steps_6hourly(start: datetime, n: int):
    """``n`` 6-hourly stamps from ``start``, as naive datetimes."""
    step = np.timedelta64(int(6 * 3600 * 1e9), "ns")
    base = np.datetime64(start.replace(tzinfo=None), "ns")
    return [(base + step * i).astype("datetime64[us]").astype(object)
            for i in range(n)]


def monthly_times(year: int, month: int, step_hours: float = 6.0):
    """6-hourly stamps covering one calendar month (day 1 00:00 -> month end)."""
    start = datetime(year, month, 1)
    nxt = datetime(year + 1, 1, 1) if month == 12 \
        else datetime(year, month + 1, 1)
    total_hours = int((nxt - start).total_seconds() // 3600)
    n = int(round(total_hours / step_hours)) + 1
    return _steps_6hourly(start, n)


def annual_2025_times():
    """The real 2025 file's stamps: 1460 6-hourly steps, 2025-01-01 onwards."""
    return _steps_6hourly(datetime(2025, 1, 1), CMEMS_2025_STEPS)

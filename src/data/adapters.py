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
from typing import Dict, Optional

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
# Coordinate-based nearest-neighbour helpers
# ---------------------------------------------------------------------------
#
# These implement the project's single alignment rule: map a source field onto
# the route grid by looking up source cells at the target cells' own
# coordinates.  They never resize an array to make shapes agree, never
# zero-fill, and return NaN wherever the source has no cell.

def _nearest_axis(axis: np.ndarray, targets: np.ndarray,
                 inside: Optional[np.ndarray] = None) -> np.ndarray:
    """
    Index of the nearest value in a 1-D source ``axis`` for each target value.

    Parameters
    ----------
    axis : np.ndarray
        1-D source coordinate values (any monotonic order; sorted internally).
    targets : np.ndarray
        Target values, broadcastable to a common shape with ``axis``.
    inside : np.ndarray, optional
        Boolean mask of target cells that lie within the source extent.
        Cells outside it get index ``-1``, which makes the gather leave them
        NaN.  When omitted, every target is treated as inside.

    Returns
    -------
    np.ndarray
        Integer index into ``axis`` for each target cell; ``-1`` where masked
        out.  Using ``-1`` (rather than clipping) is what guarantees that an
        out-of-coverage cell can never pick up a boundary value by accident.
    """
    axis = np.asarray(axis, dtype=np.float64)
    if axis.size == 0:
        raise ValueError("cannot do a nearest-neighbour lookup on an empty axis")
    order = np.argsort(axis)
    sorted_axis = axis[order]

    targets = np.asarray(targets, dtype=np.float64)
    pos = np.searchsorted(sorted_axis, targets)
    pos = np.clip(pos, 1, sorted_axis.size - 1) if sorted_axis.size > 1 \
        else np.zeros_like(pos, dtype=int)
    if sorted_axis.size == 1:
        idx_sorted = np.zeros(targets.shape, dtype=int)
    else:
        left = sorted_axis[pos - 1]
        right = sorted_axis[pos]
        idx_sorted = np.where(
            np.abs(targets - left) <= np.abs(right - targets), pos - 1, pos,
        )
    idx = order[idx_sorted]

    if inside is not None:
        idx = np.where(inside, idx, -1)
    return idx.astype(np.intp, copy=False)


def _gather(data_2d: np.ndarray, rows: np.ndarray, cols: np.ndarray,
            inside: np.ndarray) -> np.ndarray:
    """
    Gather ``data_2d[row, col]`` into the target shape, NaN outside coverage.

    Cells where ``inside`` is False get NaN, and source NaN is copied through
    unchanged: the value in the grid is exactly the value in the file.
    """
    data_2d = np.asarray(data_2d)
    out_shape = np.broadcast(rows, cols).shape
    rows = np.broadcast_to(rows, out_shape)
    cols = np.broadcast_to(cols, out_shape)
    inside = np.broadcast_to(np.asarray(inside, dtype=bool), out_shape)

    out = np.full(out_shape, np.nan, dtype=np.float64)
    if not inside.any():
        return out
    vals = data_2d[rows[inside], cols[inside]]
    # A masked (_FillValue) source cell may still arrive as a finite sentinel;
    # the sanitiser maps genuinely out-of-range values to NaN afterwards.
    out[inside] = np.asarray(vals, dtype=np.float64)
    out[~np.isfinite(out)] = np.nan
    return out


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

    def close(self) -> None:
        """
        Release the lazily-opened netCDF handle, if any.

        Adapters keep their file open between calls, which is what makes
        repeated ``load()`` cheap.  Long-lived processes should call this when
        finished so the file is not held (on Windows an open handle also blocks
        deleting or replacing the file).  Safe to call more than once, and a
        no-op for adapters that hold no file.
        """
        ds = getattr(self, "_ds", None)
        if ds is not None:
            try:
                ds.close()
            except Exception:  # pragma: no cover - best-effort cleanup
                pass
            self._ds = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
        return False

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
    Load sea-ice concentration from NSIDC Sea-Ice CDR (the real product in
    ``DATA_ROOT/SIC/``) or from a geographic CMEMS-style product.

    Real product this adapter targets
    ---------------------------------
    NSIDC/Sea-Ice CDR netCDF::

        cdr_seaice_conc(time, y, x)      # y, x in metres, EPSG:3412
        # NO lat/lon coordinates in the file

    ``EPSG:3412`` is Antarctic polar stereographic.  Its x/y axes are *not*
    lat/lon, so the adapter never assumes they are, and never indexes the
    target grid by array position.  It instead:

    1. Transforms the **target** grid's WGS84 lon/lat into the source CRS
       (inverse transform) with ``pyproj``, and
    2. Looks the nearest source cell up **by coordinate** in that projected
       space.

    This is exact for a polar-stereographic grid, cheap (binary search over the
    sorted x/y axes), and needs no rectilinear lon/lat approximation of the
    source at all.  An earlier implementation scattered the source into a
    synthetic lat/lon rectangle with a per-cell Python loop; a polar-stereo grid
    is not rectilinear in lon/lat, so that both lost data and was
    prohibitively slow on a real CDR grid.

    Coverage policy
    ---------------
    * A target cell with no source cell -> ``NaN``.
    * A source cell that is ``NaN``     -> ``NaN`` in the target.
    * Values outside the valid SIC range -> ``NaN``.
    * ``fill_value`` is never 0.0.  There is no zero-fill, no mean-fill, no
      shape-resize and no extrapolation; missing coverage stays missing and is
      reported through :meth:`coverage`.

    Note on the SIC validity range
    ------------------------------
    NSIDC CDR encodes open water as exactly ``0.0`` and packs an all-ice
    sentinel of ``-1``; both map onto the documented ``[0, 1]`` fraction range
    (``-1`` -> 0.0) and are genuine measurements, so they are NOT treated as
    missing.  Only genuinely absent cells become NaN.
    """

    def __init__(
        self,
        path: Optional[str] = None,
        variable: str = "cdr_seaice_conc",
        uncertainty_variable: Optional[str] = None,
        time_dim: str = "time",
        lat_dim: str = "lat",
        lon_dim: str = "lon",
        x_dim: Optional[str] = "x",
        y_dim: Optional[str] = "y",
        crs: Optional[str] = "EPSG:3412",
        route_start_datetime=None,
        source_format: str = "projected_x_y",
        source_lon_bounds=None,
        source_lat_bounds=None,
        max_nn_distance_deg: Optional[float] = None,
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
        self.route_start_datetime = route_start_datetime
        self.source_format = source_format
        self._source_lon_bounds = source_lon_bounds
        self._source_lat_bounds = source_lat_bounds
        self.max_nn_distance_deg = max_nn_distance_deg

        if source_format not in ("projected_x_y", "geographic", "auto"):
            raise ValueError(
                f"source_format={source_format!r} is unknown; expected "
                "'projected_x_y', 'geographic' or 'auto'"
            )
        if source_format == "geographic" and (x_dim or y_dim):
            raise ValueError(
                "source_format='geographic' conflicts with x_dim/y_dim "
                f"({x_dim!r}, {y_dim!r}); clear them to read a 1-D lat/lon grid"
            )
        if (x_dim or y_dim) and not crs:
            raise ValueError(
                f"crs must be specified when x_dim={x_dim!r}/y_dim={y_dim!r} "
                "are set (the real SIC product is EPSG:3412). The adapter will "
                "not guess a projection."
            )

        self._ds = None  # lazy-loaded dataset
        self._mode: Optional[str] = None      # 'projected' | 'geographic'
        self._src_lats: Optional[np.ndarray] = None
        self._src_lons: Optional[np.ndarray] = None
        self._src_x: Optional[np.ndarray] = None
        self._src_y: Optional[np.ndarray] = None
        self._coverage: Dict[str, object] = {}

    # -- lazy opening ---------------------------------------------------

    def _open_dataset(self):
        """Lazy-load the netCDF file (metadata only; no data read)."""
        if self._ds is None and self.is_available():
            if not HAS_XARRAY:
                raise ImportError("xarray is required for SIC adapter")
            self._ds = xr.open_dataset(self._path)
            self._prepare_source_coords()

    def _prepare_source_coords(self):
        """
        Read the source coordinate axes and work out the grid mode.

        For a projected source only the two small 1-D axes are read here; the
        data variable itself stays untouched until a timestep is selected.
        """
        ds = self._ds
        if self.variable not in ds.data_vars:
            raise KeyError(
                f"SIC variable {self.variable!r} not present in {self._path}. "
                f"Available variables: {sorted(ds.data_vars)}. The adapter will "
                "not substitute a different variable, because that would "
                "silently change which product was read."
            )

        has_xy = bool(self.x_dim) and bool(self.y_dim) and \
            self.x_dim in ds.dims and self.y_dim in ds.dims
        has_ll = self.lat_dim in ds.dims and self.lon_dim in ds.dims

        if self.source_format == "projected_x_y" or (
                self.source_format == "auto" and has_xy and not has_ll):
            if not has_xy:
                raise ValueError(
                    f"SIC source_format says projected x/y, but "
                    f"x_dim={self.x_dim!r}/y_dim={self.y_dim!r} are not both "
                    f"dimensions of {self._path} (dims: {tuple(ds.dims)}). The "
                    "adapter will not fall back to a lat/lon reading, because "
                    "the two imply different spatial grids."
                )
            if not HAS_PYPROJ:
                raise ImportError(
                    f"pyproj is required to read projected SIC ({self.crs}). "
                    "Install with: pip install pyproj"
                )
            self._src_x = np.asarray(ds[self.x_dim].values, dtype=np.float64)
            self._src_y = np.asarray(ds[self.y_dim].values, dtype=np.float64)
            self._mode = "projected"
            self._src_lats = self._src_lons = None
            return

        if not has_ll:
            raise ValueError(
                f"SIC source has neither geographic ({self.lat_dim}/"
                f"{self.lon_dim}) nor configured x/y dimensions. dims="
                f"{tuple(ds.dims)}"
            )
        self._src_lats = np.asarray(ds[self.lat_dim].values, dtype=np.float64)
        self._src_lons = np.asarray(ds[self.lon_dim].values, dtype=np.float64)
        self._mode = "geographic"
        self._src_x = self._src_y = None

    # -- coverage reporting ---------------------------------------------

    def coverage(self) -> Dict[str, object]:
        """
        Describe the native coverage of the source product, in WGS84.

        Requires the file to have been opened (``load()`` once, or
        ``_open_dataset()``).  Returns a dict with the source mode, CRS, the
        native lon/lat bounding box and the native axis counts, so a consumer
        can state exactly which target cells the dataset can and cannot
        describe.  Returns ``{"status": "not_opened"}`` before the first open.
        """
        if self._mode is None:
            return {"status": "not_opened", "path": self._path}
        return dict(self._coverage)

    def _compute_coverage(self) -> None:
        """Derive the native lon/lat bounding box of the source axes."""
        if self._mode == "projected":
            if not HAS_PYPROJ:
                self._coverage = {"status": "unknown", "reason": "pyproj missing"}
                return
            tr = Transformer.from_crs(self.crs, "EPSG:4326", always_xy=True)
            xs = np.concatenate([self._src_x[[0, -1]],
                                 [0.0]])  # include the projection origin
            ys = np.concatenate([self._src_y[[0, -1]], [0.0]])
            gx, gy = np.meshgrid(xs, ys)
            lon, lat = tr.transform(gx, gy)
            lon_bounds = (float(np.nanmin(lon)), float(np.nanmax(lon)))
            lat_bounds = (float(np.nanmin(lat)), float(np.nanmax(lat)))
            n_x, n_y = int(self._src_x.size), int(self._src_y.size)
        else:
            lon_bounds = (float(np.nanmin(self._src_lons)),
                          float(np.nanmax(self._src_lons)))
            lat_bounds = (float(np.nanmin(self._src_lats)),
                          float(np.nanmax(self._src_lats)))
            n_x, n_y = int(self._src_lons.size), int(self._src_lats.size)

        if self._source_lon_bounds is not None:
            lon_bounds = tuple(self._source_lon_bounds)
        if self._source_lat_bounds is not None:
            lat_bounds = tuple(self._source_lat_bounds)

        self._coverage = {
            "status": "known",
            "path": str(self._path),
            "variable": self.variable,
            "mode": self._mode,
            "crs": self.crs if self._mode == "projected" else "EPSG:4326",
            "source_lon_bounds": lon_bounds,
            "source_lat_bounds": lat_bounds,
            "n_x": n_x,
            "n_y": n_y,
            "policy": "nan_outside_source_coverage",
        }

    def _set_provenance(self, grid: EnvironmentalGrid, reason: str) -> None:
        cov = self.coverage()
        status = (grid.layer_status or {})
        prov = (grid.layer_provenance or {})
        status["sic_mean"] = "REAL" if reason == "loaded" else "NOT_AVAILABLE"
        prov["sic_mean"] = {
            "source": str(self._path),
            "variable": self.variable,
            "crs": cov.get("crs"),
            "mode": cov.get("mode"),
            "source_lon_bounds": cov.get("source_lon_bounds"),
            "source_lat_bounds": cov.get("source_lat_bounds"),
            "reason": reason,
        }
        grid.layer_status = status
        grid.layer_provenance = prov

    # -- time selection -------------------------------------------------

    def _resolve_query_time(self, t_hours: float):
        """
        Turn ``t_hours`` into a value comparable with the file's time axis.

        A datetime-typed time axis cannot be searched with ``t_hours``
        (hours-since-departure): ``t_hours=0`` would resolve to the epoch and
        silently return the first field in the file.  An explicit
        ``route_start_datetime`` is therefore required whenever a time axis is
        present; without one this raises instead of guessing.
        """
        from datetime import timedelta
        if self.route_start_datetime is None:
            raise ValueError(
                f"SIC variable {self.variable!r} has a time axis, so t_hours "
                "(hours since departure) cannot be resolved without a time "
                "origin. Pass route_start_datetime= to SICAdapter. The adapter "
                "will not assume the epoch or default to the first timestep, "
                "because either would silently report the wrong date's ice."
            )
        return self.route_start_datetime + timedelta(hours=float(t_hours))

    def _select_time(self, da, t_hours: float):
        """Select the timestep of ``da`` nearest the resolved query time."""
        if self.time_dim not in da.dims:
            return da
        query = self._resolve_query_time(t_hours)
        axis = da[self.time_dim].values
        if np.issubdtype(np.asarray(axis).dtype, np.datetime64):
            return da.sel({self.time_dim: np.datetime64(query).astype(axis.dtype)},
                          method="nearest")
        # Numeric axis: the origin and unit must come from the file, never from
        # an assumption.  CF declares it in the "units" attribute, e.g.
        # "hours since 2021-01-01T00:00:00".
        return da.sel({self.time_dim: self._numeric_time(da, query)},
                      method="nearest")

    def _numeric_time(self, da, query) -> float:
        """Map an absolute datetime onto a CF numeric time axis."""
        units = getattr(da[self.time_dim], "attrs", {}).get("units")
        if not units:
            raise ValueError(
                f"SIC time axis {self.time_dim!r} is numeric and declares no "
                "'units' attribute, so its origin is unknown and t_hours cannot "
                "be resolved. The adapter will not guess an origin, because a "
                "wrong origin silently returns the wrong date's ice field."
            )
        try:
            decoded = xr.coding.times.CFDatetimeCoder(use_cftime=True).decode(
                np.asarray([query], dtype="datetime64[ns]"), units
            )
        except Exception as exc:  # pragma: no cover - depends on file attrs
            raise ValueError(
                f"could not decode SIC time axis from units={units!r}: {exc}"
            ) from exc
        if not hasattr(decoded, "__len__") or len(decoded) != 1:
            raise ValueError(f"unexpected CF time decode for units={units!r}")
        return float(np.asarray(decoded).ravel()[0])

    # -- load ------------------------------------------------------------

    def load(self, t_hours: float, grid_template: EnvironmentalGrid) -> EnvironmentalGrid:
        """
        Load SIC at time t and populate sic_mean on the grid.

        Cells the source does not cover, and cells the source reports as NaN,
        stay NaN.  Nothing is zero-filled, mean-filled, shape-resized or
        extrapolated.
        """
        grid = self._copy_grid(grid_template)
        shape = (grid.n_rows, grid.n_cols)

        if not self.is_available():
            grid.sic_mean = np.full(shape, np.nan)
            grid.sic_uncertainty = np.full(shape, np.nan)
            self._set_provenance(grid, "sic_path_missing_or_unreachable")
            return grid

        self._open_dataset()
        if self._mode is None or not self._coverage:
            self._compute_coverage()
        ds = self._ds

        sic_2d = self._select_2d(
            np.asarray(self._select_time(ds[self.variable], t_hours).values,
                      dtype=np.float64),
            self.variable,
        )
        grid.sic_mean = self._sanitize(self._map_to_grid(sic_2d, grid))

        if (self.uncertainty_variable
                and self.uncertainty_variable in ds.data_vars):
            std_2d = self._select_2d(
                np.asarray(
                    self._select_time(ds[self.uncertainty_variable],
                                      t_hours).values,
                    dtype=np.float64),
                self.uncertainty_variable,
            )
            grid.sic_uncertainty = self._sanitize(
                self._map_to_grid(std_2d, grid))

        self._set_provenance(grid, "loaded")
        return grid

    def _select_2d(self, data: np.ndarray, name: str) -> np.ndarray:
        """Reduce a selected variable to a 2-D (y, x) / (lat, lon) field."""
        if data.ndim == 2:
            return data
        if data.ndim != 3:
            raise ValueError(
                f"SIC variable {name!r} reduced to shape {data.shape}; expected "
                "2-D (y, x) or 3-D (time, y, x) after time selection."
            )
        # Still 3-D: a dimension other than time survived.  Take index 0 only
        # when it is genuinely size 1; otherwise the axis order is unknown and
        # guessing would silently transpose the field.
        extra = [d for d in range(data.ndim) if data.shape[d] != 1]
        if len(extra) != 2:
            raise ValueError(
                f"SIC variable {name!r} has shape {data.shape}, which still "
                f"has {len(extra)} non-singleton axes after time selection. "
                "The adapter will not guess which axis is y and which is x, "
                "because that would silently transpose the field."
            )
        return data.reshape(-1, data.shape[extra[0]], data.shape[extra[1]])[0]

    def _sanitize(self, mapped: np.ndarray) -> np.ndarray:
        """
        Apply the coverage policy to a field already mapped onto the grid.

        * A target cell with no source cell is already NaN (set by
          :meth:`_map_to_grid`) and is left as NaN.
        * A source NaN arrives here as NaN, because the nearest-neighbour
          gather copies the source value verbatim.  NaN is therefore preserved.
        * Values outside the documented SIC range are invalid and become NaN
          (never 0).  NSIDC's ``-1`` all-ice sentinel is a real, fully
          consolidated value and is mapped onto 0.0.
        """
        out = np.asarray(mapped, dtype=np.float64).copy()
        finite = np.isfinite(out)
        out[finite & ~((out >= -1.0) & (out <= 1.0))] = np.nan
        out[out == -1.0] = 0.0
        return out

    # -- coordinate-based mapping ---------------------------------------

    def _map_to_grid(
        self, data_2d: np.ndarray, grid: EnvironmentalGrid,
    ) -> np.ndarray:
        """
        Place a source 2-D field onto the target grid by coordinate.

        The target grid is transformed into the source CRS and gathered with a
        nearest-neighbour lookup over the source's own x/y (or lat/lon) axes.
        Target cells beyond the source's native bounding box stay NaN: there
        is no measurement there, and borrowing the nearest cell from further
        away would be extrapolation.
        """
        if data_2d.shape != self._expected_source_shape():
            raise ValueError(
                f"SIC field shape {data_2d.shape} does not match the source "
                f"grid {self._expected_source_shape()} derived from the file's "
                f"own {self.x_dim}/{self.y_dim} (or lat/lon) axes. The adapter "
                "will not resize the array to force a match, because equal "
                "shapes do not imply equal geography."
            )
        if self._mode == "projected":
            return self._map_projected(data_2d, grid)
        return self._map_geographic(data_2d, grid)

    def _expected_source_shape(self) -> tuple:
        if self._mode == "projected":
            return (int(self._src_y.size), int(self._src_x.size))
        return (int(self._src_lats.size), int(self._src_lons.size))

    def _map_projected(
        self, data_2d: np.ndarray, grid: EnvironmentalGrid,
    ) -> np.ndarray:
        """Nearest-neighbour gather in the source's projected x/y space."""
        tr = Transformer.from_crs("EPSG:4326", self.crs, always_xy=True)
        lon_mesh, lat_mesh = np.meshgrid(grid.lon, grid.lat)
        x_t, y_t = tr.transform(lon_mesh, lat_mesh)
        x_t = np.asarray(x_t, dtype=np.float64)
        y_t = np.asarray(y_t, dtype=np.float64)

        inside = (
            (x_t >= self._src_x.min()) & (x_t <= self._src_x.max())
            & (y_t >= self._src_y.min()) & (y_t <= self._src_y.max())
        )
        inside &= np.isfinite(x_t) & np.isfinite(y_t)

        row = _nearest_axis(self._src_y, y_t, inside)
        col = _nearest_axis(self._src_x, x_t, inside)
        return _gather(data_2d, row, col, inside)

    def _map_geographic(
        self, data_2d: np.ndarray, grid: EnvironmentalGrid,
    ) -> np.ndarray:
        """Nearest-neighbour gather on 1-D lat/lon source axes."""
        lats = np.asarray(self._src_lats, dtype=np.float64)
        lons = np.asarray(self._src_lons, dtype=np.float64)
        lon_mesh, lat_mesh = np.meshgrid(grid.lon, grid.lat)

        inside = (
            (lat_mesh >= lats.min()) & (lat_mesh <= lats.max())
            & (lon_mesh >= lons.min()) & (lon_mesh <= lons.max())
        )
        row = _nearest_axis(lats, lat_mesh, inside)
        col = _nearest_axis(lons, lon_mesh, inside)
        return _gather(data_2d, row, col, inside)


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
        speed = sqrt(uo^2 + vo^2)

        .. warning::
           This is a *diagnostic speed magnitude*, not a validated adverse-
           current penalty.  It is produced by the single isolated function
           :func:`src.data.cmems_loader.current_speed_from_uv` so that the
           physically correct penalty (which depends on the heading of each
           edge relative to the current vector, not on speed alone) can be
           substituted in one place.  See the deprecation note there.

    NaN handling:
        NaN in uo or vo is PRESERVED, never zero-filled.  A cell where either
        component is missing has no known current, so the layer stays NaN
        there and the cost map omits the current term for it and counts how
        many cells were omitted.  ``np.nan_to_num(..., nan=0.0)`` is never
        applied: it would report a genuinely unknown current as a measured
        calm cell.

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

        # Read values.  NaN is preserved: a cell with no current measurement
        # must not be reported as zero current.
        uo = da_uo_t.values.astype(np.float64)
        vo = da_vo_t.values.astype(np.float64)

        # Diagnostic speed magnitude, via the single isolated conversion.
        # If either component is NaN the magnitude is NaN, so a partially
        # known current never becomes a fabricated one.
        speed = current_speed_from_uv(uo, vo)

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

        # Diagnostic speed magnitude via the single isolated conversion.
        # NaN in either component propagates: a cell with no known current
        # stays NaN rather than being reported as a measured calm cell.
        current_cost = current_speed_from_uv(uo, vo)

        if current_cost.shape != (grid.n_rows, grid.n_cols):
            current_cost = self._align_to_grid(
                current_cost, grid, cmems_lat, cmems_lon
            )
            uo = self._align_to_grid(uo, grid, cmems_lat, cmems_lon)
            vo = self._align_to_grid(vo, grid, cmems_lat, cmems_lon)

        self._cache[cache_key] = (current_cost.copy(), uo.copy(), vo.copy())
        grid.current_cost = current_cost
        grid.current_uo = uo
        grid.current_vo = vo
        status = (grid.layer_status or {})
        prov = (grid.layer_provenance or {})
        n_finite = int(np.isfinite(current_cost).sum())
        status["current_uo"] = "REAL" if n_finite else "NOT_AVAILABLE"
        status["current_vo"] = status["current_uo"]
        prov["current_uo"] = {
            "source": str(loader.resolve_path(t_hours)),
            "note": ("uo/vo preserved as vectors; current_cost is a diagnostic "
                     "speed magnitude, not a validated adverse-current penalty"),
            "finite_cells": n_finite,
            "n_cells": int(current_cost.size),
        }
        grid.layer_status = status
        grid.layer_provenance = prov
        return grid

    def _align_to_grid(
        self, data: np.ndarray, grid: EnvironmentalGrid,
        lats_src: np.ndarray = None, lons_src: np.ndarray = None,
    ) -> np.ndarray:
        """
        Nearest-neighbour resampling onto the route grid by coordinate.

        Works for an ascending OR descending source latitude, which is what
        real CMEMS files ship (``latitude`` runs -80 -> -50).  Target cells
        outside the source extent become NaN, never a boundary value and never
        zero.
        """
        if lats_src is None or lons_src is None:
            raise ValueError(
                "cannot align this layer to the route grid: the source "
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

        lon_mesh, lat_mesh = np.meshgrid(grid.lon, grid.lat)
        inside = (
            (lat_mesh >= lats_src.min()) & (lat_mesh <= lats_src.max())
            & (lon_mesh >= lons_src.min()) & (lon_mesh <= lons_src.max())
        )
        row = _nearest_axis(lats_src, lat_mesh, inside)
        col = _nearest_axis(lons_src, lon_mesh, inside)
        return _gather(data, row, col, inside)


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

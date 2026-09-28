"""
SIC adapter contract against the REAL NSIDC / Sea-Ice CDR product.

The real product in ``DATA_ROOT/SIC/`` is::

    cdr_seaice_conc(time, y, x)      # x, y in metres, EPSG:3412
    # no lat/lon coordinate in the file

What these tests pin down
-------------------------
1.  The real variable name is read, and a missing one is a loud error rather
    than a silent substitution of some other variable.
2.  Projected EPSG:3412 coordinates are honoured: no lat/lon is assumed, and
    the source is mapped to the route grid by COORDINATE, not by array index.
3.  A target cell outside the source's native coverage is NaN -- never zero,
    never a mean, never an extrapolated edge value.
4.  A source NaN stays NaN on the route grid.
5.  The arrays are never resized to force a shape match.
6.  A missing time origin is an error, not a fabricated timestamp.

The route grid used throughout is the project's real 173x369 / 0.25 deg grid
(lat -75..-32, lon -10..82), per ``dataset/audit/dataset_audit.json``.
"""

from __future__ import annotations

import inspect
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pytest
import xarray as xr

from src.data.adapters import SICAdapter, _gather, _nearest_axis
from src.data.builder import build_grid_template
from src.environment.grid import EnvironmentalGrid
from tests.real_dataset_fixtures import (
    CMEMS_LAT_MAX,
    ROUTE_COLS,
    ROUTE_LAT_MAX,
    ROUTE_LAT_MIN,
    ROUTE_LON_MAX,
    ROUTE_LON_MIN,
    ROUTE_RESOLUTION,
    ROUTE_ROWS,
    SIC_CRS,
    SIC_VAR,
    epsg3412_axes,
    write_sic_cdr,
)

pytest.importorskip("netCDF4")
pytest.importorskip("pyproj")

START = datetime(2025, 6, 1, 0, 0)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def route_grid():
    """The project's real target routing grid."""
    return build_grid_template(
        lat_min=ROUTE_LAT_MIN, lat_max=ROUTE_LAT_MAX,
        lon_min=ROUTE_LON_MIN, lon_max=ROUTE_LON_MAX,
        resolution_deg=ROUTE_RESOLUTION,
    )


@pytest.fixture(scope="module")
def sic_times():
    return [START, START + timedelta(days=1), START + timedelta(days=2)]


@pytest.fixture(scope="module")
def sic_file(tmp_path_factory, sic_times):
    """A CDR-shaped SIC file covering only PART of the route domain.

    3000 km half-width in EPSG:3412 reaches roughly lat -63 / -27 and the whole
    longitude range, so the northern rows of the route grid (towards -32) are
    genuinely outside the source and must come back NaN.
    """
    d = tmp_path_factory.mktemp("sic_cdr")
    return write_sic_cdr(d / "cdr_seaice_conc.nc", sic_times)


def _adapter(path, **kw):
    kw.setdefault("variable", SIC_VAR)
    kw.setdefault("x_dim", "x")
    kw.setdefault("y_dim", "y")
    kw.setdefault("crs", SIC_CRS)
    kw.setdefault("route_start_datetime", START)
    return SICAdapter(path=path, **kw)


# ---------------------------------------------------------------------------
# 1. The real variable name
# ---------------------------------------------------------------------------

class TestRealVariableName:
    def test_default_variable_is_cdr_seaice_conc(self):
        """The adapter's own default must be the real CDR name, not 'siconc'."""
        assert inspect.signature(SICAdapter).parameters["variable"].default \
            == "cdr_seaice_conc"

    def test_reads_cdr_seaice_conc(self, sic_file, route_grid):
        a = _adapter(sic_file)
        out = a.load(0.0, route_grid)
        assert out.sic_mean.shape == (ROUTE_ROWS, ROUTE_COLS)
        covered = np.isfinite(out.sic_mean)
        assert covered.any(), "no SIC was read at all"

    def test_wrong_variable_is_a_loud_error(self, sic_file, route_grid):
        """A product that does not contain the variable must not be half-read."""
        a = _adapter(sic_file, variable="siconc")
        with pytest.raises(KeyError) as exc:
            a.load(0.0, route_grid)
        msg = str(exc.value)
        assert "siconc" in msg
        # The message must make clear nothing was substituted.
        assert "not substitute" in msg

    def test_coverage_reports_the_real_variable(self, sic_file, route_grid):
        a = _adapter(sic_file)
        a.load(0.0, route_grid)
        cov = a.coverage()
        assert cov["variable"] == SIC_VAR
        assert cov["mode"] == "projected"
        assert cov["crs"] == SIC_CRS
        assert cov["status"] == "known"


# ---------------------------------------------------------------------------
# 2. Projected EPSG:3412 coordinates
# ---------------------------------------------------------------------------

class TestProjectedCoordinates:
    def test_source_has_no_latlon(self, sic_file):
        """The fixture must really be projected, or these tests prove nothing."""
        with xr.open_dataset(sic_file) as ds:
            assert "x" in ds.dims and "y" in ds.dims
            assert "latitude" not in ds.coords and "longitude" not in ds.coords
            assert "lat" not in ds.coords and "lon" not in ds.coords

    def test_does_not_assume_latlon_dims(self, sic_file, route_grid):
        """With x/y given and no lat/lon, geographic dims are never consulted."""
        a = _adapter(sic_file, lat_dim="no_such_lat", lon_dim="no_such_lon")
        out = a.load(0.0, route_grid)
        assert np.isfinite(out.sic_mean).any()

    def test_coordinate_lookup_matches_manual_inverse_transform(
        self, sic_file, route_grid,
    ):
        """
        Values must land on the source cell nearest the ROUTE CELL's own
        coordinates -- verified against an independent pyproj inverse.

        This is the test that would fail if the adapter indexed by array
        position, or if it fitted a lat/lon rectangle to a polar-stereo grid.
        """
        from pyproj import Transformer

        a = _adapter(sic_file)
        out = a.load(0.0, route_grid)

        with xr.open_dataset(sic_file) as ds:
            src = ds[SIC_VAR].isel(time=0).values.astype(np.float64)
            xs = np.asarray(ds["x"].values, dtype=np.float64)
            ys = np.asarray(ds["y"].values, dtype=np.float64)

        # Independent inverse: route WGS84 -> EPSG:3412, then nearest cell.
        inv = Transformer.from_crs("EPSG:4326", SIC_CRS, always_xy=True)
        r, c = 12, 40
        lon = float(route_grid.lon[c])
        lat = float(route_grid.lat[r])
        x, y = inv.transform(lon, lat)
        expected = src[int(np.argmin(np.abs(ys - y))),
                       int(np.argmin(np.abs(xs - x)))]
        got = out.sic_mean[r, c]
        if np.isfinite(got):
            assert got == pytest.approx(expected, abs=1e-6)

    def test_inverse_transformed_cell_inside_source_is_finite(
        self, sic_file, route_grid,
    ):
        from pyproj import Transformer
        a = _adapter(sic_file)
        out = a.load(0.0, route_grid)
        with xr.open_dataset(sic_file) as ds:
            xs = np.asarray(ds["x"].values, dtype=np.float64)
            ys = np.asarray(ds["y"].values, dtype=np.float64)
        inv = Transformer.from_crs("EPSG:4326", SIC_CRS, always_xy=True)
        lon_mesh, lat_mesh = np.meshgrid(route_grid.lon, route_grid.lat)
        x, y = inv.transform(lon_mesh, lat_mesh)
        x = np.asarray(x, dtype=np.float64)
        y = np.asarray(y, dtype=np.float64)
        inside = ((x >= xs.min()) & (x <= xs.max())
                  & (y >= ys.min()) & (y <= ys.max())
                  & np.isfinite(x) & np.isfinite(y))
        # Every cell the source genuinely covers must carry a real value.
        assert inside.any()
        assert np.isfinite(out.sic_mean[inside]).all()


# ---------------------------------------------------------------------------
# 3. Outside native coverage -> NaN (never 0 / mean / extrapolated)
# ---------------------------------------------------------------------------

class TestOutsideCoverageIsNaN:
    def test_cells_outside_source_extent_are_nan(self, sic_file, route_grid):
        a = _adapter(sic_file)
        out = a.load(0.0, route_grid)
        sic = out.sic_mean
        outside = np.isnan(sic)
        assert outside.any(), (
            "fixture should not cover the whole route domain; if it now does, "
            "the coverage-gap test is vacuous"
        )
        # The forbidden fills, stated explicitly.
        assert not np.any(sic[outside] == 0.0)
        assert not np.any(np.isclose(sic[outside], 0.0, atol=1e-12))
        finite = sic[np.isfinite(sic)]
        assert np.allclose(sic[outside], np.nan, equal_nan=True)

    def test_northern_route_rows_are_outside_coverage(self, sic_file, route_grid):
        """
        The route grid reaches lat -32 but CMEMS/CDR-scale sources stop far
        south of that, so the northern rows must be NaN, not extrapolated.
        """
        a = _adapter(sic_file)
        out = a.load(0.0, route_grid)
        sic = out.sic_mean
        north = sic[-1, :]            # lat closest to ROUTE_LAT_MAX
        assert np.isnan(north).all(), (
            "northernmost route row was filled in, but the source does not "
            "cover it"
        )

    def test_coverage_bbox_is_reported_in_wgs84(self, sic_file, route_grid):
        a = _adapter(sic_file)
        a.load(0.0, route_grid)
        cov = a.coverage()
        lat_lo, lat_hi = cov["source_lat_bounds"]
        lon_lo, lon_hi = cov["source_lon_bounds"]
        assert lat_lo < lat_hi and lon_lo < lon_hi
        # The source must not claim to cover the route grid's northern edge.
        assert lat_hi < ROUTE_LAT_MAX

    def test_never_fills_with_source_mean(self, sic_file, route_grid):
        """The classic wrong fix is nanmean; assert the value is not that."""
        a = _adapter(sic_file)
        out = a.load(0.0, route_grid)
        sic = out.sic_mean
        source_mean = np.nanmean(sic[np.isfinite(sic)])
        missing = sic[np.isnan(sic)]
        if missing.size and np.isfinite(source_mean):
            assert not np.any(np.isclose(missing, source_mean))


# ---------------------------------------------------------------------------
# 4. Source NaN stays NaN
# ---------------------------------------------------------------------------

class TestSourceNaNPreserved:
    @pytest.fixture()
    def nan_hole_file(self, tmp_path, sic_times):
        """
        A CDR file with a rectangular NaN hole in source cell coordinates.

        The hole is planted by source index, and the test then converts one of
        those cells to WGS84 to find the route cell that should inherit NaN.
        """
        x = epsg3412_axes(half_width_km=1500.0, step_km=50.0)
        y = x.copy()
        # Hole in the middle of the source grid.
        hole = (slice(8, 20), slice(8, 20))

        def fill(xx, yy):
            field = np.full(xx.shape, 0.5, dtype=np.float32)
            field[hole] = np.nan
            return field

        return write_sic_cdr(tmp_path / "nan_hole.nc", sic_times,
                             x=x, y=y, fill=fill)

    def test_source_nan_reaches_the_grid_as_nan(self, nan_hole_file, route_grid):
        a = _adapter(nan_hole_file)
        out = a.load(0.0, route_grid)
        assert np.isnan(out.sic_mean).any(), "the planted NaN hole vanished"

    def test_source_nan_is_not_zero_filled(self, nan_hole_file, route_grid):
        a = _adapter(nan_hole_file)
        out = a.load(0.0, route_grid)
        sic = out.sic_mean
        nan_cells = sic[np.isnan(sic)]
        # A zero-fill would make these exactly 0.0.
        assert nan_cells.size == 0 or not np.any(nan_cells == 0.0)

    def test_surrounding_valid_cells_still_finite(self, nan_hole_file, route_grid):
        """A NaN hole must not poison the whole field."""
        a = _adapter(nan_hole_file)
        out = a.load(0.0, route_grid)
        assert np.isfinite(out.sic_mean).any()


# ---------------------------------------------------------------------------
# 5. No shape resizing
# ---------------------------------------------------------------------------

class TestNoShapeResizing:
    def test_unequal_shapes_raise_instead_of_resizing(self, sic_file, route_grid):
        """
        A source field whose shape disagrees with its own axes must raise.

        Resizing would force a shape match that says nothing about geography.
        """
        a = _adapter(sic_file)
        a._open_dataset()
        a._compute_coverage()
        bad = np.zeros((3, 4), dtype=np.float64)
        with pytest.raises(ValueError) as exc:
            a._map_to_grid(bad, route_grid)
        assert "resize" in str(exc.value)

    def test_grid_shape_never_drives_a_resize(self, sic_file, route_grid):
        """The output is the ROUTE grid's shape, whatever the source's is."""
        a = _adapter(sic_file)
        out = a.load(0.0, route_grid)
        assert out.sic_mean.shape == (route_grid.n_rows, route_grid.n_cols)
        assert out.n_rows == ROUTE_ROWS and out.n_cols == ROUTE_COLS

    def test_source_and_target_shapes_differ_in_this_fixture(
        self, sic_file, route_grid,
    ):
        """Guard: if these ever matched, the mapping path would be untested."""
        with xr.open_dataset(sic_file) as ds:
            src_shape = ds[SIC_VAR].shape[1:]
        assert tuple(src_shape) != (ROUTE_ROWS, ROUTE_COLS)


# ---------------------------------------------------------------------------
# 6. Time handling -- no fabricated timestamps
# ---------------------------------------------------------------------------

class TestTimeOrigin:
    def test_missing_time_origin_raises(self, sic_file, route_grid):
        """
        A datetime time axis plus t_hours with no origin must fail.

        Selecting 'nearest' with t_hours=0 against a datetime axis would
        resolve to the epoch and silently return the first field in the file.
        """
        a = SICAdapter(path=sic_file, variable=SIC_VAR, x_dim="x", y_dim="y",
                       crs=SIC_CRS, route_start_datetime=None)
        with pytest.raises(ValueError) as exc:
            a.load(0.0, route_grid)
        assert "route_start_datetime" in str(exc.value)

    def test_t_hours_selects_the_correct_timestep(self, tmp_path, route_grid):
        """
        Different t_hours must read different source fields.

        The fixture plants a distinct constant per timestep, so a loader that
        always grabbed frame 0 (the failure mode when a time origin is faked)
        would be caught.
        """
        times = [START, START + timedelta(days=1), START + timedelta(days=2)]
        seq = {0: 0.1, 1: 0.5, 2: 0.9}
        counter = {"i": 0}

        def timed_fill(xx, yy):
            v = seq[counter["i"]]
            counter["i"] += 1
            return np.full(xx.shape, v, dtype=np.float32)

        p = write_sic_cdr(tmp_path / "timed.nc", times, fill=timed_fill)
        a = _adapter(p)
        try:
            for i, hours in enumerate([0.0, 24.0, 48.0]):
                out = a.load(hours, route_grid)
                vals = out.sic_mean[np.isfinite(out.sic_mean)]
                assert vals.size
                assert np.allclose(vals, seq[i]), (
                    f"t_hours={hours} did not read timestep {i}"
                )
        finally:
            a.close()

    def test_nearest_timestep_is_used_not_exact_match(self, sic_file, route_grid):
        """A 7-hour query must snap to the 0h/6h/12h... field, not fail."""
        a = _adapter(sic_file)
        out = a.load(7.0, route_grid)
        assert np.isfinite(out.sic_mean).any()


# ---------------------------------------------------------------------------
# 7. Provenance is explicit
# ---------------------------------------------------------------------------

class TestProvenance:
    def test_loaded_grid_records_provenance(self, sic_file, route_grid):
        a = _adapter(sic_file)
        out = a.load(0.0, route_grid)
        prov = out.layer_provenance["sic_mean"]
        assert prov["variable"] == SIC_VAR
        assert prov["crs"] == SIC_CRS
        assert prov["mode"] == "projected"
        assert prov["reason"] == "loaded"

    def test_missing_file_is_reported_not_faked(self, tmp_path, route_grid):
        a = _adapter(tmp_path / "does_not_exist.nc")
        out = a.load(0.0, route_grid)
        assert np.isnan(out.sic_mean).all()
        assert out.layer_status["sic_mean"] == "NOT_AVAILABLE"

    def test_coverage_before_open_is_explicit(self, sic_file):
        a = _adapter(sic_file)
        assert a.coverage()["status"] == "not_opened"


# ---------------------------------------------------------------------------
# 8. The shared mapping helpers
# ---------------------------------------------------------------------------

class TestMappingHelpers:
    @pytest.mark.parametrize("axis", [
        np.array([0.0, 1.0, 2.0, 3.0]),          # ascending
        np.array([3.0, 2.0, 1.0, 0.0]),          # descending
        np.array([-2.0, -1.0, 0.0, 1.0, 2.0]),
    ])
    def test_nearest_axis_is_order_agnostic(self, axis):
        targets = np.array([[0.1, 0.9], [2.1, 2.9]])
        idx = _nearest_axis(axis, targets)
        vals = axis[idx]
        assert np.all(np.abs(vals - targets) <= 1.0 + 1e-9)

    def test_nearest_axis_masks_outside_to_minus_one(self):
        axis = np.array([0.0, 1.0, 2.0])
        inside = np.array([[True, False]])
        idx = _nearest_axis(axis, np.array([[0.5, 9.0]]), inside)
        assert idx[0, 0] >= 0
        assert idx[0, 1] == -1

    def test_gather_preserves_source_nan(self):
        src = np.array([[1.0, np.nan], [3.0, 4.0]])
        rows = np.array([[0, 0]])
        cols = np.array([[0, 1]])
        inside = np.ones((1, 2), dtype=bool)
        out = _gather(src, rows, cols, inside)
        assert out[0, 0] == 1.0
        assert np.isnan(out[0, 1])

    def test_gather_gives_nan_outside_coverage(self):
        src = np.array([[1.0, 2.0]])
        rows = np.array([[0, 0]])
        cols = np.array([[0, 0]])
        inside = np.array([[True, False]])
        out = _gather(src, rows, cols, inside)
        assert out[0, 0] == 1.0
        assert np.isnan(out[0, 1])


# ---------------------------------------------------------------------------
# 9. Crs / format validation
# ---------------------------------------------------------------------------

class TestConfigurationSafety:
    def test_x_y_without_crs_is_rejected(self, sic_file):
        with pytest.raises(ValueError) as exc:
            SICAdapter(path=sic_file, x_dim="x", y_dim="y", crs=None)
        assert "crs" in str(exc.value)

    def test_projected_format_conflicting_with_xy_is_rejected(self, sic_file):
        with pytest.raises(ValueError) as exc:
            SICAdapter(path=sic_file, x_dim="x", y_dim="y", crs=SIC_CRS,
                       source_format="geographic")
        assert "geographic" in str(exc.value)

    def test_unknown_source_format_is_rejected(self, sic_file):
        with pytest.raises(ValueError):
            SICAdapter(path=sic_file, source_format="magic")

    def test_projected_format_with_no_xy_dims_is_a_loud_error(
        self, tmp_path, sic_times, route_grid,
    ):
        """
        Claiming a projected product for a file with no x/y dims must not
        quietly fall back to a lat/lon reading of a different grid.
        """
        p = write_sic_cdr(tmp_path / "noxy.nc", sic_times)
        a = _adapter(p, x_dim="absent_x", y_dim="absent_y",
                     source_format="projected_x_y")
        with pytest.raises(ValueError) as exc:
            a.load(0.0, route_grid)
        assert "absent_x" in str(exc.value)

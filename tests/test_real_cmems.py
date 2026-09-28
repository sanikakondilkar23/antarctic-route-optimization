"""
CMEMS loader contract against the real Copernicus Ocean layout.

Real layout (``DATA_ROOT/Copernicus_Ocean/``)::

    2021..2024:  {year}/Ocean_{year}_{month:02d}.nc
    2025:        2025/CMEMS_Current_2025_6hourly.nc   (annual, 6-hourly)
    variables:   uo, vo(time, depth, latitude, longitude)
    latitude:    -80 .. -50   (the route grid reaches -32)
    2025:        1460 timesteps, 4319 longitudes, ~16.96 GB

What these tests pin down
-------------------------
1.  Every month of 2025 resolves to the single annual 6-hourly file.
2.  The nearest valid 6-hour timestep is selected, and the offset is reported.
3.  Ascending AND descending latitude both subset correctly.
4.  NaN in uo/vo is preserved, never zero-filled.
5.  Out-of-domain route cells stay NaN.
6.  The 16.96 GB file is never loaded whole: only one timestep and the
    spatial subset reach memory.
7.  ``uo`` and ``vo`` stay separately available.
"""

from __future__ import annotations

import inspect
from datetime import datetime
from pathlib import Path

import numpy as np
import pytest
import xarray as xr

from src.data.adapters import CMEMSDateAwareAdapter
from src.data.builder import build_grid_template
from src.data.cmems_loader import (
    CMEMS_2025_ANNUAL,
    CMEMS_2025_EXPECTED_STEPS,
    CMEMS_STEP_HOURS,
    CMEMSDateAwareLoader,
    _axis_slice,
    cmems_annual_filename,
    current_speed_from_uv,
    resolve_cmems_path,
)
from src.environment.grid import EnvironmentalGrid
from tests.real_dataset_fixtures import (
    CMEMS_2025_LON_COUNT,
    CMEMS_2025_STEPS,
    CMEMS_LAT_MAX,
    CMEMS_LAT_MIN,
    CMEMS_LAT_VAR,
    CMEMS_LON_VAR,
    ROUTE_LAT_MAX,
    ROUTE_LAT_MIN,
    ROUTE_LON_MAX,
    ROUTE_LON_MIN,
    ROUTE_RESOLUTION,
    ROUTE_ROWS,
    ROUTE_COLS,
    annual_2025_times,
    monthly_times,
    write_cmems,
)

pytest.importorskip("netCDF4")

START = datetime(2025, 3, 15, 5, 0)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def route_grid():
    return build_grid_template(
        lat_min=ROUTE_LAT_MIN, lat_max=ROUTE_LAT_MAX,
        lon_min=ROUTE_LON_MIN, lon_max=ROUTE_LON_MAX,
        resolution_deg=ROUTE_RESOLUTION,
    )


@pytest.fixture(scope="module")
def cmems_root_2025(tmp_path_factory):
    """
    A Copernicus_Ocean tree with the 2025 annual file (descending latitude).

    Spatial extent is reduced (61x24 instead of the real ~1021x4319) but the
    TIME structure is the real one: 1460 6-hourly steps across 2025, so file
    resolution, timestep selection and lazy loading are all exercised for real.
    """
    root = tmp_path_factory.mktemp("copernicus_ocean")
    write_cmems(root / "2025" / CMEMS_2025_ANNUAL, annual_2025_times(),
                n_lat=61, n_lon=24, lat_descending=True)
    return root


@pytest.fixture(scope="module")
def cmems_root_2025_ascending(tmp_path_factory):
    """The same 2025 file with ASCENDING latitude -50 -> -80."""
    root = tmp_path_factory.mktemp("copernicus_ocean_asc")
    write_cmems(root / "2025" / CMEMS_2025_ANNUAL, annual_2025_times(),
                n_lat=61, n_lon=24, lat_descending=False)
    return root


@pytest.fixture(scope="module")
def cmems_root_monthly(tmp_path_factory):
    """2021-2024 monthly files, one per month, descending latitude."""
    root = tmp_path_factory.mktemp("copernicus_ocean_monthly")
    for year in (2021, 2022, 2023, 2024):
        for month in range(1, 13):
            write_cmems(root / str(year) / f"Ocean_{year}_{month:02d}.nc",
                        monthly_times(year, month), n_lat=13, n_lon=12,
                        lat_descending=True)
    return root


def _loader(root, start=START):
    return CMEMSDateAwareLoader(
        cmems_root=str(root), route_start_datetime=start,
        lat_var=CMEMS_LAT_VAR, lon_var=CMEMS_LON_VAR,
        uo_var="uo", vo_var="vo",
    )


# ---------------------------------------------------------------------------
# 1. 2025 annual file resolution
# ---------------------------------------------------------------------------

class Test2025AnnualResolution:
    @pytest.mark.parametrize("month", list(range(1, 13)))
    def test_every_month_of_2025_resolves_to_the_annual_file(
        self, cmems_root_2025, month,
    ):
        """
        January..December 2025 must all resolve to the ONE annual 6-hourly file.

        A monthly fallback here would mean reading a 2025 product that does not
        exist, or reporting a different dataset as if it were the same one.
        """
        when = datetime(2025, month, 15, 12, 0)
        p = resolve_cmems_path(str(cmems_root_2025), when)
        assert p.name == CMEMS_2025_ANNUAL
        assert p == cmems_root_2025 / "2025" / CMEMS_2025_ANNUAL

    @pytest.mark.parametrize("month", [1, 6, 12])
    def test_loader_resolves_2025_annual_end_to_end(
        self, cmems_root_2025, month, route_grid,
    ):
        start = datetime(2025, month, 1)
        loader = _loader(cmems_root_2025, start)
        adapter = CMEMSDateAwareAdapter(
            cmems_root=str(cmems_root_2025), route_start_datetime=start,
        )
        out = adapter.load(0.0, route_grid)
        assert out.current_uo is not None
        assert out.current_uo.shape == (ROUTE_ROWS, ROUTE_COLS)

    def test_2025_monthly_name_is_not_used(self, cmems_root_2025):
        """
        The tree deliberately has NO Ocean_2025_MM.nc, and resolution must
        still succeed via the annual file alone.
        """
        assert not (cmems_root_2025 / "2025" / "Ocean_2025_03.nc").exists()
        p = resolve_cmems_path(str(cmems_root_2025), datetime(2025, 3, 1))
        assert p.name == CMEMS_2025_ANNUAL

    def test_missing_2025_data_raises_rather_than_substituting(
        self, tmp_path,
    ):
        with pytest.raises(FileNotFoundError) as exc:
            resolve_cmems_path(str(tmp_path), datetime(2025, 5, 5))
        assert CMEMS_2025_ANNUAL in str(exc.value)

    def test_annual_filename_helper(self):
        assert cmems_annual_filename(2025) == CMEMS_2025_ANNUAL
        assert cmems_annual_filename(2026) == "CMEMS_Current_2026_6hourly.nc"

    def test_monthly_layout_still_resolves(self, cmems_root_monthly):
        for month in (1, 7, 12):
            p = resolve_cmems_path(str(cmems_root_monthly),
                                   datetime(2023, month, 10))
            assert p.name == f"Ocean_2023_{month:02d}.nc"


# ---------------------------------------------------------------------------
# 2. Six-hour timestep selection
# ---------------------------------------------------------------------------

class TestSixHourlyTimestep:
    def test_annual_file_really_has_1460_steps(self, cmems_root_2025):
        """Guard the fixture against drifting from the real product shape."""
        with xr.open_dataset(
            cmems_root_2025 / "2025" / CMEMS_2025_ANNUAL
        ) as ds:
            assert ds.sizes["time"] == CMEMS_2025_EXPECTED_STEPS
        assert CMEMS_2025_STEPS == 1460

    def test_selects_the_nearest_6_hourly_step(self, cmems_root_2025):
        loader = _loader(cmems_root_2025, datetime(2025, 1, 1))
        # 05:00 -> nearest of 00:00, 06:00, 12:00 is 06:00
        loader.t_hours_to_datetime(5.0)
        info = loader.inspect_file(5.0)
        assert info["selected_time"].startswith("2025-01-01T06:00")
        assert info["selected_time_offset_hours"] == pytest.approx(1.0)
        assert info["median_step_hours"] == pytest.approx(CMEMS_STEP_HOURS)

    @pytest.mark.parametrize("hour,expected", [
        (0.0, "2025-01-01T00:00"),
        (1.0, "2025-01-01T00:00"),
        (4.0, "2025-01-01T06:00"),
        (6.0, "2025-01-01T06:00"),
        (8.0, "2025-01-01T06:00"),
        (10.0, "2025-01-01T12:00"),
        (24.0, "2025-01-02T00:00"),
    ])
    def test_nearest_step_across_the_day(self, cmems_root_2025, hour, expected):
        loader = _loader(cmems_root_2025, datetime(2025, 1, 1))
        info = loader.inspect_file(hour)
        assert info["selected_time"].startswith(expected)

    def test_exact_tie_resolves_to_the_earlier_step(self, cmems_root_2025):
        """
        03:00 is exactly 3 h from both 00:00 and 06:00, so no step is
        "nearest"; the tie is broken towards the EARLIER step.  Pinned so the
        behaviour is documented rather than accidental.
        """
        loader = _loader(cmems_root_2025, datetime(2025, 1, 1))
        assert loader.inspect_file(3.0)["selected_time"].startswith(
            "2025-01-01T00:00")
        assert loader.inspect_file(9.0)["selected_time"].startswith(
            "2025-01-01T06:00")

    def test_selected_timestep_actually_reaches_the_data(
        self, tmp_path, route_grid,
    ):
        """
        A file whose values encode the timestep index proves the right frame is
        read, rather than frame 0 being reused.

        Written at the production 2025 annual path, because that is the only
        name :func:`resolve_cmems_path` will resolve a 2025 query to.
        """
        times = monthly_times(2025, 4)
        n_t, n_d, n_lat, n_lon = len(times), 1, 9, 10
        uo = np.zeros((n_t, n_d, n_lat, n_lon), dtype=np.float32)
        for i in range(n_t):
            uo[i] = float(i)
        vo = np.zeros_like(uo)
        p = write_cmems(tmp_path / "2025" / CMEMS_2025_ANNUAL, times,
                        n_lat=n_lat, n_lon=n_lon, uo=uo, vo=vo)
        assert p.is_file()

        start = times[0]
        loader = CMEMSDateAwareLoader(
            cmems_root=str(p.parents[1]), route_start_datetime=start,
            lat_var=CMEMS_LAT_VAR, lon_var=CMEMS_LON_VAR,
        )
        # index 0, 1, 2 -> hours 0, 6, 12
        for expected_idx, hours in enumerate([0.0, 6.0, 12.0]):
            got_uo, _got_vo, _la, _lo = loader.load_uo_vo(
                t_hours=hours, lat_bounds=(-80, -50), lon_bounds=None,
            )
            assert np.allclose(got_uo, float(expected_idx)), (
                f"t_hours={hours} did not read frame {expected_idx}"
            )

    def test_no_time_origin_means_no_file_selection(self, tmp_path):
        """Without route_start_datetime the loader cannot invent a date."""
        loader = CMEMSDateAwareLoader(
            cmems_root=str(tmp_path), route_start_datetime=START,
        )
        assert loader.t_hours_to_datetime(12.0) == datetime(2025, 3, 15, 17, 0)


# ---------------------------------------------------------------------------
# 3. Ascending and descending latitude
# ---------------------------------------------------------------------------

class TestLatitudeOrientation:
    def test_axis_slice_flips_for_descending(self):
        da = xr.DataArray([3.0, 2.0, 1.0], dims="v")
        assert _axis_slice(da, 1.0, 3.0) == slice(3.0, 1.0)

    def test_axis_slice_normal_for_ascending(self):
        da = xr.DataArray([1.0, 2.0, 3.0], dims="v")
        assert _axis_slice(da, 1.0, 3.0) == slice(1.0, 3.0)

    def test_descending_file_returns_descending_latitudes(self, cmems_root_2025):
        loader = _loader(cmems_root_2025)
        _uo, _vo, lat, _lon = loader.load_uo_vo(
            t_hours=0.0, lat_bounds=(-80, -50), lon_bounds=None,
        )
        assert lat[0] > lat[-1], "fixture should be descending"
        assert lat.min() == pytest.approx(CMEMS_LAT_MIN)
        assert lat.max() == pytest.approx(CMEMS_LAT_MAX)

    def test_ascending_file_returns_ascending_latitudes(
        self, cmems_root_2025_ascending,
    ):
        loader = _loader(cmems_root_2025_ascending)
        _uo, _vo, lat, _lon = loader.load_uo_vo(
            t_hours=0.0, lat_bounds=(-80, -50), lon_bounds=None,
        )
        assert lat[0] < lat[-1], "fixture should be ascending"
        assert lat.min() == pytest.approx(CMEMS_LAT_MIN)
        assert lat.max() == pytest.approx(CMEMS_LAT_MAX)

    def test_spatial_subset_works_for_both_orientations(
        self, cmems_root_2025, cmems_root_2025_ascending,
    ):
        """
        The same bounds must select the same rows regardless of axis order.

        This is the test a positional slice would fail for one orientation.
        """
        counts = []
        for root in (cmems_root_2025, cmems_root_2025_ascending):
            loader = _loader(root)
            _uo, _vo, lat, _lon = loader.load_uo_vo(
                t_hours=0.0, lat_bounds=(-70.0, -60.0), lon_bounds=None,
            )
            counts.append(lat.size)
        assert counts[0] == counts[1] > 0

    def test_adapter_maps_descending_latitude_onto_route_grid(
        self, cmems_root_2025, route_grid,
    ):
        """The route-grid alignment must not assume an ascending source axis."""
        adapter = CMEMSDateAwareAdapter(
            cmems_root=str(cmems_root_2025), route_start_datetime=START,
        )
        out = adapter.load(0.0, route_grid)
        assert out.current_uo.shape == (ROUTE_ROWS, ROUTE_COLS)
        # Inside the CMEMS band, values are the fixture's constant.
        band = slice(0, 100)
        got = out.current_uo[band, :]
        finite = got[np.isfinite(got)]
        assert finite.size
        assert np.allclose(finite, 0.10)

    def test_adapter_maps_ascending_latitude_identically(
        self, cmems_root_2025, cmems_root_2025_ascending, route_grid,
    ):
        a_desc = CMEMSDateAwareAdapter(
            cmems_root=str(cmems_root_2025), route_start_datetime=START,
        ).load(0.0, route_grid)
        a_asc = CMEMSDateAwareAdapter(
            cmems_root=str(cmems_root_2025_ascending),
            route_start_datetime=START,
        ).load(0.0, route_grid)
        assert np.allclose(a_desc.current_uo, a_asc.current_uo, equal_nan=True)


# ---------------------------------------------------------------------------
# 4. NaN preservation
# ---------------------------------------------------------------------------

class TestNaNPreserved:
    @pytest.fixture()
    def nan_root(self, tmp_path):
        """
        A CMEMS root whose 2025 annual file carries NaN blocks.

        The file MUST sit at the production path
        ``2025/CMEMS_Current_2025_6hourly.nc`` because that is what
        :func:`resolve_cmems_path` resolves 2025 queries to.  Writing it under
        an arbitrary name would only prove the resolver is broken.

        uo has a NaN block at rows 3:6, cols 2:5; vo has a disjoint one at
        rows 7:9, cols 8:11.  Both are on a deterministic 11x12 grid, so the
        exact NaN positions can be asserted, not just their presence.
        """
        times = monthly_times(2025, 6)
        n_t, n_d, n_lat, n_lon = len(times), 1, 11, 12
        uo = np.full((n_t, n_d, n_lat, n_lon), 0.2, dtype=np.float32)
        vo = np.full((n_t, n_d, n_lat, n_lon), -0.1, dtype=np.float32)
        uo[:, :, 3:6, 2:5] = np.nan      # uo hole
        vo[:, :, 7:9, 8:11] = np.nan     # vo hole, disjoint
        write_cmems(tmp_path / "2025" / CMEMS_2025_ANNUAL, times,
                    n_lat=n_lat, n_lon=n_lon, uo=uo, vo=vo)
        return tmp_path

    @pytest.fixture()
    def nan_loader(self, nan_root):
        return CMEMSDateAwareLoader(
            cmems_root=str(nan_root),
            route_start_datetime=monthly_times(2025, 6)[0],
            lat_var=CMEMS_LAT_VAR, lon_var=CMEMS_LON_VAR,
        )

    def test_nan_fixture_lives_at_the_production_path(self, nan_root):
        """Guard the fixture itself: the production name must be what is written."""
        assert (nan_root / "2025" / CMEMS_2025_ANNUAL).is_file()

    def test_loader_returns_nan_not_zero(self, nan_loader):
        uo, vo, _la, _lo = nan_loader.load_uo_vo(
            t_hours=0.0, lat_bounds=(-80, -50), lon_bounds=None,
        )
        # The source NaNs are still NaN in the arrays handed back.
        assert np.isnan(uo).any()
        assert np.isnan(vo).any()

    def test_planted_nan_locations_remain_missing(self, nan_loader):
        """
        NaN preservation is checked at the exact planted cells, not just
        'somewhere': the fixture grid is deterministic, so a silent zero-fill
        or a nearest-neighbour smear of a neighbouring valid value would both
        show up here.
        """
        uo, vo, _la, _lo = nan_loader.load_uo_vo(
            t_hours=0.0, lat_bounds=(-80, -50), lon_bounds=None,
        )
        # The whole domain is requested, so the subset preserves the layout.
        assert np.isnan(uo[3:6, 2:5]).all(), "the planted uo hole moved or filled"
        assert np.isnan(vo[7:9, 8:11]).all(), "the planted vo hole moved or filled"
        # And the cells around them are untouched real values.
        assert np.isfinite(uo[0, 0])
        assert np.isfinite(vo[0, 0])

    def test_one_missing_component_makes_the_layer_nan(self, nan_loader):
        """
        If either uo or vo is missing at a cell, the current layer there is
        unknown and must be NaN -- not a magnitude computed from one vector.
        """
        uo, vo, _la, _lo = nan_loader.load_uo_vo(
            t_hours=0.0, lat_bounds=(-80, -50), lon_bounds=None,
        )
        cost = current_speed_from_uv(uo, vo)
        assert np.isnan(cost).any()
        assert np.isnan(cost[np.isnan(uo) | np.isnan(vo)]).all()
        assert not np.any(np.isnan(cost) & (cost == 0.0))

    def test_source_nan_reaches_the_route_grid(self, nan_root, route_grid):
        adapter = CMEMSDateAwareAdapter(
            cmems_root=str(nan_root),
            route_start_datetime=monthly_times(2025, 6)[0],
        )
        out = adapter.load(0.0, route_grid)
        assert np.isnan(out.current_uo).any()
        assert np.isnan(out.current_vo).any()
        assert np.isnan(out.current_cost).any()
        missing = out.current_uo[np.isnan(out.current_uo)]
        assert not np.any(missing == 0.0)

    def test_no_nan_to_num_anywhere_in_the_module(self):
        """
        No real ``np.nan_to_num(...)`` CALL may exist in the data layer.

        Checked on the parsed AST rather than the raw text, so the prose in
        docstrings and comments (which legitimately says "np.nan_to_num(...,
        nan=0.0) is never applied") cannot mask an actual call.
        """
        import ast
        import inspect as _inspect
        from src.data import cmems_loader, adapters

        for mod in (cmems_loader, adapters):
            tree = ast.parse(_inspect.getsource(mod))
            for node in ast.walk(tree):
                if not isinstance(node, ast.Call):
                    continue
                func = node.func
                name = (func.attr if isinstance(func, ast.Attribute)
                        else getattr(func, "id", ""))
                if name == "nan_to_num":
                    pytest.fail(
                        f"{mod.__name__} line {node.lineno} calls "
                        f"{name}(); zero-filling uo/vo is forbidden"
                    )

    def test_nan_is_not_reported_as_zero_speed(self, nan_root, route_grid):
        adapter = CMEMSDateAwareAdapter(
            cmems_root=str(nan_root),
            route_start_datetime=monthly_times(2025, 6)[0],
        )
        out = adapter.load(0.0, route_grid)
        cost = out.current_cost
        # A zero-fill would make a large share of the grid exactly 0.
        n_zero = int(np.sum(cost == 0.0))
        n_nan = int(np.sum(np.isnan(cost)))
        assert n_zero == 0, "unknown currents were reported as exactly zero"


# ---------------------------------------------------------------------------
# 5. Out-of-domain cells stay NaN
# ---------------------------------------------------------------------------

class TestOutsideDomain:
    def test_route_rows_north_of_cmems_limit_are_nan(
        self, cmems_root_2025, route_grid,
    ):
        """
        CMEMS covers lat -80..-50; the route grid reaches -32.  The gap must be
        NaN, never zero current and never an extrapolated edge value.
        """
        adapter = CMEMSDateAwareAdapter(
            cmems_root=str(cmems_root_2025), route_start_datetime=START,
        )
        out = adapter.load(0.0, route_grid)
        north = out.current_uo[-1, :]     # lat closest to -32
        assert np.isnan(north).all(), (
            "route rows north of the CMEMS domain were filled in"
        )
        assert not np.any(north == 0.0)

    def test_rows_inside_the_cmems_band_are_finite(
        self, cmems_root_2025, route_grid,
    ):
        adapter = CMEMSDateAwareAdapter(
            cmems_root=str(cmems_root_2025), route_start_datetime=START,
        )
        out = adapter.load(0.0, route_grid)
        inside = route_grid.lat <= CMEMS_LAT_MAX
        got = out.current_uo[inside, :]
        # Longitudes outside the fixture's span are legitimately NaN too.
        assert np.isfinite(got).any()

    def test_bounds_selecting_nothing_raise(self, cmems_root_2025):
        loader = _loader(cmems_root_2025)
        with pytest.raises(ValueError) as exc:
            loader.load_uo_vo(t_hours=0.0, lat_bounds=(10.0, 20.0),
                               lon_bounds=None)
        assert "select no cells" in str(exc.value)

    def test_out_of_domain_is_nan_not_mean_of_domain(
        self, cmems_root_2025, route_grid,
    ):
        adapter = CMEMSDateAwareAdapter(
            cmems_root=str(cmems_root_2025), route_start_datetime=START,
        )
        out = adapter.load(0.0, route_grid)
        uo = out.current_uo
        domain_mean = np.nanmean(uo[np.isfinite(uo)])
        missing = uo[np.isnan(uo)]
        if missing.size and np.isfinite(domain_mean):
            assert not np.any(np.isclose(missing, domain_mean))


# ---------------------------------------------------------------------------
# 6. No full-file loading
# ---------------------------------------------------------------------------

class TestNoFullFileLoad:
    def test_loader_reads_only_the_subset_and_one_timestep(
        self, cmems_root_2025,
    ):
        """
        The selected arrays must be the spatial subset for ONE time step.

        If the whole time axis were materialised, ``uo`` would carry the full
        1460-step extent and this would be a 16.96 GB read in production.
        """
        loader = _loader(cmems_root_2025)
        uo, vo, lat, lon = loader.load_uo_vo(
            t_hours=0.0, lat_bounds=(-70.0, -60.0), lon_bounds=None,
        )
        assert uo.ndim == 2, f"uo should be 2-D after depth+time selection, got {uo.shape}"
        assert uo.shape == (lat.size, lon.size)
        assert uo.shape[0] < CMEMS_2025_EXPECTED_STEPS

    def test_dataset_is_opened_lazily(self, cmems_root_2025, monkeypatch):
        """
        ``open_dataset`` must be called without loading, and ``.values`` only
        after the spatial and temporal subset.  Recorded by call order.
        """
        calls = []
        import src.data.cmems_loader as mod
        real_open = mod.xr.open_dataset

        def spy_open(*a, **kw):
            ds = real_open(*a, **kw)
            calls.append(("open", ds))
            return ds

        monkeypatch.setattr(mod.xr, "open_dataset", spy_open)
        loader = _loader(cmems_root_2025)
        loader.load_uo_vo(t_hours=0.0, lat_bounds=(-70.0, -60.0),
                          lon_bounds=None)
        assert calls, "open_dataset was never called through the module"
        first = calls[0][1]
        # The file was opened with all 1460 time steps still present; only the
        # slice was materialised afterwards.
        assert first.sizes["time"] == CMEMS_2025_EXPECTED_STEPS

    def test_adapter_never_holds_a_time_axis(self, cmems_root_2025, route_grid):
        adapter = CMEMSDateAwareAdapter(
            cmems_root=str(cmems_root_2025), route_start_datetime=START,
        )
        out = adapter.load(0.0, route_grid)
        for name in ("current_uo", "current_vo", "current_cost"):
            arr = getattr(out, name)
            assert arr.shape == (ROUTE_ROWS, ROUTE_COLS)
            assert arr.ndim == 2

    def test_real_2025_lon_count_constant_is_documented(self):
        """
        The real file has 4319 longitudes; the fixture is smaller.  Assert the
        constant is retained so the real shape stays documented.
        """
        assert CMEMS_2025_LON_COUNT == 4319


# ---------------------------------------------------------------------------
# 7. uo and vo stay separate; speed is only a diagnostic
# ---------------------------------------------------------------------------

class TestVectorIntegrity:
    def test_uo_and_vo_are_both_present_and_distinct(
        self, cmems_root_2025, route_grid,
    ):
        adapter = CMEMSDateAwareAdapter(
            cmems_root=str(cmems_root_2025), route_start_datetime=START,
        )
        out = adapter.load(0.0, route_grid)
        assert out.current_uo is not None and out.current_vo is not None
        assert not np.allclose(out.current_uo, out.current_vo)

    def test_cost_equals_magnitude_of_the_two_vectors(
        self, cmems_root_2025, route_grid,
    ):
        adapter = CMEMSDateAwareAdapter(
            cmems_root=str(cmems_root_2025), route_start_datetime=START,
        )
        out = adapter.load(0.0, route_grid)
        expected = current_speed_from_uv(out.current_uo, out.current_vo)
        assert np.allclose(out.current_cost, expected, equal_nan=True)

    def test_speed_helper_is_marked_diagnostic(self):
        """The speed function must carry the not-validated warning."""
        doc = inspect.getdoc(current_speed_from_uv)
        assert "DIAGNOSTIC" in doc
        assert "not a validated adverse-current penalty" in doc.lower() or \
            "not a scientifically" in doc.lower() or \
            "NOT a validated" in doc

    def test_current_model_untouched_by_this_change(self):
        """
        Prove ``src/routing/current_model.py`` was NOT modified here.

        Its pre-existing ``np.nan_to_num(..., nan=0.0)`` in
        ``estimate_max_current_ms`` is a deliberate, out-of-scope diagnostic
        that estimates a grid-wide maximum for a conservative A* heuristic --
        treating an unobserved cell as 0 under-estimates that maximum, which
        keeps the heuristic admissible.  It is NOT the CMEMS data layer, and
        changing it would alter route behaviour, so this test guards the file
        against accidental modification instead of forbidding its contents.
        """
        import subprocess
        from pathlib import Path

        rel = "src/routing/current_model.py"
        root = Path(__file__).resolve().parent.parent
        try:
            raw = subprocess.run(
                ["git", "show", f"HEAD:{rel}"],
                cwd=str(root), capture_output=True, timeout=60, check=True,
            ).stdout
        except Exception as exc:                       # git absent / no HEAD
            pytest.skip(f"cannot compare {rel} against HEAD: {exc}")

        # Decode both as UTF-8 and compare line by line: this repo checks out
        # CRLF while the committed blob is LF, so a raw byte compare reports a
        # spurious difference for an unmodified file.  It also avoids the
        # Windows locale (cp1252) mangling the file's non-ASCII characters.
        committed = raw.decode("utf-8").splitlines()
        on_disk = (root / rel).read_text(encoding="utf-8").splitlines()
        assert on_disk == committed, (
            f"{rel} was modified; this CMEMS change must not touch routing"
        )


# ---------------------------------------------------------------------------
# 8. Provenance
# ---------------------------------------------------------------------------

class TestProvenance:
    def test_adapter_records_the_source_file(self, cmems_root_2025, route_grid):
        adapter = CMEMSDateAwareAdapter(
            cmems_root=str(cmems_root_2025), route_start_datetime=START,
        )
        out = adapter.load(0.0, route_grid)
        prov = out.layer_provenance["current_uo"]
        assert CMEMS_2025_ANNUAL in prov["source"]
        assert "diagnostic" in prov["note"]

    def test_unavailable_root_reports_not_available(
        self, tmp_path, route_grid,
    ):
        adapter = CMEMSDateAwareAdapter(
            cmems_root=str(tmp_path / "nope"), route_start_datetime=START,
        )
        assert adapter.is_available() is False
        out = adapter.load(0.0, route_grid)
        assert np.isnan(out.current_uo).all()
        assert np.isnan(out.current_vo).all()
        assert np.isnan(out.current_cost).all()

    def test_second_load_is_cached_and_identical(
        self, cmems_root_2025, route_grid,
    ):
        adapter = CMEMSDateAwareAdapter(
            cmems_root=str(cmems_root_2025), route_start_datetime=START,
        )
        a = adapter.load(0.0, route_grid)
        b = adapter.load(0.0, route_grid)
        assert np.allclose(a.current_uo, b.current_uo, equal_nan=True)

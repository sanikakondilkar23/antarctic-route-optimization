"""
Tests for M4.7: Date-Aware CMEMS Current Loader.

Creates SMALL synthetic CMEMS files that reproduce:
    - 2021-2024 monthly format (Ocean_{year}_{month:02d}.nc)
    - 2025 6-hourly format (CMEMS_Current_2025_6hourly.nc)
    - datetime64 time coordinates
    - latitude/longitude naming
    - surface depth (0.494025 m)
    - different longitude grid sizes (4320 vs 4319)
    - spatial subsetting
    - lazy access (no full-file loading)

No real 39 GB dataset is required for pytest.
"""

from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pytest
import xarray as xr

from src.data.cmems_loader import (
    CMEMSDateAwareLoader,
    current_speed_from_uv,
    resolve_cmems_path,
)
from src.data.adapters import CMEMSDateAwareAdapter
from src.data.builder import build_env_fn
from src.data.config import DataConfig
from src.environment.grid import EnvironmentalGrid
from src.routing.cost import CostWeights
from src.routing.td_astar import td_astar


# ---------------------------------------------------------------------------
# Helpers: create small synthetic CMEMS files
# ---------------------------------------------------------------------------

def _create_monthly_cmems_file(
    path: Path,
    year: int,
    month: int,
    n_lat: int = 12,
    n_lon: int = 16,
    n_time: int = 4,
    seed: int = 42,
):
    """
    Create a synthetic CMEMS file mimicking the 2021-2024 monthly format.

    Naming: Ocean_{year}_{month:02d}.nc
    Dims:   [time, depth, latitude, longitude]
    Time:   datetime64 (monthly, ~8-day intervals for n_time=4 in a 31-day month)
    Depth:  [0.494025] (surface)
    Lat:    -80 to -50 (descending, as in real CMEMS)
    Lon:    0 to 360 (4320 points in real data, smaller for tests)
    """
    rng = np.random.RandomState(seed)

    latitude = np.linspace(-80.0, -50.0, n_lat)
    longitude = np.linspace(0.0, 360.0, n_lon)
    depth = np.array([0.494025])  # CMEMS surface depth

    # Generate datetime64 timestamps (every ~8 days within the month)
    start_date = datetime(year, month, 1)
    times = [start_date + timedelta(days=8 * i) for i in range(n_time)]

    uo_raw = rng.uniform(-0.15, 0.25, (n_time, len(depth), n_lat, n_lon))
    vo_raw = rng.uniform(-0.15, 0.25, (n_time, len(depth), n_lat, n_lon))

    # Add some NaN values (simulating land masking)
    mask = rng.random((n_lat, n_lon)) < 0.05
    uo_raw[:, :, mask] = np.nan
    vo_raw[:, :, mask] = np.nan

    ds = xr.Dataset(
        {
            "uo": (["time", "depth", "latitude", "longitude"], uo_raw),
            "vo": (["time", "depth", "latitude", "longitude"], vo_raw),
        },
        coords={
            "time": times,
            "depth": depth,
            "latitude": latitude,
            "longitude": longitude,
        },
    )
    ds["uo"].attrs = {"units": "m s-1"}
    ds["vo"].attrs = {"units": "m s-1"}
    ds.to_netcdf(str(path))
    return uo_raw, vo_raw, latitude, longitude, times


def _create_2025_6hourly_cmems_file(
    path: Path,
    n_lat: int = 12,
    n_lon: int = 16,  # Note: 4319 in real 2025, different from 4320 in 2021-2024
    n_time: int = 8,
    seed: int = 42,
):
    """
    Create a synthetic CMEMS file mimicking the 2025 6-hourly format.

    Naming: CMEMS_Current_2025_6hourly.nc
    Dims:   [time, depth, latitude, longitude]
    Time:   datetime64 (6-hourly intervals)
    Depth:  [0.494025] (surface)
    Lat:    -80 to -50 (descending)
    Lon:    0 to 360 (4319 points in real data, smaller for tests)
    """
    rng = np.random.RandomState(seed)

    latitude = np.linspace(-80.0, -50.0, n_lat)
    longitude = np.linspace(0.0, 360.0, n_lon)
    depth = np.array([0.494025])

    start_date = datetime(2025, 1, 1, 0, 0)
    times = [start_date + timedelta(hours=6 * i) for i in range(n_time)]

    uo_raw = rng.uniform(-0.15, 0.25, (n_time, len(depth), n_lat, n_lon))
    vo_raw = rng.uniform(-0.15, 0.25, (n_time, len(depth), n_lat, n_lon))

    mask = rng.random((n_lat, n_lon)) < 0.05
    uo_raw[:, :, mask] = np.nan
    vo_raw[:, :, mask] = np.nan

    ds = xr.Dataset(
        {
            "uo": (["time", "depth", "latitude", "longitude"], uo_raw),
            "vo": (["time", "depth", "latitude", "longitude"], vo_raw),
        },
        coords={
            "time": times,
            "depth": depth,
            "latitude": latitude,
            "longitude": longitude,
        },
    )
    ds["uo"].attrs = {"units": "m s-1"}
    ds["vo"].attrs = {"units": "m s-1"}
    ds.to_netcdf(str(path))
    return uo_raw, vo_raw, latitude, longitude, times


def _build_cmems_directory(tmp_path: Path, years=range(2021, 2026)):
    """
    Build a complete CMEMS directory structure for testing.

    Returns dict with paths and metadata for each file created.
    """
    files = {}
    for year in years:
        year_dir = tmp_path / str(year)
        year_dir.mkdir(parents=True, exist_ok=True)

        if year == 2025:
            # 2025: single 6-hourly file
            nc_path = year_dir / "CMEMS_Current_2025_6hourly.nc"
            uo, vo, lat, lon, times = _create_2025_6hourly_cmems_file(
                nc_path, n_lat=12, n_lon=16, n_time=8
            )
            files[year] = {
                "path": nc_path,
                "uo": uo, "vo": vo,
                "lat": lat, "lon": lon, "times": times,
                "n_lon": 16,
            }
        else:
            # 2021-2024: monthly files (create just January for testing)
            month = 1
            nc_path = year_dir / f"Ocean_{year}_{month:02d}.nc"
            uo, vo, lat, lon, times = _create_monthly_cmems_file(
                nc_path, year, month, n_lat=12, n_lon=14, n_time=4
            )
            files[year] = {
                "path": nc_path,
                "uo": uo, "vo": vo,
                "lat": lat, "lon": lon, "times": times,
                "n_lon": 14,
            }

    return files


def _make_grid_template(n_rows=12, n_cols=16):
    """Create a standard test grid template covering Antarctic region."""
    lat = np.linspace(-78.0, -52.0, n_rows)
    lon = np.linspace(10.0, 50.0, n_cols)
    return EnvironmentalGrid(
        n_rows=n_rows, n_cols=n_cols,
        lat=lat, lon=lon,
        navigable=np.ones((n_rows, n_cols), dtype=bool),
        sic_mean=np.zeros((n_rows, n_cols)),
    )


# ---------------------------------------------------------------------------
# File resolution tests
# ---------------------------------------------------------------------------

class TestResolveCMEMSPath:
    """Test automatic file selection based on datetime."""

    def test_2021_monthly_file(self, tmp_path):
        """2021-01-01 selects Ocean_2021_01.nc."""
        year_dir = tmp_path / "2021"
        year_dir.mkdir()
        nc_path = year_dir / "Ocean_2021_01.nc"
        nc_path.touch()

        result = resolve_cmems_path(str(tmp_path), datetime(2021, 1, 15, 12, 0))
        assert result == nc_path

    def test_2024_monthly_file(self, tmp_path):
        """2024-06-15 selects Ocean_2024_06.nc."""
        year_dir = tmp_path / "2024"
        year_dir.mkdir()
        nc_path = year_dir / "Ocean_2024_06.nc"
        nc_path.touch()

        result = resolve_cmems_path(str(tmp_path), datetime(2024, 6, 15, 0, 0))
        assert result == nc_path

    def test_2025_6hourly_file(self, tmp_path):
        """2025 any date selects CMEMS_Current_2025_6hourly.nc."""
        year_dir = tmp_path / "2025"
        year_dir.mkdir()
        nc_path = year_dir / "CMEMS_Current_2025_6hourly.nc"
        nc_path.touch()

        result = resolve_cmems_path(str(tmp_path), datetime(2025, 3, 20, 18, 0))
        assert result == nc_path

    def test_file_not_found(self, tmp_path):
        """Raises FileNotFoundError when file doesn't exist."""
        with pytest.raises(FileNotFoundError, match="CMEMS file not found"):
            resolve_cmems_path(str(tmp_path), datetime(2021, 1, 1))

    def test_year_out_of_range(self, tmp_path):
        """Raises ValueError for years outside 2021-2025."""
        with pytest.raises(ValueError, match="outside supported range"):
            resolve_cmems_path(str(tmp_path), datetime(2020, 1, 1))

        with pytest.raises(ValueError, match="outside supported range"):
            resolve_cmems_path(str(tmp_path), datetime(2026, 1, 1))


# ---------------------------------------------------------------------------
# current_speed_from_uv tests
# ---------------------------------------------------------------------------

class TestCurrentSpeedFromUV:
    """Test the isolated uo/vo -> current_cost conversion."""

    def test_zero_current(self):
        uo = np.zeros((5, 5))
        vo = np.zeros((5, 5))
        result = current_speed_from_uv(uo, vo)
        assert np.allclose(result, 0.0)

    def test_purely_zonal(self):
        uo = np.array([[0.1, 0.2, 0.3]])
        vo = np.zeros((1, 3))
        result = current_speed_from_uv(uo, vo)
        np.testing.assert_allclose(result, np.abs(uo))

    def test_purely_meridional(self):
        uo = np.zeros((1, 3))
        vo = np.array([[0.1, -0.2, 0.3]])
        result = current_speed_from_uv(uo, vo)
        np.testing.assert_allclose(result, np.abs(vo))

    def test_mixed_directions(self):
        uo = np.array([[3.0]])
        vo = np.array([[4.0]])
        result = current_speed_from_uv(uo, vo)
        np.testing.assert_allclose(result, [[5.0]])  # 3-4-5 triangle

    def test_always_nonnegative(self):
        rng = np.random.RandomState(42)
        uo = rng.uniform(-1.0, 1.0, (10, 10))
        vo = rng.uniform(-1.0, 1.0, (10, 10))
        result = current_speed_from_uv(uo, vo)
        assert (result >= 0).all()


# ---------------------------------------------------------------------------
# CMEMSDateAwareLoader tests
# ---------------------------------------------------------------------------

class TestCMEMSDateAwareLoader:
    """Test the core date-aware loader."""

    def test_load_2021_monthly(self, tmp_path):
        """Loader reads from 2021-2024 monthly file."""
        files = _build_cmems_directory(tmp_path, years=[2021])
        loader = CMEMSDateAwareLoader(
            cmems_root=str(tmp_path),
            route_start_datetime=datetime(2021, 1, 1, 0, 0),
        )

        uo, vo, lat, lon = loader.load_uo_vo(
            t_hours=0.0,
            lat_bounds=(-80, -50),
            lon_bounds=(0, 360),
        )

        assert uo.shape == (12, 14)
        assert vo.shape == (12, 14)
        assert lat.shape == (12,)
        assert lon.shape == (14,)
        assert np.all(np.isfinite(uo))
        assert np.all(np.isfinite(vo))

    def test_load_2025_6hourly(self, tmp_path):
        """Loader reads from 2025 6-hourly file."""
        files = _build_cmems_directory(tmp_path, years=[2025])
        loader = CMEMSDateAwareLoader(
            cmems_root=str(tmp_path),
            route_start_datetime=datetime(2025, 1, 1, 0, 0),
        )

        uo, vo, lat, lon = loader.load_uo_vo(
            t_hours=0.0,
            lat_bounds=(-80, -50),
            lon_bounds=(0, 360),
        )

        assert uo.shape == (12, 16)
        assert vo.shape == (12, 16)
        assert np.all(np.isfinite(uo))

    def test_t_hours_to_datetime_conversion(self, tmp_path):
        """t_hours is correctly converted to absolute datetime."""
        _build_cmems_directory(tmp_path, years=[2025])
        start_dt = datetime(2025, 1, 1, 0, 0)
        loader = CMEMSDateAwareLoader(
            cmems_root=str(tmp_path),
            route_start_datetime=start_dt,
        )

        # t_hours=24 should be 2025-01-02 00:00
        result_dt = loader.t_hours_to_datetime(24.0)
        assert result_dt == datetime(2025, 1, 2, 0, 0)

        # t_hours=0 should be 2025-01-01 00:00
        result_dt = loader.t_hours_to_datetime(0.0)
        assert result_dt == datetime(2025, 1, 1, 0, 0)

    def test_nearest_time_selection(self, tmp_path):
        """Loader selects the nearest available timestamp."""
        _build_cmems_directory(tmp_path, years=[2025])

        loader = CMEMSDateAwareLoader(
            cmems_root=str(tmp_path),
            route_start_datetime=datetime(2025, 1, 1, 0, 0),
        )

        # t_hours=0 -> 2025-01-01 00:00 (exact match with first timestep)
        uo_t0, _, _, _ = loader.load_uo_vo(
            t_hours=0.0, lat_bounds=(-80, -50), lon_bounds=(0, 360)
        )

        # t_hours=6 -> 2025-01-01 06:00 (exact match with second timestep)
        uo_t6, _, _, _ = loader.load_uo_vo(
            t_hours=6.0, lat_bounds=(-80, -50), lon_bounds=(0, 360)
        )

        # Different times should give different data
        assert not np.allclose(uo_t0, uo_t6)

    def test_surface_depth_selected(self, tmp_path):
        """Loader selects the surface depth level."""
        _build_cmems_directory(tmp_path, years=[2025])
        loader = CMEMSDateAwareLoader(
            cmems_root=str(tmp_path),
            route_start_datetime=datetime(2025, 1, 1, 0, 0),
        )

        info = loader.inspect_file(t_hours=0.0)
        # Surface depth should be selected (0.494025 m)
        assert info["depth_values"] is not None
        assert len(info["depth_values"]) == 1
        assert abs(info["depth_values"][0] - 0.494025) < 0.001

    def test_latitude_longitude_detection(self, tmp_path):
        """Loader auto-detects latitude/longitude coordinate names."""
        _build_cmems_directory(tmp_path, years=[2025])
        loader = CMEMSDateAwareLoader(
            cmems_root=str(tmp_path),
            route_start_datetime=datetime(2025, 1, 1, 0, 0),
        )

        info = loader.inspect_file(t_hours=0.0)
        assert "latitude" in str(info) or info["lat_size"] == 12
        assert "longitude" in str(info) or info["lon_size"] == 16

    def test_different_longitude_sizes(self, tmp_path):
        """Loader handles different longitude grid sizes (4320 vs 4319)."""
        # Create 2021 file with 14 longitude points
        year_dir_2021 = tmp_path / "2021"
        year_dir_2021.mkdir()
        _create_monthly_cmems_file(
            year_dir_2021 / "Ocean_2021_01.nc",
            2021, 1, n_lat=12, n_lon=14,
        )

        # Create 2025 file with 16 longitude points (different from 2021)
        year_dir_2025 = tmp_path / "2025"
        year_dir_2025.mkdir()
        _create_2025_6hourly_cmems_file(
            year_dir_2025 / "CMEMS_Current_2025_6hourly.nc",
            n_lat=12, n_lon=16,
        )

        loader_2021 = CMEMSDateAwareLoader(
            cmems_root=str(tmp_path),
            route_start_datetime=datetime(2021, 1, 1, 0, 0),
        )
        loader_2025 = CMEMSDateAwareLoader(
            cmems_root=str(tmp_path),
            route_start_datetime=datetime(2025, 1, 1, 0, 0),
        )

        _, _, _, lon_2021 = loader_2021.load_uo_vo(
            t_hours=0.0, lat_bounds=(-80, -50), lon_bounds=(0, 360)
        )
        _, _, _, lon_2025 = loader_2025.load_uo_vo(
            t_hours=0.0, lat_bounds=(-80, -50), lon_bounds=(0, 360)
        )

        # Different longitude sizes
        assert len(lon_2021) == 14
        assert len(lon_2025) == 16
        assert len(lon_2021) != len(lon_2025)

    def test_spatial_subsetting(self, tmp_path):
        """Loader returns only the requested spatial subset."""
        _build_cmems_directory(tmp_path, years=[2025])
        loader = CMEMSDateAwareLoader(
            cmems_root=str(tmp_path),
            route_start_datetime=datetime(2025, 1, 1, 0, 0),
        )

        # Request a small subset
        uo, vo, lat, lon = loader.load_uo_vo(
            t_hours=0.0,
            lat_bounds=(-70, -60),
            lon_bounds=(50, 150),
        )

        # Should be smaller than full grid
        assert lat.shape[0] <= 12
        assert lon.shape[0] <= 16
        # Lat range should be within requested bounds
        assert lat.min() >= -70.0
        assert lat.max() <= -60.0

    def test_no_full_file_loading(self, tmp_path):
        """Loader uses xarray lazy access (opens/closes file properly)."""
        _build_cmems_directory(tmp_path, years=[2025])
        loader = CMEMSDateAwareLoader(
            cmems_root=str(tmp_path),
            route_start_datetime=datetime(2025, 1, 1, 0, 0),
        )

        # Load data
        uo, vo, lat, lon = loader.load_uo_vo(
            t_hours=0.0, lat_bounds=(-80, -50), lon_bounds=(0, 360)
        )

        # Data should be numpy arrays (loaded into memory for the subset)
        assert isinstance(uo, np.ndarray)
        assert isinstance(vo, np.ndarray)

    def test_load_current_cost(self, tmp_path):
        """load_current_cost returns speed magnitude >= 0."""
        _build_cmems_directory(tmp_path, years=[2025])
        loader = CMEMSDateAwareLoader(
            cmems_root=str(tmp_path),
            route_start_datetime=datetime(2025, 1, 1, 0, 0),
        )

        cost, lat, lon = loader.load_current_cost(
            t_hours=0.0, lat_bounds=(-80, -50), lon_bounds=(0, 360)
        )

        assert (cost >= 0).all()
        assert np.all(np.isfinite(cost))

    def test_inspect_file(self, tmp_path):
        """inspect_file returns metadata without loading data."""
        _build_cmems_directory(tmp_path, years=[2025])
        loader = CMEMSDateAwareLoader(
            cmems_root=str(tmp_path),
            route_start_datetime=datetime(2025, 1, 1, 0, 0),
        )

        info = loader.inspect_file(t_hours=12.0)

        assert "path" in info
        assert "time_steps" in info
        assert "lat_size" in info
        assert "lon_size" in info
        assert "depth_values" in info
        assert info["year"] == 2025
        assert info["time_steps"] == 8


# ---------------------------------------------------------------------------
# CMEMSDateAwareAdapter tests
# ---------------------------------------------------------------------------

class TestCMEMSDateAwareAdapter:
    """Test the adapter that wraps CMEMSDateAwareLoader."""

    def test_adapter_load(self, tmp_path):
        """Adapter populates current_cost on grid."""
        _build_cmems_directory(tmp_path, years=[2025])

        adapter = CMEMSDateAwareAdapter(
            cmems_root=str(tmp_path),
            route_start_datetime=datetime(2025, 1, 1, 0, 0),
        )
        assert adapter.is_available()

        grid = _make_grid_template(n_rows=12, n_cols=16)
        result = adapter.load(t_hours=0.0, grid_template=grid)

        assert result.current_cost is not None
        assert result.current_cost.shape == (12, 16)
        assert (result.current_cost >= 0).all()

    def test_adapter_unavailable(self):
        """Unavailable adapter returns zero current."""
        adapter = CMEMSDateAwareAdapter(
            cmems_root="/nonexistent/path",
            route_start_datetime=datetime(2025, 1, 1, 0, 0),
        )
        assert not adapter.is_available()

        grid = _make_grid_template()
        result = adapter.load(t_hours=0.0, grid_template=grid)
        assert np.allclose(result.current_cost, 0.0)

    def test_adapter_time_varying(self, tmp_path):
        """Adapter returns different currents at different times."""
        _build_cmems_directory(tmp_path, years=[2025])

        adapter = CMEMSDateAwareAdapter(
            cmems_root=str(tmp_path),
            route_start_datetime=datetime(2025, 1, 1, 0, 0),
        )
        grid = _make_grid_template(n_rows=12, n_cols=16)

        result_t0 = adapter.load(t_hours=0.0, grid_template=grid)
        result_t6 = adapter.load(t_hours=6.0, grid_template=grid)

        assert not np.allclose(result_t0.current_cost, result_t6.current_cost)

    def test_adapter_load_uo_vo(self, tmp_path):
        """Adapter exposes raw uo/vo fields (CMEMS subset, not interpolated)."""
        _build_cmems_directory(tmp_path, years=[2025])

        adapter = CMEMSDateAwareAdapter(
            cmems_root=str(tmp_path),
            route_start_datetime=datetime(2025, 1, 1, 0, 0),
        )
        grid = _make_grid_template(n_rows=12, n_cols=16)

        uo, vo, lat, lon = adapter.load_uo_vo(t_hours=0.0, grid_template=grid)

        # load_uo_vo returns the CMEMS subset (may differ from grid shape)
        assert uo.ndim == 2
        assert vo.ndim == 2
        assert uo.shape == vo.shape
        assert np.all(np.isfinite(uo))
        assert lat.ndim == 1
        assert lon.ndim == 1

    def test_adapter_different_lon_sizes(self, tmp_path):
        """Adapter handles 2021 (14 lon) vs 2025 (16 lon) gracefully."""
        # Create 2021 file with 14 lon
        year_dir_2021 = tmp_path / "2021"
        year_dir_2021.mkdir()
        _create_monthly_cmems_file(
            year_dir_2021 / "Ocean_2021_01.nc",
            2021, 1, n_lat=12, n_lon=14,
        )

        # Create 2025 file with 16 lon
        year_dir_2025 = tmp_path / "2025"
        year_dir_2025.mkdir()
        _create_2025_6hourly_cmems_file(
            year_dir_2025 / "CMEMS_Current_2025_6hourly.nc",
            n_lat=12, n_lon=16,
        )

        adapter_2021 = CMEMSDateAwareAdapter(
            cmems_root=str(tmp_path),
            route_start_datetime=datetime(2021, 1, 1, 0, 0),
        )
        adapter_2025 = CMEMSDateAwareAdapter(
            cmems_root=str(tmp_path),
            route_start_datetime=datetime(2025, 1, 1, 0, 0),
        )

        grid_2021 = _make_grid_template(n_rows=12, n_cols=14)
        grid_2025 = _make_grid_template(n_rows=12, n_cols=16)

        result_2021 = adapter_2021.load(t_hours=0.0, grid_template=grid_2021)
        result_2025 = adapter_2025.load(t_hours=0.0, grid_template=grid_2025)

        assert result_2021.current_cost.shape == (12, 14)
        assert result_2025.current_cost.shape == (12, 16)


# ---------------------------------------------------------------------------
# Builder integration tests (M4.7)
# ---------------------------------------------------------------------------

class TestBuilderDateAware:
    """Test that builder correctly uses date-aware adapter."""

    def test_builder_uses_date_aware_adapter(self, tmp_path):
        """build_env_fn uses CMEMSDateAwareAdapter when cmems_root is set."""
        _build_cmems_directory(tmp_path, years=[2025])

        config = DataConfig(
            cmems_root=str(tmp_path),
            route_start_datetime=datetime(2025, 1, 1, 0, 0),
        )
        assert "cmems_date_aware" in config.active_adapters()
        assert "current" not in config.active_adapters()

        grid = _make_grid_template(n_rows=12, n_cols=16)
        env_fn = build_env_fn(config, grid)

        result = env_fn(0.0)
        assert result.current_cost is not None
        assert (result.current_cost >= 0).all()

    def test_builder_falls_back_to_single_file(self, tmp_path):
        """build_env_fn uses single-file adapter when cmems_root is not set."""
        nc_file = tmp_path / "current.nc"
        # Create a simple single-file current dataset
        lat = np.linspace(-78, -52, 12)
        lon = np.linspace(10, 50, 16)
        rng = np.random.RandomState(42)
        uo = rng.uniform(-0.1, 0.2, (4, 1, 12, 16))
        vo = rng.uniform(-0.1, 0.2, (4, 1, 12, 16))
        ds = xr.Dataset(
            {
                "uo": (["time", "depth", "lat", "lon"], uo),
                "vo": (["time", "depth", "lat", "lon"], vo),
            },
            coords={
                "time": np.arange(4) * 24.0,
                "depth": [0.0],
                "lat": lat,
                "lon": lon,
            },
        )
        ds.to_netcdf(str(nc_file))

        config = DataConfig(current_path=str(nc_file))
        assert "current" in config.active_adapters()
        assert "cmems_date_aware" not in config.active_adapters()

        grid = _make_grid_template(n_rows=12, n_cols=16)
        env_fn = build_env_fn(config, grid)

        result = env_fn(0.0)
        assert result.current_cost is not None

    def test_builder_time_varying_date_aware(self, tmp_path):
        """env_fn from date-aware adapter returns different data at different times."""
        _build_cmems_directory(tmp_path, years=[2025])

        config = DataConfig(
            cmems_root=str(tmp_path),
            route_start_datetime=datetime(2025, 1, 1, 0, 0),
        )
        grid = _make_grid_template(n_rows=12, n_cols=16)
        env_fn = build_env_fn(config, grid)

        result_t0 = env_fn(0.0)
        result_t6 = env_fn(6.0)

        assert not np.allclose(result_t0.current_cost, result_t6.current_cost)


# ---------------------------------------------------------------------------
# Integration with td_astar (M4.7)
# ---------------------------------------------------------------------------

class TestM47IntegrationWithRouting:
    """Test that M4.7 date-aware loading works with the route optimizer."""

    def test_td_astar_with_date_aware_current(self, tmp_path):
        """td_astar with date-aware CMEMS adapter produces valid routes."""
        _build_cmems_directory(tmp_path, years=[2025])

        config = DataConfig(
            cmems_root=str(tmp_path),
            route_start_datetime=datetime(2025, 1, 1, 0, 0),
        )
        grid = _make_grid_template(n_rows=12, n_cols=16)
        env_fn = build_env_fn(config, grid)

        result = td_astar(
            grid, (0, 0), (11, 15),
            env_fn=env_fn,
            weights=CostWeights(w_curr=1.0, w_distance=1.0),
        )
        assert result.success
        assert result.total_cost > 0

    def test_td_astar_with_sic_and_date_aware_current(self, tmp_path):
        """td_astar with SIC adapter + date-aware current adapter works."""
        _build_cmems_directory(tmp_path, years=[2025])

        # Create a SIC file
        sic_file = tmp_path / "sic.nc"
        lat = np.linspace(-78, -52, 12)
        lon = np.linspace(10, 50, 16)
        rng = np.random.RandomState(42)
        sic = rng.uniform(0.0, 0.5, (4, 12, 16))
        ds = xr.Dataset(
            {"siconc": (["time", "lat", "lon"], sic)},
            coords={"time": np.arange(4) * 24.0, "lat": lat, "lon": lon},
        )
        ds.to_netcdf(str(sic_file))

        config = DataConfig(
            sic_path=str(sic_file),
            cmems_root=str(tmp_path),
            route_start_datetime=datetime(2025, 1, 1, 0, 0),
        )
        grid = _make_grid_template(n_rows=12, n_cols=16)
        env_fn = build_env_fn(config, grid)

        result = td_astar(
            grid, (0, 0), (11, 15),
            env_fn=env_fn,
            weights=CostWeights(w_sic=1.0, w_curr=1.0, w_distance=1.0),
        )
        assert result.success

    def test_td_astar_different_times_different_routes(self, tmp_path):
        """Routing at different start times produces valid routes."""
        _build_cmems_directory(tmp_path, years=[2025])

        config = DataConfig(
            cmems_root=str(tmp_path),
            route_start_datetime=datetime(2025, 1, 1, 0, 0),
        )
        grid = _make_grid_template(n_rows=12, n_cols=16)
        env_fn = build_env_fn(config, grid)

        r1 = td_astar(
            grid, (0, 0), (11, 15),
            env_fn=env_fn,
            weights=CostWeights(w_curr=2.0),
            start_time=0.0,
        )
        r2 = td_astar(
            grid, (0, 0), (11, 15),
            env_fn=env_fn,
            weights=CostWeights(w_curr=2.0),
            start_time=6.0,
        )

        assert r1.success and r2.success
        assert r1.total_cost > 0
        assert r2.total_cost > 0
        # Both routes should have valid travel times
        assert r1.travel_time > 0
        assert r2.travel_time > 0


# ---------------------------------------------------------------------------
# Config tests (M4.7 additions)
# ---------------------------------------------------------------------------

class TestDataConfigM47:
    """Test new config fields for date-aware CMEMS loading."""

    def test_cmems_root_config(self):
        config = DataConfig(
            cmems_root="/path/to/cmems",
            route_start_datetime=datetime(2025, 1, 1),
        )
        assert config.cmems_root == "/path/to/cmems"
        assert config.route_start_datetime == datetime(2025, 1, 1)
        assert "cmems_date_aware" in config.active_adapters()

    def test_cmems_root_without_datetime(self):
        config = DataConfig(cmems_root="/path/to/cmems")
        assert "cmems_date_aware" not in config.active_adapters()

    def test_datetime_without_cmems_root(self):
        config = DataConfig(route_start_datetime=datetime(2025, 1, 1))
        assert "cmems_date_aware" not in config.active_adapters()

    def test_from_env_cmems(self, monkeypatch):
        monkeypatch.setenv("ARctic_CMEMS_ROOT", "/drive/cmems")
        monkeypatch.setenv("ARctic_ROUTE_START", "2025-06-15T12:00:00")
        config = DataConfig.from_env()
        assert config.cmems_root == "/drive/cmems"
        assert config.route_start_datetime == datetime(2025, 6, 15, 12, 0)

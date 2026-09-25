"""
Tests for data integration layer.

Uses SMALL synthetic netCDF/numpy files created in tmp_path.
No real large datasets are downloaded or copied.
"""

import math
import os
import tempfile
from pathlib import Path

import numpy as np
import pytest
import xarray as xr

from src.data.adapters import (
    BathymetryAdapter,
    CMEMSCurrentAdapter,
    IcebergAdapter,
    SICAdapter,
    WindAdapter,
)
from src.data.builder import build_env_fn, build_env_fn_from_adapters
from src.data.config import DataConfig
from src.environment.grid import EnvironmentalGrid
from src.routing.cost import CostWeights
from src.routing.td_astar import td_astar


# ---------------------------------------------------------------------------
# Helpers: create small synthetic netCDF files
# ---------------------------------------------------------------------------

def _make_grid_template(n_rows=10, n_cols=10):
    """Create a standard test grid template."""
    lat = np.linspace(-70, -69.5, n_rows)
    lon = np.linspace(72, 72.5, n_cols)
    return EnvironmentalGrid(
        n_rows=n_rows, n_cols=n_cols,
        lat=lat, lon=lon,
        navigable=np.ones((n_rows, n_cols), dtype=bool),
        sic_mean=np.zeros((n_rows, n_cols)),
    )


def _create_sic_netcdf(path, n_rows=10, n_cols=10, n_times=3, seed=42):
    """Create a small synthetic SIC netCDF file."""
    rng = np.random.RandomState(seed)
    lat = np.linspace(-70, -69.5, n_rows)
    lon = np.linspace(72, 72.5, n_cols)
    time = np.arange(n_times) * 24.0  # hours: 0, 24, 48

    # SIC data: each time step has different values
    sic_data = rng.uniform(0.0, 0.8, (n_times, n_rows, n_cols))
    # Make time step 1 have higher SIC in the middle
    sic_data[1, 4:6, 4:6] = 0.95

    ds = xr.Dataset(
        {
            "siconc": (["time", "lat", "lon"], sic_data),
        },
        coords={
            "time": time,
            "lat": lat,
            "lon": lon,
        },
    )
    ds.to_netcdf(str(path))
    return sic_data


def _create_current_netcdf(path, n_rows=10, n_cols=10, n_times=3, seed=42):
    """Create a small synthetic CMEMS current netCDF file."""
    rng = np.random.RandomState(seed)
    lat = np.linspace(-70, -69.5, n_rows)
    lon = np.linspace(72, 72.5, n_cols)
    time = np.arange(n_times) * 24.0
    depth = np.array([0.0])  # surface

    uo = rng.uniform(-0.1, 0.3, (n_times, 1, n_rows, n_cols))
    vo = rng.uniform(-0.1, 0.3, (n_times, 1, n_rows, n_cols))

    ds = xr.Dataset(
        {
            "uo": (["time", "depth", "lat", "lon"], uo),
            "vo": (["time", "depth", "lat", "lon"], vo),
        },
        coords={
            "time": time,
            "depth": depth,
            "lat": lat,
            "lon": lon,
        },
    )
    ds.to_netcdf(str(path))
    return uo, vo


def _create_iceberg_netcdf(path, n_rows=10, n_cols=10, seed=42):
    """Create a small synthetic iceberg risk netCDF file."""
    rng = np.random.RandomState(seed)
    lat = np.linspace(-70, -69.5, n_rows)
    lon = np.linspace(72, 72.5, n_cols)

    risk = rng.uniform(0.0, 0.3, (n_rows, n_cols))
    risk[3:7, 3:7] = 0.9  # high risk zone

    ds = xr.Dataset(
        {"risk": (["lat", "lon"], risk)},
        coords={"lat": lat, "lon": lon},
    )
    ds.to_netcdf(str(path))
    return risk


def _create_wind_netcdf(path, n_rows=10, n_cols=10, n_times=2, seed=42):
    """Create a small synthetic wind netCDF file."""
    rng = np.random.RandomState(seed)
    lat = np.linspace(-70, -69.5, n_rows)
    lon = np.linspace(72, 72.5, n_cols)
    time = np.arange(n_times) * 24.0

    u10 = rng.uniform(-5.0, 5.0, (n_times, n_rows, n_cols))
    v10 = rng.uniform(-5.0, 5.0, (n_times, n_rows, n_cols))

    ds = xr.Dataset(
        {
            "u10": (["time", "lat", "lon"], u10),
            "v10": (["time", "lat", "lon"], v10),
        },
        coords={"time": time, "lat": lat, "lon": lon},
    )
    ds.to_netcdf(str(path))
    return u10, v10


def _create_bathy_netcdf(path, n_rows=10, n_cols=10, seed=42):
    """Create a small synthetic bathymetry netCDF file."""
    rng = np.random.RandomState(seed)
    lat = np.linspace(-70, -69.5, n_rows)
    lon = np.linspace(72, 72.5, n_cols)

    # Negative = below sea level (GEBCO convention)
    depth = rng.uniform(-500.0, -10.0, (n_rows, n_cols))
    depth[8:10, :] = -3.0  # very shallow (too shallow for 6.5m draft)

    ds = xr.Dataset(
        {"elevation": (["lat", "lon"], depth)},
        coords={"lat": lat, "lon": lon},
    )
    ds.to_netcdf(str(path))
    return depth


# ---------------------------------------------------------------------------
# Config tests
# ---------------------------------------------------------------------------

class TestDataConfig:
    def test_default_config(self):
        config = DataConfig()
        assert config.sic_path is None
        assert config.current_path is None
        assert config.active_adapters() == []

    def test_active_adapters(self):
        config = DataConfig(
            sic_path="/tmp/sic.nc",
            current_path="/tmp/current.nc",
        )
        assert config.active_adapters() == ["sic", "current"]

    def test_from_env(self, monkeypatch):
        monkeypatch.setenv("ARctic_SIC_PATH", "/drive/sic.nc")
        monkeypatch.setenv("ARctic_GRID_rows", "20")
        config = DataConfig.from_env()
        assert config.sic_path == "/drive/sic.nc"
        assert config.grid_rows == 20


# ---------------------------------------------------------------------------
# SIC adapter tests
# ---------------------------------------------------------------------------

class TestSICAdapter:
    def test_load_sic_grid(self, tmp_path):
        """SIC adapter produces correct grid with sic_mean layer."""
        sic_file = tmp_path / "sic.nc"
        sic_data = _create_sic_netcdf(sic_file)

        adapter = SICAdapter(path=str(sic_file))
        assert adapter.is_available()

        grid = _make_grid_template()
        result = adapter.load(t_hours=0.0, grid_template=grid)

        assert result.sic_mean is not None
        assert result.sic_mean.shape == (10, 10)
        assert (result.sic_mean >= 0).all()
        assert (result.sic_mean <= 1).all()

    def test_time_varying_sic(self, tmp_path):
        """SIC returns different fields at different times."""
        sic_file = tmp_path / "sic.nc"
        sic_data = _create_sic_netcdf(sic_file)

        adapter = SICAdapter(path=str(sic_file))
        grid = _make_grid_template()

        result_t0 = adapter.load(t_hours=0.0, grid_template=grid)
        result_t24 = adapter.load(t_hours=24.0, grid_template=grid)

        # Different time steps should have different SIC values
        assert not np.allclose(result_t0.sic_mean, result_t24.sic_mean)

    def test_unavailable_adapter(self):
        """Unavailable adapter returns NaN SIC (not zero — missing ≠ open water)."""
        adapter = SICAdapter(path="/nonexistent/sic.nc")
        assert not adapter.is_available()

        grid = _make_grid_template()
        result = adapter.load(t_hours=0.0, grid_template=grid)
        assert np.all(np.isnan(result.sic_mean))

    def test_sic_clipped_to_range(self, tmp_path):
        """SIC values outside [0, 1] are set to NaN (invalid, not silently clipped)."""
        sic_file = tmp_path / "sic.nc"
        # Create SIC with out-of-range values
        lat = np.linspace(-70, -69.5, 5)
        lon = np.linspace(72, 72.5, 5)
        ds = xr.Dataset(
            {"siconc": (["lat", "lon"], np.full((5, 5), 1.5))},
            coords={"lat": lat, "lon": lon},
        )
        ds.to_netcdf(str(sic_file))

        adapter = SICAdapter(path=str(sic_file))
        grid = _make_grid_template(n_rows=5, n_cols=5)
        result = adapter.load(t_hours=0.0, grid_template=grid)
        # Out-of-range values become NaN, not clipped
        assert np.all(np.isnan(result.sic_mean))


# ---------------------------------------------------------------------------
# CMEMS current adapter tests
# ---------------------------------------------------------------------------

class TestCMEMSCurrentAdapter:
    def test_load_current_grid(self, tmp_path):
        """CMEMS current adapter produces correct current_cost layer."""
        current_file = tmp_path / "current.nc"
        _create_current_netcdf(current_file)

        adapter = CMEMSCurrentAdapter(path=str(current_file))
        assert adapter.is_available()

        grid = _make_grid_template()
        result = adapter.load(t_hours=0.0, grid_template=grid)

        assert result.current_cost is not None
        assert result.current_cost.shape == (10, 10)
        assert (result.current_cost >= 0).all()  # speed is always >= 0

    def test_time_varying_current(self, tmp_path):
        """Current returns different fields at different times."""
        current_file = tmp_path / "current.nc"
        _create_current_netcdf(current_file)

        adapter = CMEMSCurrentAdapter(path=str(current_file))
        grid = _make_grid_template()

        result_t0 = adapter.load(t_hours=0.0, grid_template=grid)
        result_t24 = adapter.load(t_hours=24.0, grid_template=grid)

        assert not np.allclose(result_t0.current_cost, result_t24.current_cost)

    def test_unavailable_adapter(self):
        """Unavailable adapter returns zero current."""
        adapter = CMEMSCurrentAdapter(path="/nonexistent/current.nc")
        grid = _make_grid_template()
        result = adapter.load(t_hours=0.0, grid_template=grid)
        assert np.allclose(result.current_cost, 0.0)


# ---------------------------------------------------------------------------
# Iceberg adapter tests
# ---------------------------------------------------------------------------

class TestIcebergAdapter:
    def test_load_iceberg_netcdf(self, tmp_path):
        """Iceberg adapter loads risk from netCDF."""
        iceberg_file = tmp_path / "iceberg.nc"
        risk_data = _create_iceberg_netcdf(iceberg_file)

        adapter = IcebergAdapter(path=str(iceberg_file), variable="risk")
        grid = _make_grid_template()
        result = adapter.load(t_hours=0.0, grid_template=grid)

        assert result.iceberg_risk is not None
        assert result.iceberg_risk.shape == (10, 10)
        assert (result.iceberg_risk >= 0).all()
        assert (result.iceberg_risk <= 1).all()

    def test_load_iceberg_numpy(self, tmp_path):
        """Iceberg adapter loads risk from .npy file."""
        iceberg_file = tmp_path / "iceberg.npy"
        risk_data = np.random.RandomState(42).uniform(0.0, 0.5, (10, 10))
        np.save(str(iceberg_file), risk_data)

        adapter = IcebergAdapter(path=str(iceberg_file), is_numpy=True)
        grid = _make_grid_template()
        result = adapter.load(t_hours=0.0, grid_template=grid)

        assert result.iceberg_risk is not None
        np.testing.assert_allclose(result.iceberg_risk, risk_data, atol=1e-10)

    def test_unavailable_adapter(self):
        """Unavailable adapter returns zero risk."""
        adapter = IcebergAdapter(path="/nonexistent/iceberg.nc")
        grid = _make_grid_template()
        result = adapter.load(t_hours=0.0, grid_template=grid)
        assert np.allclose(result.iceberg_risk, 0.0)


# ---------------------------------------------------------------------------
# Wind adapter tests
# ---------------------------------------------------------------------------

class TestWindAdapter:
    def test_load_wind_grid(self, tmp_path):
        """Wind adapter produces correct wind_cost layer."""
        wind_file = tmp_path / "wind.nc"
        _create_wind_netcdf(wind_file)

        adapter = WindAdapter(path=str(wind_file))
        grid = _make_grid_template()
        result = adapter.load(t_hours=0.0, grid_template=grid)

        assert result.wind_cost is not None
        assert result.wind_cost.shape == (10, 10)
        assert (result.wind_cost >= 0).all()  # speed is always >= 0

    def test_unavailable_adapter(self):
        """Unavailable adapter returns zero wind."""
        adapter = WindAdapter(path="/nonexistent/wind.nc")
        grid = _make_grid_template()
        result = adapter.load(t_hours=0.0, grid_template=grid)
        assert np.allclose(result.wind_cost, 0.0)


# ---------------------------------------------------------------------------
# Bathymetry adapter tests
# ---------------------------------------------------------------------------

class TestBathymetryAdapter:
    def test_load_bathy_grid(self, tmp_path):
        """Bathymetry adapter updates navigability."""
        bathy_file = tmp_path / "bathy.nc"
        _create_bathy_netcdf(bathy_file)

        adapter = BathymetryAdapter(path=str(bathy_file), vessel_draft_m=6.5)
        grid = _make_grid_template()
        result = adapter.load(t_hours=0.0, grid_template=grid)

        # Shallow cells (depth > -6.5m) should be blocked
        assert not result.navigable[8, 0]  # depth = -3m, too shallow
        # Deep cells should remain navigable
        assert result.navigable[0, 0]  # depth ~ -250m, fine

    def test_unavailable_adapter(self):
        """Unavailable adapter does not change navigability."""
        adapter = BathymetryAdapter(path="/nonexistent/bathy.nc")
        grid = _make_grid_template()
        original_nav = grid.navigable.copy()
        result = adapter.load(t_hours=0.0, grid_template=grid)
        np.testing.assert_array_equal(result.navigable, original_nav)


# ---------------------------------------------------------------------------
# Builder tests
# ---------------------------------------------------------------------------

class TestBuilder:
    def test_build_env_fn_with_sic(self, tmp_path):
        """build_env_fn creates env_fn that supplies correct SIC at time t."""
        sic_file = tmp_path / "sic.nc"
        _create_sic_netcdf(sic_file)

        config = DataConfig(sic_path=str(sic_file))
        grid = _make_grid_template()
        env_fn = build_env_fn(config, grid)

        result = env_fn(t_hours=0.0)
        assert result.sic_mean is not None
        assert result.sic_mean.shape == (10, 10)

    def test_build_env_fn_time_varying(self, tmp_path):
        """env_fn returns different SIC at different times."""
        sic_file = tmp_path / "sic.nc"
        _create_sic_netcdf(sic_file)

        config = DataConfig(sic_path=str(sic_file))
        grid = _make_grid_template()
        env_fn = build_env_fn(config, grid)

        result_t0 = env_fn(0.0)
        result_t24 = env_fn(24.0)
        assert not np.allclose(result_t0.sic_mean, result_t24.sic_mean)

    def test_build_env_fn_all_adapters(self, tmp_path):
        """build_env_fn works with all adapters enabled."""
        sic_file = tmp_path / "sic.nc"
        current_file = tmp_path / "current.nc"
        iceberg_file = tmp_path / "iceberg.nc"
        wind_file = tmp_path / "wind.nc"

        _create_sic_netcdf(sic_file)
        _create_current_netcdf(current_file)
        _create_iceberg_netcdf(iceberg_file)
        _create_wind_netcdf(wind_file)

        config = DataConfig(
            sic_path=str(sic_file),
            current_path=str(current_file),
            iceberg_path=str(iceberg_file),
            wind_path=str(wind_file),
        )
        grid = _make_grid_template()
        env_fn = build_env_fn(config, grid)

        result = env_fn(0.0)
        assert result.sic_mean is not None
        assert result.current_cost is not None
        assert result.iceberg_risk is not None
        assert result.wind_cost is not None

    def test_build_from_adapters(self, tmp_path):
        """build_env_fn_from_adapters works with pre-configured adapters."""
        sic_file = tmp_path / "sic.nc"
        _create_sic_netcdf(sic_file)

        adapter = SICAdapter(path=str(sic_file))
        grid = _make_grid_template()
        env_fn = build_env_fn_from_adapters(grid, [adapter])

        result = env_fn(0.0)
        assert result.sic_mean is not None

    def test_env_fn_supplies_td_astar(self, tmp_path):
        """env_fn from builder works with td_astar."""
        sic_file = tmp_path / "sic.nc"
        _create_sic_netcdf(sic_file)

        config = DataConfig(sic_path=str(sic_file))
        grid = _make_grid_template()
        env_fn = build_env_fn(config, grid)

        result = td_astar(
            grid, (0, 0), (9, 9),
            env_fn=env_fn,
            weights=CostWeights(w_sic=1.0),
        )
        assert result.success


# ---------------------------------------------------------------------------
# Integration: M1-M4 routing still works
# ---------------------------------------------------------------------------

class TestIntegrationWithRouting:
    """Verify that data integration does not break existing M1-M4 routing."""

    def test_td_astar_still_works(self, tmp_path):
        """td_astar with no adapters (env_fn=None) still works."""
        grid = _make_grid_template()
        result = td_astar(grid, (0, 0), (9, 9))
        assert result.success

    def test_td_astar_with_sic_adapter(self, tmp_path):
        """td_astar with SIC adapter produces valid routes."""
        sic_file = tmp_path / "sic.nc"
        _create_sic_netcdf(sic_file)

        config = DataConfig(sic_path=str(sic_file))
        grid = _make_grid_template()
        env_fn = build_env_fn(config, grid)

        result = td_astar(
            grid, (0, 0), (9, 9),
            env_fn=env_fn,
            weights=CostWeights(w_sic=1.0, w_distance=1.0),
        )
        assert result.success
        assert result.total_cost > 0

    def test_multiple_time_steps(self, tmp_path):
        """Routing at different times produces different results when data changes."""
        sic_file = tmp_path / "sic.nc"
        _create_sic_netcdf(sic_file)

        config = DataConfig(sic_path=str(sic_file))
        grid = _make_grid_template()
        env_fn = build_env_fn(config, grid)

        r1 = td_astar(grid, (0, 0), (9, 9), env_fn=env_fn,
                       weights=CostWeights(w_sic=2.0), start_time=0.0)
        r2 = td_astar(grid, (0, 0), (9, 9), env_fn=env_fn,
                       weights=CostWeights(w_sic=2.0), start_time=24.0)

        assert r1.success and r2.success
        # Different start times → different SIC → different costs
        assert r1.total_cost != r2.total_cost


# ---------------------------------------------------------------------------
# CMEMS real-format validation (M4.6)
# ---------------------------------------------------------------------------

def _create_cmems_realistic_netcdf(
    path, n_lat=12, n_lon=16, n_time=4, n_depth=1, seed=42,
):
    """
    Create a synthetic netCDF mimicking real CMEMS current format.

    Real CMEMS uses:
        - "latitude"/"longitude" (not "lat"/"lon")
        - datetime64 time coordinates
        - depth dimension with levels
        - uo/vo in m/s with _FillValue for masked points
    """
    import pandas as pd
    rng = np.random.RandomState(seed)

    # Real CMEMS-like coordinates
    latitude = np.linspace(-70.0, -64.0, n_lat)
    longitude = np.linspace(70.0, 80.0, n_lon)
    time = pd.date_range("2025-01-01", periods=n_time, freq="6h")
    depth = np.array([0.494])  # CMEMS surface depth in meters

    # uo/vo with some NaN values (like real masked data)
    uo_raw = rng.uniform(-0.15, 0.25, (n_time, n_depth, n_lat, n_lon))
    vo_raw = rng.uniform(-0.15, 0.25, (n_time, n_depth, n_lat, n_lon))

    # Add some NaN values (simulating land masking)
    mask = rng.random((n_lat, n_lon)) < 0.05  # 5% masked
    uo_raw[:, :, mask] = np.nan
    vo_raw[:, :, mask] = np.nan

    ds = xr.Dataset(
        {
            "uo": (["time", "depth", "latitude", "longitude"], uo_raw),
            "vo": (["time", "depth", "latitude", "longitude"], vo_raw),
        },
        coords={
            "time": time,
            "depth": depth,
            "latitude": latitude,
            "longitude": longitude,
        },
        attrs={
            "title": "Synthetic CMEMS-like current data",
            "Conventions": "CF-1.6",
        },
    )
    # Add CMEMS-style attributes
    ds["uo"].attrs = {"units": "m s-1", "_FillValue": np.nan}
    ds["vo"].attrs = {"units": "m s-1", "_FillValue": np.nan}

    ds.to_netcdf(str(path))
    return uo_raw, vo_raw, latitude, longitude


class TestCMEMSRealFormat:
    """M4.6: Validate adapter handles real CMEMS format (latitude/longitude naming)."""

    def test_cmems_latitude_longitude_naming(self, tmp_path):
        """Adapter correctly reads CMEMS files with latitude/longitude dims."""
        nc_file = tmp_path / "cmems_current.nc"
        _create_cmems_realistic_netcdf(nc_file)

        adapter = CMEMSCurrentAdapter(path=str(nc_file))
        grid = _make_grid_template(n_rows=12, n_cols=16)
        result = adapter.load(t_hours=0.0, grid_template=grid)

        assert result.current_cost is not None
        assert result.current_cost.shape == (12, 16)
        assert (result.current_cost >= 0).all()
        assert np.all(np.isfinite(result.current_cost))

    def test_cmems_nan_handling(self, tmp_path):
        """NaN values in uo/vo are treated as zero current."""
        nc_file = tmp_path / "cmems_nan.nc"

        latitude = np.linspace(-70, -69, 5)
        longitude = np.linspace(72, 73, 5)
        time = np.arange(1) * 24.0

        # Create data with known NaN positions
        uo = np.full((1, 1, 5, 5), 0.1)
        vo = np.full((1, 1, 5, 5), 0.1)
        uo[0, 0, 2, 2] = np.nan  # known NaN
        vo[0, 0, 2, 2] = np.nan

        ds = xr.Dataset(
            {
                "uo": (["time", "depth", "latitude", "longitude"], uo),
                "vo": (["time", "depth", "latitude", "longitude"], vo),
            },
            coords={
                "time": time,
                "depth": [0.5],
                "latitude": latitude,
                "longitude": longitude,
            },
        )
        ds.to_netcdf(str(nc_file))

        adapter = CMEMSCurrentAdapter(path=str(nc_file))
        grid = _make_grid_template(n_rows=5, n_cols=5)
        result = adapter.load(t_hours=0.0, grid_template=grid)

        # NaN cell should become 0 speed
        assert result.current_cost[2, 2] == 0.0
        # Non-NaN cells should have positive speed
        assert result.current_cost[0, 0] > 0.0
        assert np.all(np.isfinite(result.current_cost))

    def test_cmems_datetime64_time(self, tmp_path):
        """Adapter handles datetime64 time coordinates."""
        nc_file = tmp_path / "cmems_time.nc"
        _create_cmems_realistic_netcdf(nc_file, n_time=4)

        adapter = CMEMSCurrentAdapter(path=str(nc_file))
        grid = _make_grid_template(n_rows=12, n_cols=16)

        # t_hours=0 should select the first time step
        result_t0 = adapter.load(t_hours=0.0, grid_template=grid)
        # t_hours=18 should select a later time step
        result_t18 = adapter.load(t_hours=18.0, grid_template=grid)

        assert result_t0.current_cost is not None
        assert result_t18.current_cost is not None
        # Different time steps should yield different current fields
        assert not np.allclose(result_t0.current_cost, result_t18.current_cost)

    def test_cmems_speed_always_nonnegative(self, tmp_path):
        """Current speed sqrt(uo^2+vo^2) is always >= 0."""
        nc_file = tmp_path / "cmems_sign.nc"

        latitude = np.linspace(-70, -69, 5)
        longitude = np.linspace(72, 73, 5)

        # uo positive, vo negative (mixed directions)
        uo = np.array([[[[0.1, -0.2, 0.3, -0.4, 0.5] * 5]]])
        vo = np.array([[[[-0.1, 0.2, -0.3, 0.4, -0.5] * 5]]])
        uo = uo.reshape(1, 1, 5, 5)
        vo = vo.reshape(1, 1, 5, 5)

        ds = xr.Dataset(
            {
                "uo": (["time", "depth", "latitude", "longitude"], uo),
                "vo": (["time", "depth", "latitude", "longitude"], vo),
            },
            coords={
                "time": [0.0],
                "depth": [0.5],
                "latitude": latitude,
                "longitude": longitude,
            },
        )
        ds.to_netcdf(str(nc_file))

        adapter = CMEMSCurrentAdapter(path=str(nc_file))
        grid = _make_grid_template(n_rows=5, n_cols=5)
        result = adapter.load(t_hours=0.0, grid_template=grid)

        assert (result.current_cost >= 0).all()

    def test_cmems_subset_selection(self, tmp_path):
        """Adapter selects a spatial subset correctly."""
        nc_file = tmp_path / "cmems_subset.nc"

        # Create a larger grid
        latitude = np.linspace(-75, -60, 30)
        longitude = np.linspace(60, 90, 40)
        time = [0.0]

        rng = np.random.RandomState(42)
        uo = rng.uniform(-0.1, 0.2, (1, 1, 30, 40))
        vo = rng.uniform(-0.1, 0.2, (1, 1, 30, 40))

        ds = xr.Dataset(
            {
                "uo": (["time", "depth", "latitude", "longitude"], uo),
                "vo": (["time", "depth", "latitude", "longitude"], vo),
            },
            coords={
                "time": time,
                "depth": [0.5],
                "latitude": latitude,
                "longitude": longitude,
            },
        )
        ds.to_netcdf(str(nc_file))

        adapter = CMEMSCurrentAdapter(path=str(nc_file))
        # Template grid covers only a subset of the CMEMS domain
        grid = _make_grid_template(n_rows=10, n_cols=12)
        result = adapter.load(t_hours=0.0, grid_template=grid)

        assert result.current_cost.shape == (10, 12)
        assert np.all(np.isfinite(result.current_cost))


class TestM46IntegrationWithRouting:
    """M4.6: Verify CMEMS-format data reaches td_astar correctly."""

    def test_td_astar_with_cmems_current(self, tmp_path):
        """td_astar with real-format CMEMS data produces valid routes."""
        nc_file = tmp_path / "cmems_routing.nc"
        _create_cmems_realistic_netcdf(nc_file, n_lat=10, n_lon=10)

        config = DataConfig(current_path=str(nc_file))
        grid = _make_grid_template(n_rows=10, n_cols=10)
        env_fn = build_env_fn(config, grid)

        result = td_astar(
            grid, (0, 0), (9, 9),
            env_fn=env_fn,
            weights=CostWeights(w_curr=1.0, w_distance=1.0),
        )
        assert result.success
        assert result.total_cost > 0

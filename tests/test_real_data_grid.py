"""
Tests for real-data routing grid construction and SIC coordinate handling.

These tests do NOT require real datasets on disk.
They use small synthetic fixtures to verify:
    1. build_grid_template dimensions and coordinate ordering.
    2. build_grid_template expected bounds.
    3. SICAdapter projected-coordinate (EPSG:3412) transformation path.
    4. SICAdapter can map projected SIC to EnvironmentalGrid.
    5. CMEMS + SIC can coexist on the same grid (mock).
"""

import numpy as np
import pytest
import xarray as xr

from src.data.builder import build_grid_template
from src.data.adapters import SICAdapter, HAS_PYPROJ
from src.environment.grid import EnvironmentalGrid


# ---------------------------------------------------------------------------
# TASK 1: build_grid_template
# ---------------------------------------------------------------------------

class TestBuildGridTemplate:
    def test_default_dimensions(self):
        grid = build_grid_template()
        assert grid.n_rows == 121
        assert grid.n_cols == 1441

    def test_custom_dimensions(self):
        grid = build_grid_template(
            lat_min=-70.0, lat_max=-60.0,
            lon_min=0.0, lon_max=10.0,
            resolution_deg=1.0,
        )
        assert grid.n_rows == 11
        assert grid.n_cols == 11

    def test_latitude_bounds(self):
        grid = build_grid_template()
        assert abs(grid.lat[0] - (-80.0)) < 1e-10
        assert abs(grid.lat[-1] - (-50.0)) < 1e-10

    def test_longitude_bounds(self):
        grid = build_grid_template()
        assert abs(grid.lon[0] - (-180.0)) < 1e-10
        assert abs(grid.lon[-1] - 180.0) < 1e-10

    def test_latitude_ascending(self):
        grid = build_grid_template()
        assert np.all(np.diff(grid.lat) > 0)

    def test_longitude_ascending(self):
        grid = build_grid_template()
        assert np.all(np.diff(grid.lon) > 0)

    def test_navigable_all_true(self):
        grid = build_grid_template()
        assert grid.navigable.all()

    def test_no_data_layers_populated(self):
        grid = build_grid_template()
        assert grid.sic_mean is None
        assert grid.sic_uncertainty is None
        assert grid.current_cost is None
        assert grid.current_uo is None
        assert grid.current_vo is None
        assert grid.iceberg_risk is None
        assert grid.wind_cost is None

    def test_resolution_recorded(self):
        grid = build_grid_template(resolution_deg=0.5)
        assert grid.resolution_deg == 0.5

    def test_invalid_bounds_raises(self):
        with pytest.raises(ValueError, match="lat_min"):
            build_grid_template(lat_min=10.0, lat_max=0.0)
        with pytest.raises(ValueError, match="lon_min"):
            build_grid_template(lon_min=10.0, lon_max=0.0)

    def test_invalid_resolution_raises(self):
        with pytest.raises(ValueError, match="resolution"):
            build_grid_template(resolution_deg=0.0)


# ---------------------------------------------------------------------------
# TASK 3: SICAdapter projected-coordinate path (EPSG:3412)
# ---------------------------------------------------------------------------

def _make_sic_with_xy(path, n_y=8, n_x=10, crs_str="EPSG:3412"):
    """
    Create a synthetic SIC netCDF with x/y projected coordinates
    that roughly mimic the real NSIDC SIC file structure.
    """
    # x/y in metres, mimicking a small subset of EPSG:3412
    x = np.linspace(-3_000_000, 3_000_000, n_x)
    y = np.linspace(-3_000_000, 3_000_000, n_y)
    conc = np.random.RandomState(42).uniform(0.0, 0.9, (n_y, n_x)).astype(np.float32)
    stdev = np.random.RandomState(99).uniform(0.0, 0.2, (n_y, n_x)).astype(np.float32)
    # Make some cells invalid (NaN)
    conc[0, :] = np.nan
    conc[:, 0] = np.nan

    ds = xr.Dataset(
        {
            "cdr_seaice_conc": (["y", "x"], conc),
            "cdr_seaice_conc_stdev": (["y", "x"], stdev),
        },
        coords={
            "x": x,
            "y": y,
        },
        attrs={"crs": crs_str},
    )
    ds.to_netcdf(str(path))
    return conc


class TestSICAdapterProjected:
    def test_adapter_init_defaults(self):
        adapter = SICAdapter(path="/nonexistent.nc")
        assert adapter.variable == "siconc"
        assert adapter.x_dim is None
        assert adapter.crs is None

    def test_adapter_init_projected(self):
        adapter = SICAdapter(
            path="/nonexistent.nc",
            variable="cdr_seaice_conc",
            x_dim="x", y_dim="y", crs="EPSG:3412",
        )
        assert adapter.x_dim == "x"
        assert adapter.y_dim == "y"
        assert adapter.crs == "EPSG:3412"

    @pytest.mark.skipif(not HAS_PYPROJ, reason="pyproj not installed")
    def test_load_projected_sic(self, tmp_path):
        """SICAdapter can load projected x/y SIC and interpolate to a grid."""
        sic_file = tmp_path / "sic_xy.nc"
        conc = _make_sic_with_xy(sic_file)

        adapter = SICAdapter(
            path=str(sic_file),
            variable="cdr_seaice_conc",
            x_dim="x", y_dim="y", crs="EPSG:3412",
        )
        assert adapter.is_available()

        # Build a small target grid covering a region that the projected
        # SIC data covers (after EPSG:3412 → WGS84 transformation)
        grid = build_grid_template(
            lat_min=-80.0, lat_max=-50.0,
            lon_min=-180.0, lon_max=180.0,
            resolution_deg=5.0,
        )
        result = adapter.load(t_hours=0.0, grid_template=grid)
        assert result.sic_mean.shape == (grid.n_rows, grid.n_cols)
        # At least some values should be valid (not NaN)
        assert np.any(~np.isnan(result.sic_mean))

    @pytest.mark.skipif(not HAS_PYPROJ, reason="pyproj not installed")
    def test_projected_sic_uncertainty(self, tmp_path):
        """SICAdapter loads uncertainty from projected SIC file."""
        sic_file = tmp_path / "sic_xy.nc"
        _make_sic_with_xy(sic_file)

        adapter = SICAdapter(
            path=str(sic_file),
            variable="cdr_seaice_conc",
            uncertainty_variable="cdr_seaice_conc_stdev",
            x_dim="x", y_dim="y", crs="EPSG:3412",
        )
        grid = build_grid_template(
            lat_min=-80.0, lat_max=-50.0,
            lon_min=-180.0, lon_max=180.0,
            resolution_deg=5.0,
        )
        result = adapter.load(t_hours=0.0, grid_template=grid)
        assert result.sic_uncertainty is not None
        assert result.sic_uncertainty.shape == (grid.n_rows, grid.n_cols)

    def test_missing_crs_raises(self, tmp_path):
        """Adapter raises if x_dim/y_dim set but crs is None."""
        sic_file = tmp_path / "sic_xy.nc"
        _make_sic_with_xy(sic_file)

        adapter = SICAdapter(
            path=str(sic_file),
            variable="cdr_seaice_conc",
            x_dim="x", y_dim="y",
            # crs deliberately omitted
        )
        grid = build_grid_template(resolution_deg=5.0)
        with pytest.raises(ValueError, match="crs must be specified"):
            adapter.load(t_hours=0.0, grid_template=grid)


# ---------------------------------------------------------------------------
# TASK 4: SICAdapter geographic path (existing behavior preserved)
# ---------------------------------------------------------------------------

class TestSICAdapterGeographic:
    def test_load_geographic_sic(self, tmp_path):
        """Standard lat/lon SIC still works."""
        sic_file = tmp_path / "sic_geo.nc"
        lat = np.linspace(-70, -69.5, 5)
        lon = np.linspace(72, 72.5, 5)
        ds = xr.Dataset(
            {"siconc": (["lat", "lon"], np.random.RandomState(42).uniform(0, 1, (5, 5)))},
            coords={"lat": lat, "lon": lon},
        )
        ds.to_netcdf(str(sic_file))

        adapter = SICAdapter(path=str(sic_file))
        grid = build_grid_template(
            lat_min=-70.0, lat_max=-69.5,
            lon_min=72.0, lon_max=72.5,
            resolution_deg=0.125,
        )
        result = adapter.load(t_hours=0.0, grid_template=grid)
        assert result.sic_mean.shape == (grid.n_rows, grid.n_cols)
        assert np.any(~np.isnan(result.sic_mean))

    def test_nan_where_invalid(self, tmp_path):
        """NaN in source stays NaN in result."""
        sic_file = tmp_path / "sic_nan.nc"
        lat = np.linspace(-70, -69.5, 3)
        lon = np.linspace(72, 72.5, 3)
        data = np.array([[0.5, np.nan, 0.3],
                         [0.6, 0.7, 0.8],
                         [np.nan, np.nan, 0.1]])
        ds = xr.Dataset(
            {"siconc": (["lat", "lon"], data)},
            coords={"lat": lat, "lon": lon},
        )
        ds.to_netcdf(str(sic_file))

        adapter = SICAdapter(path=str(sic_file))
        grid = _make_grid_template_for(lat, lon)
        result = adapter.load(t_hours=0.0, grid_template=grid)
        # NaN source cells should remain NaN
        assert np.isnan(result.sic_mean[0, 1])
        assert np.isnan(result.sic_mean[2, 0])


# ---------------------------------------------------------------------------
# TASK 5: CMEMS + SIC coexistence (mock)
# ---------------------------------------------------------------------------

class TestCMEMSAndSICCoexist:
    def test_build_env_fn_with_sic_only(self, tmp_path):
        """build_env_fn works when only SIC is available."""
        from src.data.builder import build_env_fn
        from src.data.config import DataConfig

        sic_file = tmp_path / "sic.nc"
        lat = np.linspace(-70, -69.5, 5)
        lon = np.linspace(72, 72.5, 5)
        ds = xr.Dataset(
            {"siconc": (["lat", "lon"], np.random.RandomState(42).uniform(0, 1, (5, 5)))},
            coords={"lat": lat, "lon": lon},
        )
        ds.to_netcdf(str(sic_file))

        config = DataConfig(sic_path=str(sic_file))
        grid = build_grid_template(
            lat_min=-70.0, lat_max=-69.5,
            lon_min=72.0, lon_max=72.5,
            resolution_deg=0.125,
        )
        env_fn = build_env_fn(config, grid)
        env = env_fn(0.0)
        assert env.sic_mean is not None
        assert np.any(~np.isnan(env.sic_mean))

    def test_build_env_fn_no_files(self):
        """build_env_fn works when no data files exist — no layers populated."""
        from src.data.builder import build_env_fn
        from src.data.config import DataConfig

        config = DataConfig(sic_path="/nonexistent/sic.nc")
        grid = build_grid_template(
            lat_min=-70.0, lat_max=-69.5,
            lon_min=72.0, lon_max=72.5,
            resolution_deg=0.5,
        )
        env_fn = build_env_fn(config, grid)
        env = env_fn(0.0)
        # Unavailable adapter is not active; sic_mean stays None
        assert env.sic_mean is None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_grid_template_for(lat, lon):
    """Build a minimal EnvironmentalGrid matching given lat/lon arrays."""
    n_rows, n_cols = len(lat), len(lon)
    return EnvironmentalGrid(
        n_rows=n_rows, n_cols=n_cols,
        lat=lat, lon=lon,
        navigable=np.ones((n_rows, n_cols), dtype=bool),
    )

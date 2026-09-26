"""
SIC Forecaster Adapter Tests
=============================

Focused tests for loading and mapping the teammate's SIC forecast
.npy files into EnvironmentalGrid-compatible layers.

Tests cover:
- File loading and shape validation
- Time index lookup (hours → date)
- Grid mapping (identity and different grids)
- NaN preservation for invalid/missing data
- Extension band NaN handling
- Date range properties
"""

from __future__ import annotations

import os
from datetime import datetime, timezone, timedelta
from pathlib import Path

import numpy as np
import pytest

from src.data.adapters import SICForecasterAdapter
from src.data.builder import build_grid_template

# ---------------------------------------------------------------------------
# Path to forecaster cache (may not exist in CI)
# ---------------------------------------------------------------------------
CACHE_DIR = Path(__file__).resolve().parent.parent / "backend" / "cache"
HAS_FORECASTER = (
    CACHE_DIR.exists()
    and (CACHE_DIR / "routing_sic_2026.npy").exists()
    and (CACHE_DIR / "routing_lat.npy").exists()
    and (CACHE_DIR / "routing_lon.npy").exists()
    and (CACHE_DIR / "dates_2026.npy").exists()
)

pytestmark = pytest.mark.skipif(
    not HAS_FORECASTER,
    reason="SIC forecaster .npy files not found in backend/cache",
)


# ---------------------------------------------------------------------------
# Basic loading
# ---------------------------------------------------------------------------

class TestForecasterLoad:
    """Test basic file loading and shape validation."""

    def test_loaded_shape(self):
        sic = np.load(str(CACHE_DIR / "routing_sic_2026.npy"))
        lat = np.load(str(CACHE_DIR / "routing_lat.npy"))
        lon = np.load(str(CACHE_DIR / "routing_lon.npy"))
        dates = np.load(str(CACHE_DIR / "dates_2026.npy"), allow_pickle=True)

        assert sic.ndim == 3
        assert sic.shape == (len(dates), len(lat), len(lon))
        assert sic.dtype == np.float32

    def test_lat_ascending(self):
        lat = np.load(str(CACHE_DIR / "routing_lat.npy"))
        assert np.all(np.diff(lat) > 0)

    def test_lon_ascending(self):
        lon = np.load(str(CACHE_DIR / "routing_lon.npy"))
        assert np.all(np.diff(lon) > 0)

    def test_dates_ascending(self):
        dates = np.load(str(CACHE_DIR / "dates_2026.npy"), allow_pickle=True)
        assert np.all(np.diff(dates.astype("datetime64[ns]")) >= np.timedelta64(0, "ns"))

    def test_sic_range_0_1(self):
        sic = np.load(str(CACHE_DIR / "routing_sic_2026.npy"))
        valid = sic[~np.isnan(sic)]
        assert float(np.nanmin(valid)) >= 0.0
        assert float(np.nanmax(valid)) <= 1.0 + 1e-6


# ---------------------------------------------------------------------------
# Adapter init & properties
# ---------------------------------------------------------------------------

class TestForecasterAdapterInit:
    """Test adapter initialization and properties."""

    def test_init_with_cache_dir(self):
        adapter = SICForecasterAdapter(
            cache_dir=str(CACHE_DIR),
            route_start_datetime=datetime(2026, 1, 6, tzinfo=timezone.utc),
        )
        assert adapter.is_available()

    def test_init_without_cache_dir(self):
        adapter = SICForecasterAdapter(cache_dir=None)
        assert not adapter.is_available()

    def test_n_time_steps(self):
        adapter = SICForecasterAdapter(
            cache_dir=str(CACHE_DIR),
            route_start_datetime=datetime(2026, 1, 6, tzinfo=timezone.utc),
        )
        assert adapter.n_time_steps == 167

    def test_date_range(self):
        adapter = SICForecasterAdapter(
            cache_dir=str(CACHE_DIR),
            route_start_datetime=datetime(2026, 1, 6, tzinfo=timezone.utc),
        )
        first, last = adapter.date_range
        assert first.year == 2026
        assert first.month == 1
        assert first.day == 6
        assert last.year == 2026
        assert last.month == 6
        assert last.day == 21


# ---------------------------------------------------------------------------
# Time index lookup
# ---------------------------------------------------------------------------

class TestTimeIndexLookup:
    """Test t_hours → time index conversion."""

    def _make_adapter(self, start_dt):
        return SICForecasterAdapter(
            cache_dir=str(CACHE_DIR),
            route_start_datetime=start_dt,
        )

    def test_t0_maps_to_first_date(self):
        adapter = self._make_adapter(datetime(2026, 1, 6, tzinfo=timezone.utc))
        idx = adapter._t_hours_to_time_index(0.0)
        assert idx == 0

    def test_t24_maps_to_second_date(self):
        adapter = self._make_adapter(datetime(2026, 1, 6, tzinfo=timezone.utc))
        idx = adapter._t_hours_to_time_index(24.0)
        assert idx == 1

    def test_t166_days_maps_to_last_date(self):
        adapter = self._make_adapter(datetime(2026, 1, 6, tzinfo=timezone.utc))
        idx = adapter._t_hours_to_time_index(166 * 24.0)
        assert idx == 166

    def test_missing_start_datetime_raises(self):
        adapter = SICForecasterAdapter(cache_dir=str(CACHE_DIR))
        with pytest.raises(ValueError, match="route_start_datetime"):
            adapter._t_hours_to_time_index(0.0)


# ---------------------------------------------------------------------------
# Load into grid
# ---------------------------------------------------------------------------

class TestForecasterLoadGrid:
    """Test load() populates EnvironmentalGrid correctly."""

    def _make_adapter(self, start_dt=None):
        if start_dt is None:
            start_dt = datetime(2026, 1, 6, tzinfo=timezone.utc)
        return SICForecasterAdapter(
            cache_dir=str(CACHE_DIR),
            route_start_datetime=start_dt,
        )

    def _target_grid(self, lat_min=-75.0, lat_max=-32.0,
                     lon_min=-10.0, lon_max=82.0, res=0.25):
        return build_grid_template(
            lat_min=lat_min, lat_max=lat_max,
            lon_min=lon_min, lon_max=lon_max,
            resolution_deg=res,
        )

    def test_load_identity_grid(self):
        adapter = self._make_adapter()
        grid = self._target_grid()
        result = adapter.load(0.0, grid)
        assert result.sic_mean is not None
        assert result.sic_mean.shape == (grid.n_rows, grid.n_cols)
        valid = result.sic_mean[~np.isnan(result.sic_mean)]
        assert len(valid) > 0

    def test_load_smaller_grid(self):
        adapter = self._make_adapter()
        grid = self._target_grid(lat_min=-65.0, lat_max=-55.0,
                                 lon_min=0.0, lon_max=50.0)
        result = adapter.load(0.0, grid)
        assert result.sic_mean.shape == (grid.n_rows, grid.n_cols)
        valid = result.sic_mean[~np.isnan(result.sic_mean)]
        assert len(valid) > 0

    def test_nan_for_out_of_domain(self):
        adapter = self._make_adapter()
        # Grid outside forecaster domain (lat -10..10 is way north)
        grid = self._target_grid(lat_min=-10.0, lat_max=10.0,
                                 lon_min=0.0, lon_max=10.0, res=1.0)
        result = adapter.load(0.0, grid)
        assert np.all(np.isnan(result.sic_mean))

    def test_sic_uncertainty_not_set(self):
        adapter = self._make_adapter()
        grid = self._target_grid()
        result = adapter.load(0.0, grid)
        assert result.sic_uncertainty is None

    def test_no_cache_dir_fills_nan(self):
        adapter = SICForecasterAdapter(cache_dir=None)
        grid = self._target_grid()
        result = adapter.load(0.0, grid)
        assert np.all(np.isnan(result.sic_mean))

    def test_get_forecaster_grid(self):
        adapter = self._make_adapter()
        fg = adapter.get_forecaster_grid()
        assert fg.n_rows == 173
        assert fg.n_cols == 369
        assert abs(fg.lat[0] - (-75.0)) < 0.01
        assert abs(fg.lat[-1] - (-32.0)) < 0.01


# ---------------------------------------------------------------------------
# NaN preservation
# ---------------------------------------------------------------------------

class TestForecasterNaNPreservation:
    """Test that NaN in source data is preserved."""

    def test_nan_cells_preserved(self):
        adapter = SICForecasterAdapter(
            cache_dir=str(CACHE_DIR),
            route_start_datetime=datetime(2026, 1, 6, tzinfo=timezone.utc),
        )
        sic_raw = np.load(str(CACHE_DIR / "routing_sic_2026.npy"))
        # There are NaN cells in the raw data
        assert np.any(np.isnan(sic_raw[0]))

        grid = adapter.get_forecaster_grid()
        result = adapter.load(0.0, grid)
        assert result.sic_mean.shape == (173, 369)
        # NaN count should match (roughly — nearest interp preserves NaN)
        raw_nan_count = np.sum(np.isnan(sic_raw[0]))
        result_nan_count = np.sum(np.isnan(result.sic_mean))
        # Allow some difference due to interpolation at boundaries
        assert result_nan_count >= raw_nan_count * 0.8


# ---------------------------------------------------------------------------
# Extension band NaN handling
# ---------------------------------------------------------------------------

class TestExtensionBandNaN:
    """Test that extension band columns in model band are NaN."""

    def test_model_band_extension_cols_are_nan(self):
        """In model band (rows 0:101), cols 361:369 (lon 80.25..82) are NaN."""
        adapter = SICForecasterAdapter(
            cache_dir=str(CACHE_DIR),
            route_start_datetime=datetime(2026, 1, 6, tzinfo=timezone.utc),
        )
        sic_raw = np.load(str(CACHE_DIR / "routing_sic_2026.npy"))
        # Model band rows, extension cols
        model_ext = sic_raw[0, 0:101, 361:369]
        # Should be NaN (outside model domain)
        assert np.all(np.isnan(model_ext))

    def test_extension_band_has_valid_data(self):
        """Extension band (rows 101:173) has some valid data."""
        sic_raw = np.load(str(CACHE_DIR / "routing_sic_2026.npy"))
        ext_band = sic_raw[0, 101:173, :]
        valid = ext_band[~np.isnan(ext_band)]
        # Extension band should have some valid values
        assert len(valid) > 0

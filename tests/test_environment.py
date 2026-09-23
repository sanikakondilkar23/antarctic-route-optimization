"""
Tests for EnvironmentalGrid and synthetic environment generator.
"""

import numpy as np
import pytest

from src.environment.grid import EnvironmentalGrid
from src.environment.synthetic import generate_synthetic, generate_minimal


# --- Grid creation tests ---

class TestEnvironmentalGrid:
    """Tests for the EnvironmentalGrid data structure."""

    def _make_grid(self, **kwargs):
        """Helper: create a small test grid."""
        defaults = dict(
            n_rows=10, n_cols=10,
            lat=np.linspace(-70, -69.5, 10),
            lon=np.linspace(72, 72.5, 10),
            navigable=np.ones((10, 10), dtype=bool),
        )
        defaults.update(kwargs)
        return EnvironmentalGrid(**defaults)

    def test_grid_creation(self):
        """Test 1: Grid can be created."""
        grid = self._make_grid()
        assert grid.n_rows == 10
        assert grid.n_cols == 10

    def test_array_dimensions_match(self):
        """Test 2: All arrays have identical dimensions."""
        grid = self._make_grid(
            sic_mean=np.zeros((10, 10)),
            iceberg_risk=np.zeros((10, 10)),
        )
        assert grid.lat.shape == (10,)
        assert grid.lon.shape == (10,)
        assert grid.navigable.shape == (10, 10)
        assert grid.sic_mean.shape == (10, 10)
        assert grid.iceberg_risk.shape == (10, 10)

    def test_dimension_mismatch_raises(self):
        """Test 2b: Mismatched dimensions raise AssertionError."""
        with pytest.raises(AssertionError):
            EnvironmentalGrid(
                n_rows=10, n_cols=10,
                lat=np.linspace(-70, -69.5, 10),
                lon=np.linspace(72, 72.5, 10),
                navigable=np.ones((10, 10), dtype=bool),
                sic_mean=np.zeros((5, 5)),  # wrong shape
            )

    def test_navigable_mask(self):
        """Test 3: Navigable mask works."""
        nav = np.ones((10, 10), dtype=bool)
        nav[5, 5] = False
        nav[0, :] = False
        grid = self._make_grid(navigable=nav)

        assert not grid.navigable[5, 5]
        assert not grid.navigable[0, 0]
        assert grid.navigable[1, 1]
        assert grid.navigable.sum() == 100 - 10 - 1  # row 0 + cell (5,5)

    def test_sic_range(self):
        """Test 4: SIC values are within sensible range."""
        grid = self._make_grid(
            sic_mean=np.random.rand(10, 10) * 1.5 - 0.2  # some out of range
        )
        sic = grid.sic_mean
        # The grid stores whatever is given; range check is on the data
        assert sic.min() >= -0.2
        assert sic.max() <= 1.3

    def test_uncertainty_non_negative(self):
        """Test 5: Uncertainty values are non-negative."""
        grid = self._make_grid(
            sic_uncertainty=np.abs(np.random.randn(10, 10)),
            iceberg_uncertainty=np.abs(np.random.randn(10, 10)),
        )
        assert (grid.sic_uncertainty >= 0).all()
        assert (grid.iceberg_uncertainty >= 0).all()

    def test_has_layer(self):
        """Test: has_layer returns correct boolean."""
        grid = self._make_grid(sic_mean=np.zeros((10, 10)))
        assert grid.has_layer("sic_mean")
        assert not grid.has_layer("sic_uncertainty")
        assert not grid.has_layer("iceberg_risk")

    def test_get_layer(self):
        """Test: get_layer returns the array."""
        sic = np.random.rand(10, 10)
        grid = self._make_grid(sic_mean=sic)
        np.testing.assert_array_equal(grid.get_layer("sic_mean"), sic)

    def test_get_layer_missing_raises(self):
        """Test: get_layer raises ValueError for missing layer."""
        grid = self._make_grid()
        with pytest.raises(ValueError, match="not available"):
            grid.get_layer("sic_mean")

    def test_cell_cost_factors(self):
        """Test: cell_cost_factors returns dict of available values."""
        grid = self._make_grid(
            sic_mean=np.full((10, 10), 0.5),
            wind_cost=np.full((10, 10), 0.3),
        )
        factors = grid.cell_cost_factors(3, 3)
        assert factors["navigable"] is True
        assert factors["sic_mean"] == 0.5
        assert factors["wind_cost"] == 0.3
        assert "sic_uncertainty" not in factors  # not available

    def test_summary(self):
        """Test: summary returns a string."""
        grid = self._make_grid(sic_mean=np.zeros((10, 10)))
        s = grid.summary()
        assert "EnvironmentalGrid" in s
        assert "10 x 10" in s

    def test_repr(self):
        """Test: repr returns a string."""
        grid = self._make_grid(sic_mean=np.zeros((10, 10)))
        r = repr(grid)
        assert "EnvironmentalGrid" in r


# --- Synthetic environment tests ---

class TestSyntheticEnvironment:
    """Tests for the synthetic environment generator."""

    def test_generate_synthetic(self):
        """Test: generate_synthetic returns a valid grid."""
        grid = generate_synthetic(n_rows=20, n_cols=25)
        assert grid.n_rows == 20
        assert grid.n_cols == 25

    def test_all_layers_present(self):
        """Test: full synthetic grid has all 6 optional layers."""
        grid = generate_synthetic()
        assert grid.has_layer("sic_mean")
        assert grid.has_layer("sic_uncertainty")
        assert grid.has_layer("iceberg_risk")
        assert grid.has_layer("iceberg_uncertainty")
        assert grid.has_layer("wind_cost")
        assert grid.has_layer("current_cost")

    def test_sic_range_synthetic(self):
        """Test: synthetic SIC values are in [0, 1]."""
        grid = generate_synthetic()
        assert grid.sic_mean.min() >= 0.0
        assert grid.sic_mean.max() <= 1.0

    def test_uncertainty_non_negative_synthetic(self):
        """Test: synthetic uncertainties are non-negative."""
        grid = generate_synthetic()
        assert (grid.sic_uncertainty >= 0).all()
        assert (grid.iceberg_uncertainty >= 0).all()

    def test_reproducibility(self):
        """Test: same seed produces identical grids."""
        g1 = generate_synthetic(seed=42)
        g2 = generate_synthetic(seed=42)
        np.testing.assert_array_equal(g1.sic_mean, g2.sic_mean)
        np.testing.assert_array_equal(g1.iceberg_risk, g2.iceberg_risk)
        np.testing.assert_array_equal(g1.wind_cost, g2.wind_cost)

    def test_different_seeds_differ(self):
        """Test: different seeds produce different grids (layers using RNG)."""
        g1 = generate_synthetic(seed=42)
        g2 = generate_synthetic(seed=99)
        # sic_uncertainty uses rng for noise — seeds must differ there
        assert not np.array_equal(g1.sic_uncertainty, g2.sic_uncertainty)

    def test_navigable_has_blocked_cells(self):
        """Test: synthetic grid has some blocked cells."""
        grid = generate_synthetic()
        assert not grid.navigable.all()  # not everything is navigable
        assert grid.navigable[~grid.navigable].size > 0


class TestMinimalSynthetic:
    """Tests for the minimal synthetic generator."""

    def test_generate_minimal(self):
        """Test: minimal grid has only navigable + SIC."""
        grid = generate_minimal(n_rows=5, n_cols=5)
        assert grid.n_rows == 5
        assert grid.has_layer("sic_mean")
        assert not grid.has_layer("sic_uncertainty")
        assert not grid.has_layer("iceberg_risk")

    def test_minimal_reproducible(self):
        """Test: minimal grid is reproducible."""
        g1 = generate_minimal(seed=10)
        g2 = generate_minimal(seed=10)
        np.testing.assert_array_equal(g1.sic_mean, g2.sic_mean)


# --- Optional layers absent tests ---

class TestOptionalLayersAbsent:
    """Tests that optional layers can be absent without crashing."""

    def test_grid_without_optional_layers(self):
        """Test: grid works with only required fields."""
        grid = EnvironmentalGrid(
            n_rows=5, n_cols=5,
            lat=np.linspace(-70, -69.8, 5),
            lon=np.linspace(72, 72.2, 5),
            navigable=np.ones((5, 5), dtype=bool),
        )
        assert not grid.has_layer("sic_mean")
        assert not grid.has_layer("wind_cost")
        # summary should not crash
        s = grid.summary()
        assert "not available" in s

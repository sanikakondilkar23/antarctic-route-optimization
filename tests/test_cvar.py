"""
Tests for CVaR computation, scenario env_fn, and robust route selection.
"""

import math

import numpy as np
import pytest

from src.environment.synthetic import generate_synthetic
from src.routing.cost import CostWeights
from src.uncertainty.cvar import compute_cvar
from src.uncertainty.scenarios import Scenario, generate_scenarios, scenario_to_env_fn


# ---------------------------------------------------------------------------
# CVaR computation
# ---------------------------------------------------------------------------

class TestComputeCVaR:
    """Unit tests for compute_cvar."""

    def test_known_values(self):
        """K=15, alpha=0.05: n_tail=1, CVaR = max, VaR = max."""
        costs = list(range(1, 16))  # [1, 2, ..., 15]
        var, cvar = compute_cvar(costs, alpha=0.05)
        assert var == 15
        assert cvar == 15.0

    def test_known_values_alpha_01(self):
        """K=100, alpha=0.10: n_tail=10, CVaR = mean of worst 10."""
        costs = list(range(1, 101))  # [1, 2, ..., 100]
        var, cvar = compute_cvar(costs, alpha=0.10)
        # worst 10: [91, 92, ..., 100], mean = 95.5
        assert var == 91
        assert abs(cvar - 95.5) < 1e-10

    def test_equal_costs(self):
        """All costs equal → VaR = CVaR = that value."""
        costs = [3.0] * 20
        var, cvar = compute_cvar(costs, alpha=0.05)
        assert abs(var - 3.0) < 1e-10
        assert abs(cvar - 3.0) < 1e-10

    def test_alpha_one(self):
        """alpha=1.0: tail = all costs, CVaR = mean of all."""
        costs = [1.0, 2.0, 3.0, 4.0, 5.0]
        var, cvar = compute_cvar(costs, alpha=1.0)
        assert var == 1.0  # smallest value in the full set
        assert abs(cvar - 3.0) < 1e-10  # mean of all 5

    def test_single_cost(self):
        """Single cost → VaR = CVaR = that cost."""
        costs = [42.0]
        var, cvar = compute_cvar(costs, alpha=0.05)
        assert abs(var - 42.0) < 1e-10
        assert abs(cvar - 42.0) < 1e-10

    def test_empty_costs_raises(self):
        """Empty costs → ValueError."""
        with pytest.raises(ValueError, match="non-empty"):
            compute_cvar([], alpha=0.05)

    def test_invalid_alpha_zero(self):
        """alpha=0 → ValueError."""
        with pytest.raises(ValueError, match="alpha"):
            compute_cvar([1.0, 2.0], alpha=0.0)

    def test_invalid_alpha_negative(self):
        """alpha < 0 → ValueError."""
        with pytest.raises(ValueError, match="alpha"):
            compute_cvar([1.0, 2.0], alpha=-0.1)

    def test_invalid_alpha_above_one(self):
        """alpha > 1 → ValueError."""
        with pytest.raises(ValueError, match="alpha"):
            compute_cvar([1.0, 2.0], alpha=1.5)

    def test_cvar_geq_var(self):
        """CVaR is always >= VaR (by definition)."""
        costs = [1.0, 5.0, 10.0, 3.0, 8.0, 2.0, 7.0]
        var, cvar = compute_cvar(costs, alpha=0.25)
        assert cvar >= var

    def test_cvar_at_least_max(self):
        """CVaR >= max(costs) always (worst case is included)."""
        costs = [1.0, 2.0, 3.0, 4.0, 5.0]
        _, cvar = compute_cvar(costs, alpha=0.05)
        assert cvar >= max(costs)


# ---------------------------------------------------------------------------
# Scenario env_fn
# ---------------------------------------------------------------------------

class TestScenarioEnvFn:
    """Test scenario_to_env_fn converts Scenario to env_fn(t)."""

    def test_returns_callable(self):
        grid = generate_synthetic(n_rows=10, n_cols=12, seed=42)
        scenarios = generate_scenarios(grid, n_scenarios=3, seed=0)
        env_fn = scenario_to_env_fn(scenarios[0], grid)
        assert callable(env_fn)

    def test_same_grid_for_all_t(self):
        grid = generate_synthetic(n_rows=10, n_cols=12, seed=42)
        scenarios = generate_scenarios(grid, n_scenarios=3, seed=0)
        env_fn = scenario_to_env_fn(scenarios[0], grid)
        g0 = env_fn(0.0)
        g1 = env_fn(100.0)
        np.testing.assert_array_equal(g0.sic_mean, g1.sic_mean)

    def test_has_perturbed_sic(self):
        grid = generate_synthetic(n_rows=10, n_cols=12, seed=42)
        scenarios = generate_scenarios(grid, n_scenarios=3, seed=0)
        env_fn = scenario_to_env_fn(scenarios[0], grid)
        g = env_fn(0.0)
        assert g.sic_mean is not None
        # Perturbed SIC should differ from mean (with high probability)
        assert not np.array_equal(g.sic_mean, grid.sic_mean)


# ---------------------------------------------------------------------------
# TD-A* scenario evaluation
# ---------------------------------------------------------------------------

class TestTDScenarioEvaluation:
    """Integration test: TD-A* runs on scenario grids."""

    def test_td_astar_on_scenario(self):
        from src.routing.td_astar import td_astar

        grid = generate_synthetic(n_rows=10, n_cols=12, seed=42)
        scenarios = generate_scenarios(grid, n_scenarios=3, seed=0)
        env_fn = scenario_to_env_fn(scenarios[0], grid)

        result = td_astar(grid, (0, 0), (6, 11), env_fn=env_fn)
        assert result.success
        assert len(result.path) > 0

    def test_evaluate_scenarios_td_returns_results(self):
        from src.routing.scenario_router import evaluate_scenarios_td

        grid = generate_synthetic(n_rows=10, n_cols=12, seed=42)
        scenarios = generate_scenarios(grid, n_scenarios=3, seed=0)

        results = evaluate_scenarios_td(grid, scenarios, (0, 0), (6, 11))
        assert len(results) == 3
        for sid, res in results.items():
            assert res.success, f"TD-A* failed on scenario {sid}"


# ---------------------------------------------------------------------------
# Robust route selection
# ---------------------------------------------------------------------------

class TestRobustRouteSelection:
    """Integration test: CVaR-based route selection."""

    def test_select_robust_route_returns_valid(self):
        from src.routing.scenario_router import select_robust_route

        grid = generate_synthetic(n_rows=10, n_cols=12, seed=42)
        scenarios = generate_scenarios(grid, n_scenarios=5, seed=0)

        result = select_robust_route(
            grid, scenarios, (0, 0), (6, 11),
            alpha=0.05,
        )
        assert len(result.selected_path) > 0
        assert result.selected_cvar <= result.selected_worst_case
        assert result.n_scenarios == 5
        assert result.alpha == 0.05

    def test_cvar_result_has_all_candidates(self):
        from src.routing.scenario_router import select_robust_route

        grid = generate_synthetic(n_rows=10, n_cols=12, seed=42)
        scenarios = generate_scenarios(grid, n_scenarios=5, seed=0)

        result = select_robust_route(
            grid, scenarios, (0, 0), (6, 11),
            alpha=0.05,
        )
        # All 5 scenarios should have generated candidates
        assert len(result.candidate_paths) == 5
        assert len(result.candidate_costs) == 5
        assert len(result.candidate_cvar) == 5

    def test_selected_has_minimum_cvar(self):
        from src.routing.scenario_router import select_robust_route

        grid = generate_synthetic(n_rows=10, n_cols=12, seed=42)
        scenarios = generate_scenarios(grid, n_scenarios=5, seed=0)

        result = select_robust_route(
            grid, scenarios, (0, 0), (6, 11),
            alpha=0.05,
        )
        # Selected route should have the minimum CVaR
        min_cvar = min(result.candidate_cvar.values())
        assert abs(result.selected_cvar - min_cvar) < 1e-10

    def test_deterministic_comparison_present(self):
        from src.routing.scenario_router import select_robust_route

        grid = generate_synthetic(n_rows=10, n_cols=12, seed=42)
        scenarios = generate_scenarios(grid, n_scenarios=5, seed=0)

        result = select_robust_route(
            grid, scenarios, (0, 0), (6, 11),
            alpha=0.05,
        )
        assert len(result.deterministic_path) > 0
        assert result.deterministic_cvar < float("inf")

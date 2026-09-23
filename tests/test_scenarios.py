"""
Tests for scenario generation and scenario-based routing.
"""

import numpy as np
import pytest

from src.environment.grid import EnvironmentalGrid
from src.environment.synthetic import generate_synthetic, generate_minimal
from src.routing.astar import astar
from src.routing.cost import CostWeights
from src.routing.scenario_router import (
    compute_route_metrics,
    evaluate_scenarios,
    jaccard_overlap,
    route_coverage,
)
from src.uncertainty.scenarios import Scenario, generate_scenarios


def _full_grid():
    """Generate a small full grid for fast tests."""
    return generate_synthetic(n_rows=15, n_cols=20, seed=42)


# --- Test 1: Correct number of scenarios ---

class TestScenarioCount:
    def test_count(self):
        grid = _full_grid()
        scenarios = generate_scenarios(grid, n_scenarios=10, seed=0)
        assert len(scenarios) == 10

    def test_count_20(self):
        grid = _full_grid()
        scenarios = generate_scenarios(grid, n_scenarios=20, seed=0)
        assert len(scenarios) == 20


# --- Test 2: Reproducibility ---

class TestReproducibility:
    def test_same_seed_same_scenarios(self):
        grid = _full_grid()
        s1 = generate_scenarios(grid, n_scenarios=5, seed=42)
        s2 = generate_scenarios(grid, n_scenarios=5, seed=42)
        for a, b in zip(s1, s2):
            np.testing.assert_array_equal(a.sic, b.sic)
            np.testing.assert_array_equal(a.iceberg_risk, b.iceberg_risk)

    def test_same_seed_across_calls(self):
        grid = _full_grid()
        results = [generate_scenarios(grid, n_scenarios=3, seed=99) for _ in range(3)]
        for i in range(1, len(results)):
            for a, b in zip(results[0], results[i]):
                np.testing.assert_array_equal(a.sic, b.sic)


# --- Test 3: Different seed produces different scenarios ---

class TestDifferentSeed:
    def test_different_seeds_differ(self):
        grid = _full_grid()
        s1 = generate_scenarios(grid, n_scenarios=5, seed=0)
        s2 = generate_scenarios(grid, n_scenarios=5, seed=99)
        any_diff = False
        for a, b in zip(s1, s2):
            if not np.array_equal(a.sic, b.sic):
                any_diff = True
                break
        assert any_diff, "Different seeds should produce different scenarios"


# --- Test 4: SIC in [0, 1] ---

class TestSICRange:
    def test_sic_bounded(self):
        grid = _full_grid()
        scenarios = generate_scenarios(grid, n_scenarios=20, seed=42)
        for s in scenarios:
            assert s.sic.min() >= 0.0, f"SIC below 0 in scenario {s.scenario_id}"
            assert s.sic.max() <= 1.0, f"SIC above 1 in scenario {s.scenario_id}"


# --- Test 5: Iceberg risk in [0, 1] ---

class TestIcebergRange:
    def test_iceberg_bounded(self):
        grid = _full_grid()
        scenarios = generate_scenarios(grid, n_scenarios=20, seed=42)
        for s in scenarios:
            assert s.iceberg_risk.min() >= 0.0, f"Iceberg below 0 in scenario {s.scenario_id}"
            assert s.iceberg_risk.max() <= 1.0, f"Iceberg above 1 in scenario {s.scenario_id}"


# --- Test 6: Zero uncertainty reproduces mean field ---

class TestZeroUncertainty:
    def test_zero_sic_uncertainty(self):
        grid = _full_grid()
        scenarios = generate_scenarios(grid, n_scenarios=5, seed=42, sic_scale=0.0)
        for s in scenarios:
            np.testing.assert_array_almost_equal(s.sic, grid.sic_mean)

    def test_zero_iceberg_uncertainty(self):
        grid = _full_grid()
        scenarios = generate_scenarios(grid, n_scenarios=5, seed=42, iceberg_scale=0.0)
        for s in scenarios:
            np.testing.assert_array_almost_equal(s.iceberg_risk, grid.iceberg_risk)

    def test_both_zero(self):
        grid = _full_grid()
        scenarios = generate_scenarios(
            grid, n_scenarios=5, seed=42, sic_scale=0.0, iceberg_scale=0.0
        )
        for s in scenarios:
            np.testing.assert_array_almost_equal(s.sic, grid.sic_mean)
            np.testing.assert_array_almost_equal(s.iceberg_risk, grid.iceberg_risk)


# --- Test 7: Larger uncertainty produces larger perturbations ---

class TestPerturbationMagnitude:
    def test_larger_scale_more_variance(self):
        grid = _full_grid()
        s_small = generate_scenarios(grid, n_scenarios=20, seed=42, sic_scale=0.5)
        s_large = generate_scenarios(grid, n_scenarios=20, seed=42, sic_scale=2.0)

        small_dev = np.mean([np.abs(s.sic - grid.sic_mean).mean() for s in s_small])
        large_dev = np.mean([np.abs(s.sic - grid.sic_mean).mean() for s in s_large])

        assert large_dev > small_dev, (
            f"Large scale ({large_dev:.4f}) should produce bigger perturbations "
            f"than small scale ({small_dev:.4f})"
        )


# --- Test 8: Scenario dimensions match grid ---

class TestDimensions:
    def test_shape_matches_grid(self):
        grid = _full_grid()
        scenarios = generate_scenarios(grid, n_scenarios=5, seed=42)
        for s in scenarios:
            assert s.sic.shape == (grid.n_rows, grid.n_cols)
            assert s.iceberg_risk.shape == (grid.n_rows, grid.n_cols)


# --- Test 9: Scenario IDs are unique ---

class TestUniqueIDs:
    def test_unique_ids(self):
        grid = _full_grid()
        scenarios = generate_scenarios(grid, n_scenarios=15, seed=42)
        ids = [s.scenario_id for s in scenarios]
        assert len(set(ids)) == len(ids)


# --- Test 10: A* routes successfully on scenarios ---

class TestAStarOnScenarios:
    def test_route_exists_on_mean(self):
        grid = _full_grid()
        result = astar(grid, (2, 2), (10, 17))
        assert result.success

    def test_route_exists_on_scenarios(self):
        grid = _full_grid()
        scenarios = generate_scenarios(grid, n_scenarios=5, seed=42)
        for s in scenarios:
            scenario_grid = s.to_grid(grid)
            result = astar(scenario_grid, (2, 2), (10, 17))
            assert result.success, f"A* failed on scenario {s.scenario_id}"


# --- Scenario.to_grid test ---

class TestScenarioToGrid:
    def test_to_grid_structure(self):
        grid = _full_grid()
        scenarios = generate_scenarios(grid, n_scenarios=3, seed=42)
        for s in scenarios:
            sg = s.to_grid(grid)
            assert sg.n_rows == grid.n_rows
            assert sg.n_cols == grid.n_cols
            assert sg.has_layer("sic_mean")
            assert sg.has_layer("iceberg_risk")
            assert not sg.has_layer("sic_uncertainty")
            assert not sg.has_layer("iceberg_uncertainty")
            np.testing.assert_array_equal(sg.navigable, grid.navigable)


# --- Missing layers test ---

class TestMissingLayers:
    def test_missing_sic_uncertainty_raises(self):
        grid = generate_minimal(n_rows=5, n_cols=5, seed=42)
        with pytest.raises(ValueError, match="sic_uncertainty"):
            generate_scenarios(grid, n_scenarios=3, seed=0)

    def test_missing_iceberg_raises(self):
        grid = _full_grid()
        grid_no_ice = EnvironmentalGrid(
            n_rows=grid.n_rows, n_cols=grid.n_cols,
            lat=grid.lat.copy(), lon=grid.lon.copy(),
            navigable=grid.navigable.copy(),
            sic_mean=grid.sic_mean.copy(),
            sic_uncertainty=grid.sic_uncertainty.copy(),
        )
        with pytest.raises(ValueError, match="iceberg_risk"):
            generate_scenarios(grid_no_ice, n_scenarios=3, seed=0)


# --- Test 11: Uncertainty fields are dimensionless ---

class TestUncertaintyUnits:
    def test_sic_uncertainty_is_dimensionless(self):
        grid = _full_grid()
        assert grid.sic_uncertainty is not None
        assert grid.sic_uncertainty.min() >= 0.0
        assert grid.sic_uncertainty.max() <= 1.0, (
            f"SIC uncertainty should be dimensionless [0,1], got max={grid.sic_uncertainty.max()}"
        )

    def test_iceberg_risk_uncertainty_is_dimensionless(self):
        grid = _full_grid()
        assert grid.iceberg_risk_uncertainty is not None
        assert grid.iceberg_risk_uncertainty.min() >= 0.0
        assert grid.iceberg_risk_uncertainty.max() <= 0.5, (
            f"Iceberg risk uncertainty should be dimensionless [0,0.3], "
            f"got max={grid.iceberg_risk_uncertainty.max()}"
        )

    def test_km_uncertainty_not_used_for_risk_perturbation(self):
        grid = _full_grid()
        assert grid.iceberg_uncertainty is not None
        assert grid.iceberg_uncertainty.max() > 1.0, (
            "km-valued iceberg_uncertainty should be > 1 (it's in km)"
        )
        assert grid.iceberg_risk_uncertainty.max() < 1.0, (
            "iceberg_risk_uncertainty should be < 1 (it's dimensionless)"
        )


# --- Test 12: Cost consistency (A* vs compute_route_metrics) ---

class TestCostConsistency:
    def test_astar_matches_metrics(self):
        grid = _full_grid()
        weights = CostWeights(w_sic=1.0, w_ice=1.0, w_wind=1.0, w_curr=1.0, w_distance=1.0)
        result = astar(grid, (2, 2), (10, 17), weights=weights)
        assert result.success
        metrics = compute_route_metrics(grid, result.path, weights)
        assert abs(result.total_cost - metrics.total_cost) < 1e-10, (
            f"A* cost {result.total_cost} != metrics cost {metrics.total_cost}"
        )

    def test_start_equals_goal_cost(self):
        grid = _full_grid()
        weights = CostWeights()
        result = astar(grid, (5, 5), (5, 5), weights=weights)
        metrics = compute_route_metrics(grid, result.path, weights)
        assert abs(result.total_cost - metrics.total_cost) < 1e-10


# --- Test 13: Jaccard overlap metric ---

class TestJaccardOverlap:
    def test_identical_paths(self):
        path = [(0, 0), (1, 1), (2, 2)]
        assert jaccard_overlap(path, path) == 1.0

    def test_disjoint_paths(self):
        path_a = [(0, 0), (1, 0), (2, 0)]
        path_b = [(5, 5), (6, 5), (7, 5)]
        assert jaccard_overlap(path_a, path_b) == 0.0

    def test_partial_overlap(self):
        path_a = [(0, 0), (1, 1), (2, 2)]
        path_b = [(1, 1), (2, 2), (3, 3)]
        # Intersection = {(1,1), (2,2)} = 2
        # Union = {(0,0), (1,1), (2,2), (3,3)} = 4
        expected = 2.0 / 4.0
        assert abs(jaccard_overlap(path_a, path_b) - expected) < 1e-10

    def test_empty_paths(self):
        assert jaccard_overlap([], [(0, 0)]) == 0.0
        assert jaccard_overlap([(0, 0)], []) == 0.0


# --- Test 14: Route coverage metric ---

class TestRouteCoverage:
    def test_identical_paths(self):
        path = [(0, 0), (1, 1), (2, 2)]
        assert route_coverage(path, path) == 1.0

    def test_partial_coverage(self):
        path_det = [(0, 0), (1, 1), (2, 2), (3, 3)]
        path_sc = [(1, 1), (2, 2)]
        # Intersection = {(1,1), (2,2)} = 2
        # |det| = 4
        expected = 2.0 / 4.0
        assert abs(route_coverage(path_det, path_sc) - expected) < 1e-10

    def test_no_coverage(self):
        path_det = [(0, 0), (1, 0)]
        path_sc = [(5, 5), (6, 5)]
        assert route_coverage(path_det, path_sc) == 0.0

    def test_empty_det_path(self):
        assert route_coverage([], [(0, 0)]) == 0.0


# --- Test 15: Evaluate scenarios returns valid structure ---

class TestEvaluateStructure:
    def test_evaluate_returns_all_dicts(self):
        grid = _full_grid()
        scenarios = generate_scenarios(grid, n_scenarios=5, seed=42)
        result = evaluate_scenarios(grid, scenarios, (2, 2), (10, 17))

        assert len(result.scenario_routes) == 5
        assert len(result.jaccard_overlap) == 5
        assert len(result.route_coverage) == 5
        assert len(result.regret) == 5

    def test_overlap_metrics_in_range(self):
        grid = _full_grid()
        scenarios = generate_scenarios(grid, n_scenarios=5, seed=42)
        result = evaluate_scenarios(grid, scenarios, (2, 2), (10, 17))

        for j in result.jaccard_overlap.values():
            assert 0.0 <= j <= 1.0
        for c in result.route_coverage.values():
            assert 0.0 <= c <= 1.0

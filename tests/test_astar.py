"""
Tests for the deterministic A* baseline and cost function.
"""

import math

import numpy as np
import pytest

from src.environment.grid import EnvironmentalGrid
from src.environment.synthetic import generate_synthetic
from src.routing.astar import RouteResult, astar, euclidean_heuristic
from src.routing.cost import CostMap, CostWeights
from src.routing.scenario_router import compute_route_metrics


def _simple_grid(n_rows=10, n_cols=10, blocked=None):
    """Create a simple all-navigable grid with optional blocked cells."""
    lat = np.linspace(-70, -69.5, n_rows)
    lon = np.linspace(72, 72.5, n_cols)
    nav = np.ones((n_rows, n_cols), dtype=bool)
    if blocked:
        for r, c in blocked:
            nav[r, c] = False
    return EnvironmentalGrid(
        n_rows=n_rows, n_cols=n_cols,
        lat=lat, lon=lon, navigable=nav,
        sic_mean=np.zeros((n_rows, n_cols)),
    )


# --- Test 1: Simple obstacle-free grid ---

class TestObstacleFree:
    def test_path_found(self):
        grid = _simple_grid()
        result = astar(grid, (0, 0), (9, 9))
        assert result.success
        assert len(result.path) > 0

    def test_start_equals_goal(self):
        grid = _simple_grid()
        result = astar(grid, (5, 5), (5, 5))
        assert result.success
        assert result.path == [(5, 5)]
        assert result.total_cost == 0.0
        assert result.route_length == 0.0


# --- Test 2: Grid with blocked cells ---

class TestBlockedCells:
    def test_path_avoids_blocked(self):
        grid = _simple_grid(blocked=[(0, 1), (1, 1), (2, 1), (3, 1)])
        result = astar(grid, (0, 0), (4, 0))
        assert result.success
        for r, c in result.path:
            assert grid.navigable[r, c]

    def test_no_path(self):
        # Wall from row 0 to row 9, except one cell we block
        blocked = [(r, 5) for r in range(10)]
        grid = _simple_grid(blocked=blocked)
        result = astar(grid, (0, 0), (0, 9))
        assert not result.success
        assert result.path == []


# --- Test 3: Start equals goal ---

class TestStartEqualsGoal:
    def test_single_point(self):
        grid = _simple_grid()
        result = astar(grid, (3, 7), (3, 7))
        assert result.success
        assert result.path == [(3, 7)]
        assert result.total_cost == 0.0

    def test_nonzero_cost_grid(self):
        """start==goal returns env_cost(start), not 0."""
        from src.environment.synthetic import generate_synthetic
        grid = generate_synthetic(n_rows=10, n_cols=10, seed=42)
        w = CostWeights()
        cm = CostMap(grid, w)
        result = astar(grid, (5, 5), (5, 5), weights=w)
        assert result.success
        assert result.path == [(5, 5)]
        expected = cm.cell_cost(5, 5)
        assert abs(result.total_cost - expected) < 1e-10


# --- Test 4: No-path case ---

class TestNoPath:
    def test_completely_surrounded(self):
        # Full horizontal wall from col 0 to col 9 at row 5
        blocked = [(5, c) for c in range(10)]
        grid = _simple_grid(blocked=blocked)
        result = astar(grid, (0, 0), (9, 9))
        assert not result.success


# --- Test 5: Diagonal movement ---

class TestDiagonal:
    def test_diagonal_preferred_on_open_grid(self):
        grid = _simple_grid()
        result = astar(grid, (0, 0), (5, 5))
        assert result.success
        # Diagonal path should have route_length close to 5*sqrt(2)
        expected_len = 5.0 * math.sqrt(2)
        assert abs(result.route_length - expected_len) < 0.01


# --- Test 6: Route never enters blocked cells ---

class TestNeverBlocked:
    def test_all_navigable(self):
        blocked = [(2, 2), (2, 3), (2, 4), (3, 2), (4, 2)]
        grid = _simple_grid(blocked=blocked)
        result = astar(grid, (0, 0), (9, 9))
        if result.success:
            for r, c in result.path:
                assert grid.navigable[r, c], f"Path enters blocked cell ({r},{c})"


# --- Test 7: Route begins at start ---

class TestRouteBeginsAtStart:
    def test_first_cell_is_start(self):
        grid = _simple_grid()
        result = astar(grid, (1, 2), (8, 7))
        assert result.success
        assert result.path[0] == (1, 2)


# --- Test 8: Route ends at goal ---

class TestRouteEndsAtGoal:
    def test_last_cell_is_goal(self):
        grid = _simple_grid()
        result = astar(grid, (1, 2), (8, 7))
        assert result.success
        assert result.path[-1] == (8, 7)


# --- Test 9: Deterministic repeatability ---

class TestDeterministic:
    def test_same_result_twice(self):
        grid = generate_synthetic(n_rows=20, n_cols=25, seed=42)
        r1 = astar(grid, (2, 2), (17, 22))
        r2 = astar(grid, (2, 2), (17, 22))
        assert r1.success == r2.success
        assert r1.path == r2.path
        assert r1.total_cost == r2.total_cost
        assert r1.expanded_nodes == r2.expanded_nodes


# --- Test 10: Cost calculation ---

class TestCostCalculation:
    def test_edge_cost_non_negative(self):
        grid = generate_synthetic(n_rows=10, n_cols=10, seed=42)
        w = CostWeights()
        cost_map = CostMap(grid, w)
        # All environmental costs should be non-negative
        assert (cost_map.env_cost >= 0).all()

    def test_edge_cost_includes_distance(self):
        grid = _simple_grid()
        w = CostWeights(w_sic=0, w_ice=0, w_wind=0, w_curr=0, w_distance=1.0)
        cost_map = CostMap(grid, w)
        # Cardinal edge cost should be exactly 1.0
        cost = cost_map.edge_cost((0, 0), (0, 1), 1.0)
        assert abs(cost - 1.0) < 1e-10
        # Diagonal edge cost should be sqrt(2)
        cost_diag = cost_map.edge_cost((0, 0), (1, 1), math.sqrt(2))
        assert abs(cost_diag - math.sqrt(2)) < 1e-10


# --- CostWeights validation ---

class TestCostWeights:
    def test_negative_weight_rejected(self):
        with pytest.raises(AssertionError):
            CostWeights(w_sic=-1.0)


# --- Heuristic ---

class TestHeuristic:
    def test_zero_distance(self):
        assert euclidean_heuristic((0, 0), (0, 0)) == 0.0

    def test_unit_distance(self):
        assert abs(euclidean_heuristic((0, 0), (0, 1)) - 1.0) < 1e-10
        assert abs(euclidean_heuristic((0, 0), (1, 0)) - 1.0) < 1e-10

    def test_diagonal_distance(self):
        assert abs(euclidean_heuristic((0, 0), (1, 1)) - math.sqrt(2)) < 1e-10

    def test_heuristic_with_w_distance_1(self):
        """Heuristic consistent with w_distance=1.0: h = 1.0 * Euclidean."""
        grid = _simple_grid()
        w = CostWeights(w_distance=1.0)
        result = astar(grid, (0, 0), (5, 5), weights=w)
        assert result.success
        # On zero-cost grid with w_distance=1, optimal is pure diagonal
        assert abs(result.route_length - 5.0 * math.sqrt(2)) < 0.01

    def test_heuristic_with_w_distance_2(self):
        """Heuristic scales with w_distance: h = 2.0 * Euclidean."""
        grid = _simple_grid()
        w = CostWeights(w_distance=2.0)
        result = astar(grid, (0, 0), (5, 5), weights=w)
        assert result.success
        # Route should still be optimal (diagonal), cost = 2.0 * 5*sqrt(2)
        expected_len = 5.0 * math.sqrt(2)
        assert abs(result.route_length - expected_len) < 0.01

    def test_known_grid_optimal_path(self):
        """Simple 5x5 grid: straight line is optimal when env costs are zero."""
        lat = np.linspace(0, 4, 5)
        lon = np.linspace(0, 4, 5)
        nav = np.ones((5, 5), dtype=bool)
        grid = EnvironmentalGrid(
            n_rows=5, n_cols=5, lat=lat, lon=lon, navigable=nav,
            sic_mean=np.zeros((5, 5)),
        )
        w = CostWeights(w_distance=1.0)
        result = astar(grid, (0, 0), (0, 4), weights=w)
        assert result.success
        # Straight horizontal path: 4 cardinal steps = length 4.0
        assert abs(result.route_length - 4.0) < 1e-10
        # Cost = env(start) + 4 * (0 + 1.0) = 0 + 4.0 = 4.0
        assert abs(result.total_cost - 4.0) < 1e-10


# --- Blocked start / goal ---

class TestBlockedNodes:
    def test_blocked_start(self):
        grid = _simple_grid(blocked=[(0, 0)])
        result = astar(grid, (0, 0), (9, 9))
        assert not result.success
        assert result.path == []

    def test_blocked_goal(self):
        grid = _simple_grid(blocked=[(9, 9)])
        result = astar(grid, (0, 0), (9, 9))
        assert not result.success
        assert result.path == []

    def test_out_of_bounds_start(self):
        grid = _simple_grid()
        result = astar(grid, (-1, 0), (5, 5))
        assert not result.success

    def test_out_of_bounds_goal(self):
        grid = _simple_grid()
        result = astar(grid, (0, 0), (15, 15))
        assert not result.success


# --- Cost consistency (A* vs compute_route_metrics) ---

class TestCostConsistency:
    def test_astar_matches_metrics(self):
        grid = _simple_grid()
        w = CostWeights()
        result = astar(grid, (0, 0), (5, 5), weights=w)
        assert result.success
        metrics = compute_route_metrics(grid, result.path, w)
        assert abs(result.total_cost - metrics.total_cost) < 1e-10

    def test_astar_matches_metrics_synthetic(self):
        grid = generate_synthetic(n_rows=20, n_cols=25, seed=42)
        w = CostWeights()
        result = astar(grid, (2, 2), (15, 20), weights=w)
        assert result.success
        metrics = compute_route_metrics(grid, result.path, w)
        assert abs(result.total_cost - metrics.total_cost) < 1e-10


# --- Current-cost semantics (post-audit fix) ---

class TestCurrentCostSemantics:
    """Verify that current_cost is handled via max(val, 0) with no global shift."""

    def _grid_with_current(self, current_val):
        """Create a 1x2 grid with a single current value at the destination."""
        lat = np.array([0.0])
        lon = np.array([0.0, 1.0])
        nav = np.ones((1, 2), dtype=bool)
        current = np.full((1, 2), current_val)
        return EnvironmentalGrid(
            n_rows=1, n_cols=2, lat=lat, lon=lon,
            navigable=nav, current_cost=current,
        )

    def test_negative_current_zero_penalty(self):
        """Favorable current (< 0) contributes zero penalty."""
        grid = self._grid_with_current(-0.5)
        w = CostWeights(w_sic=0, w_ice=0, w_wind=0, w_curr=1.0, w_distance=0)
        cost_map = CostMap(grid, w)
        assert cost_map.cell_cost(0, 1) == 0.0

    def test_zero_current_zero_penalty(self):
        """Neutral current (= 0) contributes zero penalty."""
        grid = self._grid_with_current(0.0)
        w = CostWeights(w_sic=0, w_ice=0, w_wind=0, w_curr=1.0, w_distance=0)
        cost_map = CostMap(grid, w)
        assert cost_map.cell_cost(0, 1) == 0.0

    def test_positive_current_positive_penalty(self):
        """Adverse current (> 0) contributes proportional positive cost."""
        grid = self._grid_with_current(0.3)
        w = CostWeights(w_sic=0, w_ice=0, w_wind=0, w_curr=1.0, w_distance=0)
        cost_map = CostMap(grid, w)
        assert abs(cost_map.cell_cost(0, 1) - 0.3) < 1e-10

    def test_no_global_shift(self):
        """All cells with current=0 should have zero current contribution
        regardless of what other cells contain."""
        current = np.array([[-0.5, 0.0, 0.3]])
        lat = np.array([0.0])
        lon = np.array([0.0, 1.0, 2.0])
        grid = EnvironmentalGrid(
            n_rows=1, n_cols=3, lat=lat, lon=lon,
            navigable=np.ones((1, 3), dtype=bool),
            current_cost=current,
        )
        w = CostWeights(w_sic=0, w_ice=0, w_wind=0, w_curr=1.0, w_distance=0)
        cost_map = CostMap(grid, w)
        # Cell at col 1 has current=0 and must contribute exactly 0
        assert cost_map.cell_cost(0, 1) == 0.0
        # Cell at col 0 has current=-0.5 and must contribute exactly 0
        assert cost_map.cell_cost(0, 0) == 0.0
        # Cell at col 2 has current=0.3 and must contribute exactly 0.3
        assert abs(cost_map.cell_cost(0, 2) - 0.3) < 1e-10

    def test_all_edge_costs_non_negative(self):
        """Edge costs must always be >= 0 even with mixed current values."""
        current = np.array([[-0.9, 0.5], [0.0, -0.2]])
        lat = np.array([0.0, 1.0])
        lon = np.array([0.0, 1.0])
        grid = EnvironmentalGrid(
            n_rows=2, n_cols=2, lat=lat, lon=lon,
            navigable=np.ones((2, 2), dtype=bool),
            current_cost=current,
        )
        w = CostWeights(w_sic=0, w_ice=0, w_wind=0, w_curr=1.0, w_distance=0.5)
        cost_map = CostMap(grid, w)
        for r in range(2):
            for c in range(2):
                for dist in [1.0, math.sqrt(2)]:
                    for dr, dc, d in [(-1, 0, 1.0), (0, 1, 1.0), (1, 1, math.sqrt(2))]:
                        nr, nc = r + dr, c + dc
                        if 0 <= nr < 2 and 0 <= nc < 2:
                            ec = cost_map.edge_cost((r, c), (nr, nc), d)
                            assert ec >= 0, f"Negative edge cost: ({r},{c})->({nr},{nc}) = {ec}"

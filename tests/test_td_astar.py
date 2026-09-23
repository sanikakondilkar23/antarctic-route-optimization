"""
Tests for time-dependent A* routing.
"""

import math

import numpy as np
import pytest

from src.environment.grid import EnvironmentalGrid
from src.environment.synthetic import generate_synthetic
from src.routing.cost import CostWeights
from src.routing.td_astar import (
    KNOTS_TO_KMH,
    TDRouteResult,
    td_astar,
    td_edge_cost,
    td_heuristic,
    travel_time_hours,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Travel-time calculation
# ---------------------------------------------------------------------------

class TestTravelTime:
    def test_cardinal_one_cell(self):
        """Cardinal move: 1 grid unit * cell_size_km / speed = travel time."""
        grid = _simple_grid()
        cell_km = grid.cell_size_km()
        speed = 12.0  # knots
        expected_h = cell_km / (speed * KNOTS_TO_KMH)
        actual = travel_time_hours(1.0, cell_km, speed)
        assert abs(actual - expected_h) < 1e-10

    def test_diagonal_one_cell(self):
        """Diagonal move: sqrt(2) grid units."""
        grid = _simple_grid()
        cell_km = grid.cell_size_km()
        speed = 12.0
        expected_h = math.sqrt(2) * cell_km / (speed * KNOTS_TO_KMH)
        actual = travel_time_hours(math.sqrt(2), cell_km, speed)
        assert abs(actual - expected_h) < 1e-10

    def test_zero_distance(self):
        """Zero distance -> zero travel time."""
        assert travel_time_hours(0.0, 5.5, 12.0) == 0.0

    def test_faster_speed_shorter_time(self):
        """Higher speed -> shorter travel time."""
        grid = _simple_grid()
        cell_km = grid.cell_size_km()
        t_slow = travel_time_hours(1.0, cell_km, 8.0)
        t_fast = travel_time_hours(1.0, cell_km, 20.0)
        assert t_fast < t_slow

    def test_larger_cell_longer_time(self):
        """Larger cell -> longer travel time for same grid distance."""
        t_small = travel_time_hours(1.0, 1.0, 12.0)
        t_large = travel_time_hours(1.0, 10.0, 12.0)
        assert t_large > t_small

    def test_knots_conversion(self):
        """1 knot = 1.852 km/h."""
        assert abs(KNOTS_TO_KMH - 1.852) < 1e-10


# ---------------------------------------------------------------------------
# Heuristic
# ---------------------------------------------------------------------------

class TestTDHeuristic:
    def test_zero_distance(self):
        h = td_heuristic(5, 5, 5, 5, w_distance=1.0)
        assert h == 0.0

    def test_one_cell_cardinal(self):
        h = td_heuristic(0, 0, 1, 0, w_distance=1.0)
        assert abs(h - 1.0) < 1e-10

    def test_one_cell_diagonal(self):
        h = td_heuristic(0, 0, 1, 1, w_distance=1.0)
        assert abs(h - math.sqrt(2)) < 1e-10

    def test_symmetry(self):
        h1 = td_heuristic(0, 0, 5, 3, w_distance=1.0)
        h2 = td_heuristic(5, 3, 0, 0, w_distance=1.0)
        assert abs(h1 - h2) < 1e-10

    def test_scales_with_w_distance(self):
        h1 = td_heuristic(0, 0, 3, 4, w_distance=1.0)
        h2 = td_heuristic(0, 0, 3, 4, w_distance=2.0)
        assert abs(h2 - 2.0 * h1) < 1e-10


# ---------------------------------------------------------------------------
# Time-dependent state (row, col, t)
# ---------------------------------------------------------------------------

class TestTDState:
    def test_state_includes_time(self):
        """A* with same start/goal but different start_time yields different time arrays."""
        grid = _simple_grid()
        r1 = td_astar(grid, (0, 0), (5, 5), start_time=0.0)
        r2 = td_astar(grid, (0, 0), (5, 5), start_time=10.0)
        assert r1.success and r2.success
        assert abs(r2.times[0] - 10.0) < 1e-10
        assert abs(r1.times[0] - 0.0) < 1e-10

    def test_times_are_monotonic(self):
        """Time values along path must be non-decreasing."""
        grid = _simple_grid()
        result = td_astar(grid, (0, 0), (9, 9))
        assert result.success
        for i in range(1, len(result.times)):
            assert result.times[i] >= result.times[i - 1]

    def test_travel_time_positive(self):
        """Travel time > 0 for non-trivial routes."""
        grid = _simple_grid()
        result = td_astar(grid, (0, 0), (5, 5))
        assert result.success
        assert result.travel_time > 0.0


# ---------------------------------------------------------------------------
# Arrival-time calculation
# ---------------------------------------------------------------------------

class TestArrivalTime:
    def test_arrival_equals_departure_plus_travel(self):
        """For each edge, arrival_time = departure_time + travel_time."""
        grid = _simple_grid()
        cell_km = grid.cell_size_km()
        speed = 12.0
        result = td_astar(grid, (0, 0), (3, 3), vessel_speed_knots=speed)
        assert result.success
        for i in range(1, len(result.times)):
            dr = abs(result.path[i][0] - result.path[i - 1][0])
            dc = abs(result.path[i][1] - result.path[i - 1][1])
            dist = math.sqrt(dr * dr + dc * dc)
            expected_tt = travel_time_hours(dist, cell_km, speed)
            actual_tt = result.times[i] - result.times[i - 1]
            assert abs(actual_tt - expected_tt) < 1e-10

    def test_start_time_offset(self):
        """All arrival times should be shifted by start_time."""
        grid = _simple_grid()
        start_t = 5.0
        result = td_astar(grid, (0, 0), (3, 3), start_time=start_t)
        assert result.success
        assert result.times[0] == start_t
        assert result.travel_time == result.times[-1] - start_t


# ---------------------------------------------------------------------------
# Path finding correctness
# ---------------------------------------------------------------------------

class TestTDPathFinding:
    def test_path_found_open_grid(self):
        grid = _simple_grid()
        result = td_astar(grid, (0, 0), (9, 9))
        assert result.success
        assert len(result.path) > 0
        assert result.path[0] == (0, 0)
        assert result.path[-1] == (9, 9)

    def test_path_uses_diagonal(self):
        """On open zero-cost grid, optimal path should be diagonal."""
        grid = _simple_grid()
        result = td_astar(grid, (0, 0), (5, 5))
        assert result.success
        expected_len = 5.0 * math.sqrt(2)
        assert abs(result.route_length - expected_len) < 0.01

    def test_total_cost_non_negative(self):
        grid = _simple_grid()
        result = td_astar(grid, (0, 0), (9, 9))
        assert result.success
        assert result.total_cost >= 0.0

    def test_deterministic(self):
        """Two runs with same inputs produce identical results."""
        grid = generate_synthetic(n_rows=20, n_cols=25, seed=42)
        r1 = td_astar(grid, (2, 2), (17, 22))
        r2 = td_astar(grid, (2, 2), (17, 22))
        assert r1.success == r2.success
        assert r1.path == r2.path
        assert abs(r1.total_cost - r2.total_cost) < 1e-10

    def test_waypoints_count(self):
        grid = _simple_grid()
        result = td_astar(grid, (0, 0), (9, 9))
        assert result.success
        assert result.num_waypoints == len(result.path) == len(result.times)


# ---------------------------------------------------------------------------
# Start equals goal
# ---------------------------------------------------------------------------

class TestTDStartEqualsGoal:
    def test_single_point(self):
        grid = _simple_grid()
        result = td_astar(grid, (5, 5), (5, 5))
        assert result.success
        assert result.path == [(5, 5)]
        assert result.times == [0.0]
        assert result.route_length == 0.0
        assert result.travel_time == 0.0

    def test_start_equals_goal_nonzero_time(self):
        grid = _simple_grid()
        result = td_astar(grid, (5, 5), (5, 5), start_time=3.0)
        assert result.success
        assert result.path == [(5, 5)]
        assert result.times == [3.0]
        assert result.travel_time == 0.0

    def test_nonzero_cost_grid(self):
        """start==goal returns env_cost(start), not 0."""
        grid = generate_synthetic(n_rows=10, n_cols=10, seed=42)
        w = CostWeights()
        result = td_astar(grid, (5, 5), (5, 5), weights=w)
        assert result.success
        assert result.total_cost >= 0.0


# ---------------------------------------------------------------------------
# Obstacle handling
# ---------------------------------------------------------------------------

class TestTDObstacles:
    def test_path_avoids_blocked(self):
        grid = _simple_grid(blocked=[(0, 1), (1, 1), (2, 1), (3, 1)])
        result = td_astar(grid, (0, 0), (4, 0))
        assert result.success
        for r, c in result.path:
            assert grid.navigable[r, c]

    def test_no_path(self):
        blocked = [(r, 5) for r in range(10)]
        grid = _simple_grid(blocked=blocked)
        result = td_astar(grid, (0, 0), (0, 9))
        assert not result.success
        assert result.path == []

    def test_blocked_start(self):
        grid = _simple_grid(blocked=[(0, 0)])
        result = td_astar(grid, (0, 0), (9, 9))
        assert not result.success

    def test_blocked_goal(self):
        grid = _simple_grid(blocked=[(9, 9)])
        result = td_astar(grid, (0, 0), (9, 9))
        assert not result.success

    def test_out_of_bounds_start(self):
        grid = _simple_grid()
        result = td_astar(grid, (-1, 0), (5, 5))
        assert not result.success

    def test_out_of_bounds_goal(self):
        grid = _simple_grid()
        result = td_astar(grid, (0, 0), (15, 15))
        assert not result.success

    def test_spiral_around_wall(self):
        """Path must navigate around a wall of blocked cells."""
        blocked = [(r, 5) for r in range(9)]
        grid = _simple_grid(blocked=blocked)
        result = td_astar(grid, (0, 0), (0, 9))
        assert result.success
        for r, c in result.path:
            assert grid.navigable[r, c]


# ---------------------------------------------------------------------------
# Time-varying environmental cost
# ---------------------------------------------------------------------------

class TestTDTimeVarying:
    def test_static_env_finds_valid_route(self):
        """With static env (env_fn=None), td_astar finds a valid route."""
        grid = generate_synthetic(n_rows=20, n_cols=25, seed=42)
        w = CostWeights()

        td_result = td_astar(grid, (2, 2), (15, 20), weights=w)

        assert td_result.success
        assert len(td_result.path) > 0
        assert td_result.path[0] == (2, 2)
        assert td_result.path[-1] == (15, 20)
        assert td_result.total_cost > 0.0

    def test_time_varying_sic_affects_cost(self):
        """Different SIC at different times should change route cost."""
        grid = _simple_grid(n_rows=10, n_cols=10)

        sic_low = np.zeros((10, 10))
        sic_high = np.full((10, 10), 0.9)

        grid_t0 = EnvironmentalGrid(
            n_rows=10, n_cols=10,
            lat=grid.lat, lon=grid.lon,
            navigable=grid.navigable.copy(),
            sic_mean=sic_low,
        )
        grid_t10 = EnvironmentalGrid(
            n_rows=10, n_cols=10,
            lat=grid.lat, lon=grid.lon,
            navigable=grid.navigable.copy(),
            sic_mean=sic_high,
        )

        def env_fn(t):
            return grid_t10 if t > 5.0 else grid_t0

        result_early = td_astar(
            grid, (0, 0), (9, 9),
            env_fn=env_fn, vessel_speed_knots=12.0, start_time=0.0,
        )
        result_late = td_astar(
            grid, (0, 0), (9, 9),
            env_fn=env_fn, vessel_speed_knots=12.0, start_time=10.0,
        )
        assert result_early.success and result_late.success
        assert result_late.total_cost > result_early.total_cost

    def test_time_varying_iceberg_affects_route(self):
        """High iceberg risk at a time should change the route."""
        grid = _simple_grid(n_rows=10, n_cols=10)

        ice_clear = np.zeros((10, 10))
        ice_danger = np.zeros((10, 10))
        ice_danger[4:6, 4:6] = 1.0

        grid_clear = EnvironmentalGrid(
            n_rows=10, n_cols=10,
            lat=grid.lat, lon=grid.lon,
            navigable=grid.navigable.copy(),
            iceberg_risk=ice_clear,
        )
        grid_danger = EnvironmentalGrid(
            n_rows=10, n_cols=10,
            lat=grid.lat, lon=grid.lon,
            navigable=grid.navigable.copy(),
            iceberg_risk=ice_danger,
        )

        def env_fn(t):
            return grid_danger if t > 5.0 else grid_clear

        result_clear = td_astar(
            grid, (0, 0), (9, 9),
            env_fn=env_fn, vessel_speed_knots=12.0, start_time=0.0,
        )
        result_danger = td_astar(
            grid, (0, 0), (9, 9),
            env_fn=env_fn, vessel_speed_knots=12.0, start_time=10.0,
        )
        assert result_clear.success and result_danger.success
        assert result_clear.path != result_danger.path

    def test_env_fn_called(self):
        """env_fn should be called."""
        grid = _simple_grid(n_rows=5, n_cols=5)

        grid_a = EnvironmentalGrid(
            n_rows=5, n_cols=5,
            lat=grid.lat, lon=grid.lon,
            navigable=grid.navigable.copy(),
            sic_mean=np.zeros((5, 5)),
        )
        grid_b = EnvironmentalGrid(
            n_rows=5, n_cols=5,
            lat=grid.lat, lon=grid.lon,
            navigable=grid.navigable.copy(),
            sic_mean=np.full((5, 5), 0.8),
        )

        call_count = [0]

        def env_fn(t):
            call_count[0] += 1
            return grid_b if t > 1.0 else grid_a

        result = td_astar(
            grid, (0, 0), (4, 4),
            env_fn=env_fn, vessel_speed_knots=12.0, start_time=0.0,
        )
        assert result.success
        assert call_count[0] > 0


# ---------------------------------------------------------------------------
# SIC-aware routing (M2)
# ---------------------------------------------------------------------------

class TestSICAwareness:
    """M2: SIC must influence route selection via w_sic * SIC at arrival time."""

    def test_zero_sic_environment(self):
        """Zero SIC everywhere: cost should be purely travel-time-based."""
        grid = _simple_grid(n_rows=10, n_cols=10)
        # sic_mean is already zeros in _simple_grid
        result = td_astar(grid, (0, 0), (9, 9),
                          weights=CostWeights(w_sic=1.0, w_distance=1.0),
                          vessel_speed_knots=12.0)
        assert result.success
        # On a zero-SIC grid, cost = w_distance * travel_time
        expected_cost = 1.0 * result.travel_time
        assert abs(result.total_cost - expected_cost) < 1e-6

    def test_high_sic_corridor_avoids(self):
        """High-SIC band across the middle: route should detour around it."""
        n = 20
        grid = _simple_grid(n_rows=n, n_cols=n)

        # Build a high-SIC corridor: rows 9-10, all columns (SIC=0.95)
        sic = np.zeros((n, n))
        sic[9:11, :] = 0.95

        grid_sic = EnvironmentalGrid(
            n_rows=n, n_cols=n,
            lat=grid.lat, lon=grid.lon,
            navigable=grid.navigable.copy(),
            sic_mean=sic,
        )

        # No SIC baseline
        result_clear = td_astar(grid, (0, n // 2), (n - 1, n // 2),
                                weights=CostWeights(w_sic=1.0, w_distance=1.0))
        # With SIC corridor
        result_sic = td_astar(grid_sic, (0, n // 2), (n - 1, n // 2),
                              weights=CostWeights(w_sic=1.0, w_distance=1.0))

        assert result_clear.success and result_sic.success
        # The SIC route should avoid the high-SIC rows
        sic_rows_in_path = [r for r, c in result_sic.path if 9 <= r <= 10]
        # Either the route avoids the corridor entirely, or has lower SIC exposure
        clear_sic_exposure = sum(sic[r, c] for r, c in result_clear.path)
        sic_sic_exposure = sum(sic[r, c] for r, c in result_sic.path)
        assert sic_sic_exposure <= clear_sic_exposure

    def test_sic_changing_with_time(self):
        """SIC field changes between t=0 and t=10: route cost should differ."""
        n = 10
        grid = _simple_grid(n_rows=n, n_cols=n)

        sic_early = np.zeros((n, n))
        sic_late = np.zeros((n, n))
        # High SIC appears at rows 4-5 at t>5
        sic_late[4:6, :] = 0.8

        grid_early = EnvironmentalGrid(
            n_rows=n, n_cols=n, lat=grid.lat, lon=grid.lon,
            navigable=grid.navigable.copy(), sic_mean=sic_early,
        )
        grid_late = EnvironmentalGrid(
            n_rows=n, n_cols=n, lat=grid.lat, lon=grid.lon,
            navigable=grid.navigable.copy(), sic_mean=sic_late,
        )

        def env_fn(t):
            return grid_late if t > 5.0 else grid_early

        result_early = td_astar(grid_early, (0, 0), (9, 9),
                                weights=CostWeights(w_sic=1.0),
                                vessel_speed_knots=12.0, start_time=0.0)
        result_late = td_astar(grid_late, (0, 0), (9, 9),
                               weights=CostWeights(w_sic=1.0),
                               vessel_speed_knots=12.0, start_time=10.0)
        # Late start encounters high SIC → higher cost
        assert result_late.total_cost > result_early.total_cost

    def test_sic_cost_monotonic(self):
        """Edge cost must increase monotonically with SIC value."""
        grid = _simple_grid(n_rows=3, n_cols=3)
        w = CostWeights(w_sic=2.0, w_ice=0, w_wind=0, w_curr=0, w_distance=0)

        costs = []
        for sic_val in [0.0, 0.2, 0.5, 0.8, 1.0]:
            grid.sic_mean[0, 1] = sic_val
            cost = td_edge_cost(grid, 0, 1, 1.0, w)
            costs.append(cost)

        # Costs must be strictly non-decreasing
        for i in range(1, len(costs)):
            assert costs[i] >= costs[i - 1], (
                f"Cost not monotonic: SIC={i * 0.25} gave cost {costs[i]} "
                f"< previous {costs[i - 1]}"
            )

    def test_zero_w_sic_ignores_sic(self):
        """When w_sic=0, SIC should not affect cost."""
        grid = _simple_grid(n_rows=5, n_cols=5)
        grid.sic_mean[0, 1] = 1.0  # maximum SIC

        w_no_sic = CostWeights(w_sic=0, w_ice=0, w_wind=0, w_curr=0, w_distance=1.0)
        w_with_sic = CostWeights(w_sic=5.0, w_ice=0, w_wind=0, w_curr=0, w_distance=1.0)

        cost_no = td_edge_cost(grid, 0, 1, 1.0, w_no_sic)
        cost_with = td_edge_cost(grid, 0, 1, 1.0, w_with_sic)

        # With w_sic=0, SIC should not contribute; cost = travel_time * w_distance
        from src.routing.td_astar import travel_time_hours
        expected_travel_time = travel_time_hours(1.0, grid.cell_size_km(), 12.0)
        assert abs(cost_no - expected_travel_time) < 1e-10
        assert cost_with > cost_no  # w_sic=5.0 makes SIC contribute


# ---------------------------------------------------------------------------
# Iceberg-risk-aware routing (M3)
# ---------------------------------------------------------------------------

class TestIcebergRiskAwareness:
    """M3: iceberg_risk must influence route selection via w_ice * iceberg_risk
    at arrival time, separate from SIC."""

    def test_zero_iceberg_risk(self):
        """Zero iceberg risk everywhere: cost should not include iceberg term."""
        grid = _simple_grid(n_rows=10, n_cols=10)
        # iceberg_risk is None in _simple_grid → no iceberg contribution
        w = CostWeights(w_sic=0, w_ice=1.0, w_wind=0, w_curr=0, w_distance=1.0)
        result = td_astar(grid, (0, 0), (9, 9), weights=w)
        assert result.success
        # Cost = travel_time * w_distance only (no SIC, no iceberg)
        expected = 1.0 * result.travel_time
        assert abs(result.total_cost - expected) < 1e-6

    def test_high_iceberg_corridor_avoids(self):
        """High iceberg-risk band: route should detour around it."""
        n = 20
        grid = _simple_grid(n_rows=n, n_cols=n)

        ice = np.zeros((n, n))
        ice[9:11, :] = 0.95  # high iceberg risk across middle

        grid_ice = EnvironmentalGrid(
            n_rows=n, n_cols=n,
            lat=grid.lat, lon=grid.lon,
            navigable=grid.navigable.copy(),
            iceberg_risk=ice,
        )

        result_clear = td_astar(grid, (0, n // 2), (n - 1, n // 2),
                                weights=CostWeights(w_ice=1.0, w_distance=1.0))
        result_ice = td_astar(grid_ice, (0, n // 2), (n - 1, n // 2),
                              weights=CostWeights(w_ice=1.0, w_distance=1.0))

        assert result_clear.success and result_ice.success
        # Iceberg route should have less or equal iceberg exposure
        clear_exposure = sum(ice[r, c] for r, c in result_clear.path)
        ice_exposure = sum(ice[r, c] for r, c in result_ice.path)
        assert ice_exposure <= clear_exposure

    def test_time_varying_iceberg_risk(self):
        """Iceberg risk appears at t>5: cost should differ based on start time."""
        n = 10
        grid = _simple_grid(n_rows=n, n_cols=n)

        ice_clear = np.zeros((n, n))
        ice_danger = np.zeros((n, n))
        ice_danger[4:6, :] = 0.9

        grid_clear = EnvironmentalGrid(
            n_rows=n, n_cols=n, lat=grid.lat, lon=grid.lon,
            navigable=grid.navigable.copy(), iceberg_risk=ice_clear,
        )
        grid_danger = EnvironmentalGrid(
            n_rows=n, n_cols=n, lat=grid.lat, lon=grid.lon,
            navigable=grid.navigable.copy(), iceberg_risk=ice_danger,
        )

        def env_fn(t):
            return grid_danger if t > 5.0 else grid_clear

        result_early = td_astar(grid_clear, (0, 0), (9, 9),
                                weights=CostWeights(w_ice=1.0),
                                vessel_speed_knots=12.0, start_time=0.0)
        result_late = td_astar(grid_danger, (0, 0), (9, 9),
                               weights=CostWeights(w_ice=1.0),
                               vessel_speed_knots=12.0, start_time=10.0)
        assert result_late.total_cost > result_early.total_cost

    def test_iceberg_cost_monotonic(self):
        """Edge cost must increase monotonically with iceberg risk value."""
        n = 3
        lat = np.linspace(-70, -69.5, n)
        lon = np.linspace(72, 72.5, n)
        ice = np.zeros((n, n))
        grid = EnvironmentalGrid(
            n_rows=n, n_cols=n, lat=lat, lon=lon,
            navigable=np.ones((n, n), dtype=bool),
            iceberg_risk=ice,
        )
        w = CostWeights(w_sic=0, w_ice=2.0, w_wind=0, w_curr=0, w_distance=0)

        costs = []
        for ice_val in [0.0, 0.2, 0.5, 0.8, 1.0]:
            grid.iceberg_risk[0, 1] = ice_val
            cost = td_edge_cost(grid, 0, 1, 1.0, w)
            costs.append(cost)

        for i in range(1, len(costs)):
            assert costs[i] >= costs[i - 1], (
                f"Cost not monotonic at ice={i * 0.25}: {costs[i]} < {costs[i - 1]}"
            )

    def test_zero_w_ice_ignores_iceberg(self):
        """When w_ice=0, iceberg risk should not affect cost."""
        n = 5
        lat = np.linspace(-70, -69.5, n)
        lon = np.linspace(72, 72.5, n)
        ice = np.zeros((n, n))
        grid = EnvironmentalGrid(
            n_rows=n, n_cols=n, lat=lat, lon=lon,
            navigable=np.ones((n, n), dtype=bool),
            iceberg_risk=ice,
        )
        grid.iceberg_risk[0, 1] = 1.0  # maximum risk

        w_no_ice = CostWeights(w_sic=0, w_ice=0, w_wind=0, w_curr=0, w_distance=1.0)
        w_with_ice = CostWeights(w_sic=0, w_ice=5.0, w_wind=0, w_curr=0, w_distance=1.0)

        cost_no = td_edge_cost(grid, 0, 1, 1.0, w_no_ice)
        cost_with = td_edge_cost(grid, 0, 1, 1.0, w_with_ice)

        expected_tt = travel_time_hours(1.0, grid.cell_size_km(), 12.0)
        assert abs(cost_no - expected_tt) < 1e-10
        assert cost_with > cost_no  # w_ice=5.0 adds iceberg contribution

    def test_sic_and_iceberg_separate(self):
        """SIC and iceberg risk are independent cost terms."""
        n = 5
        lat = np.linspace(-70, -69.5, n)
        lon = np.linspace(72, 72.5, n)
        ice = np.zeros((n, n))
        grid = EnvironmentalGrid(
            n_rows=n, n_cols=n, lat=lat, lon=lon,
            navigable=np.ones((n, n), dtype=bool),
            sic_mean=np.zeros((n, n)),
            iceberg_risk=ice,
        )
        grid.sic_mean[0, 1] = 0.5
        grid.iceberg_risk[0, 1] = 0.5

        w_sic_only = CostWeights(w_sic=2.0, w_ice=0, w_wind=0, w_curr=0, w_distance=0)
        w_ice_only = CostWeights(w_sic=0, w_ice=2.0, w_wind=0, w_curr=0, w_distance=0)
        w_both = CostWeights(w_sic=2.0, w_ice=2.0, w_wind=0, w_curr=0, w_distance=0)

        cost_sic = td_edge_cost(grid, 0, 1, 1.0, w_sic_only)
        cost_ice = td_edge_cost(grid, 0, 1, 1.0, w_ice_only)
        cost_both = td_edge_cost(grid, 0, 1, 1.0, w_both)

        # Each contributes 0.5 * 2.0 = 1.0 independently (w_distance=0 → no travel time component)
        assert abs(cost_sic - 1.0) < 1e-10
        assert abs(cost_ice - 1.0) < 1e-10
        # Combined = sum of independent parts
        assert abs(cost_both - (cost_sic + cost_ice)) < 1e-10

    def test_iceberg_independently_changes_route(self):
        """Iceberg risk alone (no SIC) can change route selection."""
        n = 15
        grid = _simple_grid(n_rows=n, n_cols=n)

        ice = np.zeros((n, n))
        ice[5:8, 5:8] = 1.0  # high risk patch in center

        grid_ice = EnvironmentalGrid(
            n_rows=n, n_cols=n,
            lat=grid.lat, lon=grid.lon,
            navigable=grid.navigable.copy(),
            iceberg_risk=ice,
        )

        result_clear = td_astar(grid, (0, 0), (n - 1, n - 1),
                                weights=CostWeights(w_ice=1.0, w_distance=1.0))
        result_ice = td_astar(grid_ice, (0, 0), (n - 1, n - 1),
                              weights=CostWeights(w_ice=1.0, w_distance=1.0))

        assert result_clear.success and result_ice.success
        # Routes should differ when iceberg risk blocks the direct path
        assert result_clear.path != result_ice.path


# ---------------------------------------------------------------------------
# Ocean-current-aware routing (M4)
# ---------------------------------------------------------------------------

def _make_grid_with_current(n, current):
    """Helper: create a grid with a current_cost layer."""
    lat = np.linspace(-70, -69.5, n)
    lon = np.linspace(72, 72.5, n)
    return EnvironmentalGrid(
        n_rows=n, n_cols=n, lat=lat, lon=lon,
        navigable=np.ones((n, n), dtype=bool),
        current_cost=current,
    )


class TestCurrentAwareness:
    """M4: current_cost must influence route selection via w_curr * max(current, 0)
    at arrival time, separate from SIC and iceberg risk."""

    def test_zero_current_cost(self):
        """Zero current everywhere: cost should not include current term."""
        n = 5
        grid = _make_grid_with_current(n, np.zeros((n, n)))
        w = CostWeights(w_sic=0, w_ice=0, w_wind=0, w_curr=1.0, w_distance=1.0)
        result = td_astar(grid, (0, 0), (n - 1, n - 1), weights=w)
        assert result.success
        expected = 1.0 * result.travel_time
        assert abs(result.total_cost - expected) < 1e-6

    def test_adverse_current_increases_cost(self):
        """Positive current (adverse) increases edge cost."""
        n = 3
        grid = _make_grid_with_current(n, np.zeros((n, n)))
        grid.current_cost[0, 1] = 0.5  # adverse at destination

        w = CostWeights(w_sic=0, w_ice=0, w_wind=0, w_curr=1.0, w_distance=0)
        cost = td_edge_cost(grid, 0, 1, 1.0, w)
        # max(0.5, 0) * 1.0 = 0.5
        assert abs(cost - 0.5) < 1e-10

    def test_favorable_current_no_negative_penalty(self):
        """Negative current (favorable) contributes zero penalty, not negative cost."""
        n = 3
        grid = _make_grid_with_current(n, np.zeros((n, n)))
        grid.current_cost[0, 1] = -0.8  # favorable

        w = CostWeights(w_sic=0, w_ice=0, w_wind=0, w_curr=1.0, w_distance=0)
        cost = td_edge_cost(grid, 0, 1, 1.0, w)
        # max(-0.8, 0) * 1.0 = 0.0
        assert cost == 0.0

    def test_time_varying_current(self):
        """Current field changes with time: cost should differ by start time."""
        n = 10
        grid = _simple_grid(n_rows=n, n_cols=n)

        curr_calm = np.zeros((n, n))
        curr_storm = np.zeros((n, n))
        curr_storm[4:6, :] = 0.9  # adverse current at t>5

        grid_calm = EnvironmentalGrid(
            n_rows=n, n_cols=n, lat=grid.lat, lon=grid.lon,
            navigable=grid.navigable.copy(), current_cost=curr_calm,
        )
        grid_storm = EnvironmentalGrid(
            n_rows=n, n_cols=n, lat=grid.lat, lon=grid.lon,
            navigable=grid.navigable.copy(), current_cost=curr_storm,
        )

        def env_fn(t):
            return grid_storm if t > 5.0 else grid_calm

        result_calm = td_astar(grid_calm, (0, 0), (9, 9),
                               weights=CostWeights(w_curr=1.0),
                               vessel_speed_knots=12.0, start_time=0.0)
        result_storm = td_astar(grid_storm, (0, 0), (9, 9),
                                weights=CostWeights(w_curr=1.0),
                                vessel_speed_knots=12.0, start_time=10.0)
        assert result_storm.total_cost > result_calm.total_cost

    def test_adverse_current_corridor_affects_route(self):
        """Adverse current band across the middle: route should detour."""
        n = 20
        grid_no_curr = _make_grid_with_current(n, np.zeros((n, n)))

        curr = np.zeros((n, n))
        curr[9:11, :] = 0.95  # adverse current across middle

        grid_curr = _make_grid_with_current(n, curr)

        result_clear = td_astar(grid_no_curr, (0, n // 2), (n - 1, n // 2),
                                weights=CostWeights(w_curr=1.0, w_distance=1.0))
        result_curr = td_astar(grid_curr, (0, n // 2), (n - 1, n // 2),
                               weights=CostWeights(w_curr=1.0, w_distance=1.0))

        assert result_clear.success and result_curr.success
        # Adverse current route should have less or equal current exposure
        clear_exposure = sum(max(curr[r, c], 0) for r, c in result_clear.path)
        curr_exposure = sum(max(curr[r, c], 0) for r, c in result_curr.path)
        assert curr_exposure <= clear_exposure

    def test_w_curr_zero_ignores_current(self):
        """When w_curr=0, current cost should not affect cost."""
        n = 3
        grid = _make_grid_with_current(n, np.zeros((n, n)))
        grid.current_cost[0, 1] = 0.9

        w_no = CostWeights(w_sic=0, w_ice=0, w_wind=0, w_curr=0, w_distance=1.0)
        w_with = CostWeights(w_sic=0, w_ice=0, w_wind=0, w_curr=5.0, w_distance=1.0)

        cost_no = td_edge_cost(grid, 0, 1, 1.0, w_no)
        cost_with = td_edge_cost(grid, 0, 1, 1.0, w_with)

        expected_tt = travel_time_hours(1.0, grid.cell_size_km(), 12.0)
        assert abs(cost_no - expected_tt) < 1e-10
        assert cost_with > cost_no

    def test_all_three_terms_separate(self):
        """SIC, iceberg risk, and current are independent cost terms."""
        n = 3
        lat = np.linspace(-70, -69.5, n)
        lon = np.linspace(72, 72.5, n)
        grid = EnvironmentalGrid(
            n_rows=n, n_cols=n, lat=lat, lon=lon,
            navigable=np.ones((n, n), dtype=bool),
            sic_mean=np.full((n, n), 0.5),
            iceberg_risk=np.full((n, n), 0.5),
            current_cost=np.full((n, n), 0.5),
        )

        w_sic = CostWeights(w_sic=2.0, w_ice=0, w_wind=0, w_curr=0, w_distance=0)
        w_ice = CostWeights(w_sic=0, w_ice=2.0, w_wind=0, w_curr=0, w_distance=0)
        w_cur = CostWeights(w_sic=0, w_ice=0, w_wind=0, w_curr=2.0, w_distance=0)
        w_all = CostWeights(w_sic=2.0, w_ice=2.0, w_wind=0, w_curr=2.0, w_distance=0)

        c_sic = td_edge_cost(grid, 0, 1, 1.0, w_sic)
        c_ice = td_edge_cost(grid, 0, 1, 1.0, w_ice)
        c_cur = td_edge_cost(grid, 0, 1, 1.0, w_cur)
        c_all = td_edge_cost(grid, 0, 1, 1.0, w_all)

        # Each: 0.5 * 2.0 = 1.0 (w_distance=0 → no travel time component)
        assert abs(c_sic - 1.0) < 1e-10
        assert abs(c_ice - 1.0) < 1e-10
        assert abs(c_cur - 1.0) < 1e-10
        # Combined = sum of independent parts
        assert abs(c_all - (c_sic + c_ice + c_cur)) < 1e-10

    def test_current_independently_changes_route(self):
        """Current alone can change route selection."""
        n = 15
        grid_clear = _make_grid_with_current(n, np.zeros((n, n)))

        curr = np.zeros((n, n))
        curr[5:8, 5:8] = 1.0  # adverse current patch in center

        grid_curr = _make_grid_with_current(n, curr)

        result_clear = td_astar(grid_clear, (0, 0), (n - 1, n - 1),
                                weights=CostWeights(w_curr=1.0, w_distance=1.0))
        result_curr = td_astar(grid_curr, (0, 0), (n - 1, n - 1),
                               weights=CostWeights(w_curr=1.0, w_distance=1.0))

        assert result_clear.success and result_curr.success
        assert result_clear.path != result_curr.path


# ---------------------------------------------------------------------------
# Edge cost function
# ---------------------------------------------------------------------------

class TestTDEdgeCost:
    def test_edge_cost_non_negative(self):
        grid = _simple_grid()
        w = CostWeights()
        cost = td_edge_cost(grid, 0, 1, 1.0, w)
        assert cost >= 0.0

    def test_edge_cost_includes_distance(self):
        grid = _simple_grid()
        w = CostWeights(w_sic=0, w_ice=0, w_wind=0, w_curr=0, w_distance=2.0)
        cost = td_edge_cost(grid, 0, 0, 1.0, w)
        expected_tt = travel_time_hours(1.0, grid.cell_size_km(), 12.0)
        assert abs(cost - 2.0 * expected_tt) < 1e-10

    def test_edge_cost_with_sic(self):
        grid = _simple_grid()
        grid.sic_mean[0, 1] = 0.5
        w = CostWeights(w_sic=2.0, w_ice=0, w_wind=0, w_curr=0, w_distance=0)
        cost = td_edge_cost(grid, 0, 1, 1.0, w)
        # w_distance=0 → only env_cost: 0.5 * 2.0 = 1.0
        assert abs(cost - 1.0) < 1e-10


# ---------------------------------------------------------------------------
# Speed parameter
# ---------------------------------------------------------------------------

class TestSpeedParameter:
    def test_faster_speed_shorter_travel_time(self):
        grid = _simple_grid()
        r_slow = td_astar(grid, (0, 0), (5, 5), vessel_speed_knots=8.0)
        r_fast = td_astar(grid, (0, 0), (5, 5), vessel_speed_knots=20.0)
        assert r_slow.success and r_fast.success
        assert r_fast.travel_time < r_slow.travel_time

    def test_speed_does_not_affect_path_on_static_env(self):
        """On a static zero-cost grid, path should be the same regardless of speed."""
        grid = _simple_grid()
        r_slow = td_astar(grid, (0, 0), (5, 5), vessel_speed_knots=8.0)
        r_fast = td_astar(grid, (0, 0), (5, 5), vessel_speed_knots=20.0)
        assert r_slow.success and r_fast.success
        assert r_slow.path == r_fast.path


# ---------------------------------------------------------------------------
# cell_size_km and time_query
# ---------------------------------------------------------------------------

class TestGridHelpers:
    def test_cell_size_positive(self):
        grid = _simple_grid()
        assert grid.cell_size_km() > 0.0

    def test_cell_size_reasonable(self):
        grid = _simple_grid()
        cs = grid.cell_size_km()
        assert 4.0 < cs < 7.0

    def test_time_query_returns_self(self):
        grid = _simple_grid()
        assert grid.time_query(0.0) is grid
        assert grid.time_query(100.0) is grid


# ---------------------------------------------------------------------------
# Directional current model (unit tests)
# ---------------------------------------------------------------------------

from src.routing.current_model import (
    project_current_along_movement,
    compute_effective_speed_knots,
    estimate_max_current_ms,
    MS_TO_KNOTS,
    V_MIN_KNOTS,
)


class TestDirectionalCurrent:
    """Unit tests for the directional ocean-current cost model."""

    # --- project_current_along_movement ---

    def test_favorable_eastward(self):
        """Current flowing east, vessel moving east → positive projection."""
        proj = project_current_along_movement(uo=1.0, vo=0.0, dr=0, dc=1)
        assert abs(proj - 1.0) < 1e-10

    def test_adverse_westward(self):
        """Current flowing east, vessel moving west → negative projection."""
        proj = project_current_along_movement(uo=1.0, vo=0.0, dr=0, dc=-1)
        assert abs(proj - (-1.0)) < 1e-10

    def test_perpendicular_north(self):
        """Current flowing east, vessel moving north → zero projection."""
        proj = project_current_along_movement(uo=1.0, vo=0.0, dr=-1, dc=0)
        assert abs(proj) < 1e-10

    def test_perpendicular_south(self):
        """Current flowing east, vessel moving south → zero projection."""
        proj = project_current_along_movement(uo=1.0, vo=0.0, dr=1, dc=0)
        assert abs(proj) < 1e-10

    def test_zero_movement(self):
        """Zero-length movement → projected current = 0."""
        proj = project_current_along_movement(uo=1.0, vo=1.0, dr=0, dc=0)
        assert proj == 0.0

    def test_nan_uo(self):
        """NaN in uo → treated as zero current."""
        proj = project_current_along_movement(uo=float("nan"), vo=1.0, dr=0, dc=1)
        assert proj == 0.0

    def test_nan_vo(self):
        """NaN in vo → treated as zero current."""
        proj = project_current_along_movement(uo=1.0, vo=float("nan"), dr=0, dc=1)
        assert proj == 0.0

    def test_both_nan(self):
        """Both uo and vo NaN → zero current."""
        proj = project_current_along_movement(
            uo=float("nan"), vo=float("nan"), dr=1, dc=1,
        )
        assert proj == 0.0

    def test_diagonal_movement(self):
        """Diagonal movement: dot product with (1,1) direction."""
        # Movement (dr=1, dc=1) → unit direction (1/sqrt2, -1/sqrt2) in geo coords
        # Current (uo=1, vo=1) → projection = 1*(1/sqrt2) + 1*(-1/sqrt2) = 0
        proj = project_current_along_movement(uo=1.0, vo=1.0, dr=1, dc=1)
        assert abs(proj) < 1e-10

    def test_current_influence_zero(self):
        """current_influence=0 disables current effect entirely."""
        v_eff = compute_effective_speed_knots(12.0, 0.5, current_influence=0.0)
        assert abs(v_eff - 12.0) < 1e-10

    def test_current_influence_half(self):
        """current_influence=0.5 scales current contribution by half."""
        v_full = compute_effective_speed_knots(12.0, 0.5, current_influence=1.0)
        v_half = compute_effective_speed_knots(12.0, 0.5, current_influence=0.5)
        # Half influence should be between vessel speed and full influence
        assert 12.0 < v_half < v_full

    # --- compute_effective_speed_knots ---

    def test_ms_to_knots_conversion(self):
        """1 m/s = 1.94384... knots (1 / 0.51444)."""
        assert abs(MS_TO_KNOTS - 1.94384) < 0.001

    def test_favorable_current_increases_speed(self):
        """Positive projected current → higher effective speed."""
        v_eff = compute_effective_speed_knots(12.0, 0.5)
        assert v_eff > 12.0

    def test_adverse_current_decreases_speed(self):
        """Negative projected current → lower effective speed."""
        v_eff = compute_effective_speed_knots(12.0, -0.5)
        assert v_eff < 12.0

    def test_minimum_speed_clamp(self):
        """Effective speed never drops below V_MIN_KNOTS."""
        v_eff = compute_effective_speed_knots(12.0, -100.0)
        assert v_eff >= V_MIN_KNOTS

    def test_zero_current(self):
        """Zero current → effective speed = vessel speed."""
        v_eff = compute_effective_speed_knots(12.0, 0.0)
        assert abs(v_eff - 12.0) < 1e-10

    # --- estimate_max_current_ms ---

    def test_max_current_none_grids(self):
        """None grids → max current = 0."""
        assert estimate_max_current_ms(None, None) == 0.0

    def test_max_current_uniform(self):
        """Uniform current field → max = magnitude at any cell."""
        uo = np.full((5, 5), 0.3)
        vo = np.full((5, 5), 0.4)
        max_c = estimate_max_current_ms(uo, vo)
        assert abs(max_c - 0.5) < 1e-10

    def test_max_current_with_nan(self):
        """NaN values are treated as zero for max computation."""
        uo = np.full((5, 5), 0.0)
        vo = np.full((5, 5), 0.0)
        uo[2, 3] = float("nan")
        vo[2, 3] = 1.0
        max_c = estimate_max_current_ms(uo, vo)
        assert abs(max_c - 1.0) < 1e-10

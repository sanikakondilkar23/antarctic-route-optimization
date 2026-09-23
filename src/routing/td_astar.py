"""
Time-Dependent A* for Antarctic Route Optimization
===================================================

Search state: (row, col, time)

Travel-time chain (NEVER dt = edge_cost / cost_weight):
    edge_distance (grid units)
  -> cell_size_km (from grid)
  -> edge_distance_km
  -> vessel_speed_knots (configurable)
  -> travel_time = edge_distance_km / vessel_speed_kmh
  -> arrival_time = departure_time + travel_time
  -> environmental conditions evaluated at arrival_time
  -> edge cost computed from conditions + distance weight

Heuristic:
    h(n) = w_distance * euclidean_distance(n, goal)
    (admissible: ignores environmental cost, assumes minimum cost per step)

This module does NOT modify the deterministic baseline in astar.py.
"""

from __future__ import annotations

import heapq
import math
import time as time_mod
from dataclasses import dataclass
from typing import Callable, List, Tuple

from src.environment.grid import EnvironmentalGrid
from src.routing.cost import CostWeights, DIRS_8
from src.routing.current_model import (
    project_current_along_movement,
    compute_effective_speed_knots,
    estimate_max_current_ms,
)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

KNOTS_TO_KMH = 1.852


# ---------------------------------------------------------------------------
# Result container
# ---------------------------------------------------------------------------

@dataclass
class TDRouteResult:
    """Container for time-dependent A* output."""

    success: bool
    path: List[Tuple[int, int]]
    times: List[float]
    total_cost: float
    route_length: float
    travel_time: float
    expanded_nodes: int
    elapsed_seconds: float

    @property
    def num_waypoints(self) -> int:
        return len(self.path)


# ---------------------------------------------------------------------------
# Travel-time helper
# ---------------------------------------------------------------------------

def travel_time_hours(
    edge_distance_grid: float,
    cell_size_km: float,
    vessel_speed_knots: float,
    projected_current_ms: float = 0.0,
    current_influence: float = 1.0,
) -> float:
    """
    Compute travel time in hours for one edge.

    Parameters
    ----------
    edge_distance_grid : float
        Distance in grid units (1.0 cardinal, sqrt(2) diagonal).
    cell_size_km : float
        Real-world size of one grid cell in km.
    vessel_speed_knots : float
        Vessel speed in knots.
    projected_current_ms : float
        Ocean-current component along movement direction (m/s).
        Positive = favorable, negative = adverse.  Default 0.0.
    current_influence : float
        Scaling factor for current effect (0.0 to 1.0).  Default 1.0.

    Returns
    -------
    float
        Travel time in hours.
    """
    edge_distance_km = edge_distance_grid * cell_size_km
    v_eff = compute_effective_speed_knots(
        vessel_speed_knots, projected_current_ms, current_influence,
    )
    return edge_distance_km / (v_eff * KNOTS_TO_KMH)


# ---------------------------------------------------------------------------
# Heuristic (admissible lower bound)
# ---------------------------------------------------------------------------

def td_heuristic(
    row: int, col: int,
    goal_row: int, goal_col: int,
    w_distance: float = 1.0,
) -> float:
    """
    Admissible heuristic: w_distance * euclidean_distance(grid units).

    Always a lower bound on remaining cost because:
        - every edge costs at least w_distance * 1.0 (cardinal step)
        - euclidean distance <= any grid path length
    """
    return w_distance * math.sqrt((row - goal_row) ** 2 + (col - goal_col) ** 2)


# ---------------------------------------------------------------------------
# Edge cost at a specific arrival time
# ---------------------------------------------------------------------------

def td_edge_cost(
    env_at_t: EnvironmentalGrid,
    dst_row: int,
    dst_col: int,
    edge_distance_grid: float,
    weights: CostWeights,
    projected_current_ms: float = 0.0,
    vessel_speed_knots: float = 12.0,
    current_influence: float = 1.0,
) -> float:
    """
    Edge cost using environmental conditions at arrival time.

    cost = travel_time * w_distance + environmental_cost(dst)

    Parameters
    ----------
    env_at_t : EnvironmentalGrid
        The environmental grid at the arrival time.
    dst_row, dst_col : int
        Destination cell.
    edge_distance_grid : float
        Movement distance in grid units.
    weights : CostWeights
        Cost weights.
    projected_current_ms : float
        Current component along movement direction (m/s).  Default 0.0.
    vessel_speed_knots : float
        Vessel speed in knots (for travel-time calculation).
    current_influence : float
        Scaling factor for current effect (0.0 to 1.0).

    Returns
    -------
    float
        Non-negative edge cost.
    """
    # Travel time with directional current
    edge_distance_km = edge_distance_grid * env_at_t.cell_size_km()
    v_eff = compute_effective_speed_knots(
        vessel_speed_knots, projected_current_ms, current_influence,
    )
    travel_time_h = edge_distance_km / (v_eff * KNOTS_TO_KMH)

    # Environmental cost (SIC, iceberg, wind, scalar current)
    env_cost = 0.0
    if env_at_t.sic_mean is not None:
        env_cost += weights.w_sic * float(env_at_t.sic_mean[dst_row, dst_col])
    if env_at_t.iceberg_risk is not None:
        env_cost += weights.w_ice * float(env_at_t.iceberg_risk[dst_row, dst_col])
    if env_at_t.wind_cost is not None:
        env_cost += weights.w_wind * float(env_at_t.wind_cost[dst_row, dst_col])
    if env_at_t.current_cost is not None:
        env_cost += weights.w_curr * max(float(env_at_t.current_cost[dst_row, dst_col]), 0.0)

    return travel_time_h * weights.w_distance + env_cost


# ---------------------------------------------------------------------------
# Time-dependent A*
# ---------------------------------------------------------------------------

def td_astar(
    grid: EnvironmentalGrid,
    start: Tuple[int, int],
    goal: Tuple[int, int],
    weights: CostWeights | None = None,
    vessel_speed_knots: float = 12.0,
    start_time: float = 0.0,
    env_fn: Callable[[float], EnvironmentalGrid] | None = None,
    max_time: float = 500.0,
    max_expanded: int = 100_000,
) -> TDRouteResult:
    """
    Time-dependent A* on an environmental grid.

    State: (row, col, time)

    Travel-time chain:
        edge_distance_grid -> edge_distance_km -> travel_time -> arrival_time
        -> env conditions at arrival_time -> edge cost

    Parameters
    ----------
    grid : EnvironmentalGrid
        Static environmental grid (used if env_fn is None).
    start, goal : (row, col)
        Start and goal cell coordinates.
    weights : CostWeights, optional
        Cost weights. Defaults to CostWeights().
    vessel_speed_knots : float
        Vessel speed in knots (from config).
    start_time : float
        Departure time in hours (default 0.0).
    env_fn : callable, optional
        Function: t -> EnvironmentalGrid. Returns the environmental grid
        at time t (hours). If None, uses the static grid for all times.
    max_time : float
        Maximum voyage time in hours. Prevents unbounded search.
    max_expanded : int
        Maximum nodes to expand. Safety bound.

    Returns
    -------
    TDRouteResult
    """
    if weights is None:
        weights = CostWeights()

    r_s, c_s = start
    r_g, c_g = goal
    n_rows, n_cols = grid.n_rows, grid.n_cols

    # --- Validate start / goal ---
    if not (0 <= r_s < n_rows and 0 <= c_s < n_cols):
        return TDRouteResult(False, [], [], 0.0, 0.0, 0.0, 0, 0.0)
    if not (0 <= r_g < n_rows and 0 <= c_g < n_cols):
        return TDRouteResult(False, [], [], 0.0, 0.0, 0.0, 0, 0.0)
    if not grid.navigable[r_s, c_s] or not grid.navigable[r_g, c_g]:
        return TDRouteResult(False, [], [], 0.0, 0.0, 0.0, 0, 0.0)

    # --- Trivial: start == goal ---
    if start == goal:
        env_at_t0 = env_fn(start_time) if env_fn else grid
        env_cost = _cell_env_cost(env_at_t0, r_s, c_s, weights)
        return TDRouteResult(
            success=True, path=[start], times=[start_time],
            total_cost=env_cost, route_length=0.0, travel_time=0.0,
            expanded_nodes=0, elapsed_seconds=0.0,
        )

    cell_size_km = grid.cell_size_km()

    def h(r, c):
        return td_heuristic(r, c, r_g, c_g, weights.w_distance)

    # Start environmental cost at start_time
    env_at_start = env_fn(start_time) if env_fn else grid
    start_env_cost = _cell_env_cost(env_at_start, r_s, c_s, weights)

    # --- A* search ---
    counter = 0
    open_set: list = []
    heapq.heappush(open_set, (start_env_cost + h(r_s, c_s), counter, r_s, c_s, start_time))

    g_score: dict = {(r_s, c_s, start_time): start_env_cost}
    parent: dict = {}

    expanded = 0
    t0 = time_mod.perf_counter()

    while open_set:
        f_current, _, r_cur, c_cur, t_cur = heapq.heappop(open_set)
        expanded += 1

        if expanded > max_expanded:
            break

        # Goal check
        if (r_cur, c_cur) == (r_g, c_g):
            elapsed = time_mod.perf_counter() - t0
            path, times = _reconstruct(parent, start, (r_g, c_g, t_cur))
            route_len = _route_length(path)
            total_g = g_score[(r_g, c_g, t_cur)]

            return TDRouteResult(
                success=True,
                path=path,
                times=times,
                total_cost=total_g,
                route_length=route_len,
                travel_time=t_cur - start_time,
                expanded_nodes=expanded,
                elapsed_seconds=elapsed,
            )

        # Skip stale entries
        current_g = g_score.get((r_cur, c_cur, t_cur), float("inf"))
        if current_g < f_current - h(r_cur, c_cur) - 1e-12:
            continue

        # Expand 8-connected neighbours
        for dr, dc, dist in DIRS_8:
            nr, nc = r_cur + dr, c_cur + dc

            if not (0 <= nr < n_rows and 0 <= nc < n_cols):
                continue
            if not grid.navigable[nr, nc]:
                continue

            # Project current onto movement direction (single computation)
            proj_curr = 0.0
            if grid.current_uo is not None and grid.current_vo is not None:
                uo_val = float(grid.current_uo[nr, nc])
                vo_val = float(grid.current_vo[nr, nc])
                proj_curr = project_current_along_movement(uo_val, vo_val, dr, dc)

            # Travel time
            tt_h = travel_time_hours(dist, cell_size_km, vessel_speed_knots, proj_curr)
            arrival_time = t_cur + tt_h

            if arrival_time > max_time:
                continue

            # Edge cost at arrival time
            env_at_arrival = env_fn(arrival_time) if env_fn else grid
            edge_cost = td_edge_cost(
                env_at_arrival, nr, nc, dist, weights,
                projected_current_ms=proj_curr,
                vessel_speed_knots=vessel_speed_knots,
            )

            # Total cost to reach neighbour via this path
            tentative_g = current_g + edge_cost

            state_key = (nr, nc, arrival_time)
            if tentative_g < g_score.get(state_key, float("inf")):
                parent[state_key] = (r_cur, c_cur, t_cur)
                g_score[state_key] = tentative_g
                f = tentative_g + h(nr, nc)
                counter += 1
                heapq.heappush(open_set, (f, counter, nr, nc, arrival_time))

    elapsed = time_mod.perf_counter() - t0
    return TDRouteResult(False, [], [], 0.0, 0.0, 0.0, expanded, elapsed)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _cell_env_cost(
    env: EnvironmentalGrid, row: int, col: int, weights: CostWeights,
) -> float:
    """Compute weighted environmental cost for a single cell."""
    cost = 0.0
    if env.sic_mean is not None:
        cost += weights.w_sic * float(env.sic_mean[row, col])
    if env.iceberg_risk is not None:
        cost += weights.w_ice * float(env.iceberg_risk[row, col])
    if env.wind_cost is not None:
        cost += weights.w_wind * float(env.wind_cost[row, col])
    if env.current_cost is not None:
        cost += weights.w_curr * max(float(env.current_cost[row, col]), 0.0)
    return cost


def _reconstruct(
    parent: dict,
    start: Tuple[int, int],
    goal_state: Tuple[int, int, float],
) -> Tuple[List[Tuple[int, int]], List[float]]:
    """Reconstruct path and time list from parent pointers."""
    path = []
    times = []
    state = goal_state
    while state[:2] != start:
        path.append((state[0], state[1]))
        times.append(state[2])
        state = parent[state]
    path.append(start)
    times.append(state[2])
    path.reverse()
    times.reverse()
    return path, times


def _route_length(path: List[Tuple[int, int]]) -> float:
    """Sum of Euclidean distances along path in grid units."""
    length = 0.0
    for i in range(1, len(path)):
        dr = path[i][0] - path[i - 1][0]
        dc = path[i][1] - path[i - 1][1]
        length += math.sqrt(dr * dr + dc * dc)
    return length

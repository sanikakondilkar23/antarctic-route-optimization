"""
Deterministic A* Baseline
==========================

Standard grid-based A* on an EnvironmentalGrid.

Graph:
    Nodes = navigable cells (row, col)

Edges:
    8-connected neighbours (cardinal + diagonal)

Cost:
    edge_cost(src, dst) = environmental_cost(dst) + w_distance * distance

Heuristic:
    Euclidean distance in grid coordinates (admissible for 8-connected grid).

Returns:
    A RouteResult containing the path, cost, expanded count, and status.

This is a RESEARCH BASELINE for comparison. It is NOT the final proposed
uncertainty-aware method.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import List, Optional, Tuple

import numpy as np

from src.environment.grid import EnvironmentalGrid
from src.routing.cost import CostMap, CostWeights, DIRS_8


@dataclass
class RouteResult:
    """Container for A* output."""

    success: bool
    path: List[Tuple[int, int]]
    total_cost: float
    route_length: float
    expanded_nodes: int
    elapsed_seconds: float

    @property
    def num_waypoints(self) -> int:
        return len(self.path)


def euclidean_heuristic(a: Tuple[int, int], b: Tuple[int, int]) -> float:
    """
    Euclidean distance between two grid cells.

    Admissible for 8-connected movement because the true shortest path
    distance is always >= the straight-line Euclidean distance.
    """
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)


def astar(
    grid: EnvironmentalGrid,
    start: Tuple[int, int],
    goal: Tuple[int, int],
    weights: Optional[CostWeights] = None,
) -> RouteResult:
    """
    Run A* on the grid.

    Parameters
    ----------
    grid : EnvironmentalGrid
        The environmental grid to search on.
    start : (row, col)
        Start cell coordinates.
    goal : (row, col)
        Goal cell coordinates.
    weights : CostWeights, optional
        Cost weights. Defaults to CostWeights().

    Returns
    -------
    RouteResult
        Contains the path, cost, expanded count, and success flag.
    """
    import heapq

    if weights is None:
        weights = CostWeights()

    r_s, c_s = start
    r_g, c_g = goal

    # Validate start and goal
    if not (0 <= r_s < grid.n_rows and 0 <= c_s < grid.n_cols):
        return RouteResult(False, [], 0.0, 0.0, 0, 0.0)
    if not (0 <= r_g < grid.n_rows and 0 <= c_g < grid.n_cols):
        return RouteResult(False, [], 0.0, 0.0, 0, 0.0)
    if not grid.navigable[r_s, c_s] or not grid.navigable[r_g, c_g]:
        return RouteResult(False, [], 0.0, 0.0, 0, 0.0)

    # Trivial: start == goal
    if start == goal:
        cost_map = CostMap(grid, weights)
        start_cost = cost_map.cell_cost(r_s, c_s)
        return RouteResult(True, [start], start_cost, 0.0, 0, 0.0)

    cost_map = CostMap(grid, weights)

    # Include start-cell environmental cost in g_score
    start_env_cost = cost_map.cell_cost(r_s, c_s)

    # Min-heap: (f_score, counter, row, col)
    counter = 0
    open_set: list = []
    heapq.heappush(open_set, (start_env_cost, counter, r_s, c_s))

    came_from: dict = {}
    g_score: dict = {(r_s, c_s): start_env_cost}

    expanded = 0

    t0 = time.perf_counter()

    while open_set:
        f_current, _, r_cur, c_cur = heapq.heappop(open_set)
        expanded += 1

        if (r_cur, c_cur) == (r_g, c_g):
            # Reconstruct path
            path = []
            node = (r_g, c_g)
            while node in came_from:
                path.append(node)
                node = came_from[node]
            path.append((r_s, c_s))
            path.reverse()

            elapsed = time.perf_counter() - t0
            g_val = g_score[(r_g, c_g)]

            # Route length = sum of Euclidean distances along path
            route_len = 0.0
            for i in range(1, len(path)):
                dr = path[i][0] - path[i - 1][0]
                dc = path[i][1] - path[i - 1][1]
                route_len += math.sqrt(dr * dr + dc * dc)

            return RouteResult(
                success=True,
                path=path,
                total_cost=g_val,
                route_length=route_len,
                expanded_nodes=expanded,
                elapsed_seconds=elapsed,
            )

        # Expand neighbours
        for dr, dc, dist in DIRS_8:
            nr, nc = r_cur + dr, c_cur + dc

            if not (0 <= nr < grid.n_rows and 0 <= nc < grid.n_cols):
                continue
            if not grid.navigable[nr, nc]:
                continue

            tentative_g = g_score[(r_cur, c_cur)] + cost_map.edge_cost(
                (r_cur, c_cur), (nr, nc), dist
            )

            if tentative_g < g_score.get((nr, nc), float("inf")):
                came_from[(nr, nc)] = (r_cur, c_cur)
                g_score[(nr, nc)] = tentative_g
                f = tentative_g + euclidean_heuristic((nr, nc), (goal))
                counter += 1
                heapq.heappush(open_set, (f, counter, nr, nc))

    elapsed = time.perf_counter() - t0
    return RouteResult(False, [], 0.0, 0.0, expanded, elapsed)

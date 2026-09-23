"""
Training Data Generator for Route Optimization ML Model
========================================================

Creates supervised training data from the expert CVaR route optimizer.

The expert is the existing TD-A* + select_robust_route() system.
Each training sample is a (features, action) pair extracted from
a step along an expert route.

Features: environmental/state features at the current cell.
Action:    the next movement (dr, dc) from the current cell.

8-neighbour actions:
    (-1,-1), (-1,0), (-1,1),
    (0,-1),           (0,1),
    (1,-1),  (1,0),  (1,1)

Labels:
    "Training data from synthetic uncertainty experiment — "
    "NOT real Antarctic expert routes"
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

from src.environment.grid import EnvironmentalGrid
from src.routing.cost import CostWeights
from src.routing.scenario_router import select_robust_route
from src.uncertainty.scenarios import generate_scenarios


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

ACTIONS_8 = [
    (-1, -1), (-1, 0), (-1, 1),
    (0, -1),           (0, 1),
    (1, -1),  (1, 0),  (1, 1),
]

ACTION_TO_INDEX = {a: i for i, a in enumerate(ACTIONS_8)}
INDEX_TO_ACTION = {i: a for i, a in enumerate(ACTIONS_8)}


# ---------------------------------------------------------------------------
# Feature names (ordered)
# ---------------------------------------------------------------------------

FEATURE_NAMES = [
    "sic_mean",
    "sic_uncertainty",
    "iceberg_risk",
    "iceberg_risk_uncertainty",
    "iceberg_uncertainty",
    "wind_cost",
    "current_cost",
    "current_uo",
    "current_vo",
    "depth",
    "normalized_dist_to_goal",
    "rel_row_to_goal",
    "rel_col_to_goal",
    "t_hours",
    "n_rows",
    "n_cols",
]

N_FEATURES = len(FEATURE_NAMES)


# ---------------------------------------------------------------------------
# Data container
# ---------------------------------------------------------------------------

@dataclass
class TrainingDataset:
    """Container for the generated training dataset."""

    features: np.ndarray         # (N, N_FEATURES) float32
    actions: np.ndarray          # (N,) int32 — action index 0-7
    feature_names: List[str]
    action_map: Dict[str, int]
    n_routes: int
    n_samples: int
    n_scenarios_per_route: int
    seed: int
    metadata: Dict = field(default_factory=dict)

    def save(self, output_dir: str) -> Tuple[str, str]:
        """
        Save dataset as CSV and NPZ.

        Returns
        -------
        (csv_path, npz_path)
        """
        os.makedirs(output_dir, exist_ok=True)

        # CSV
        import pandas as pd
        df = pd.DataFrame(self.features, columns=self.feature_names)
        df["action"] = self.actions
        csv_path = os.path.join(output_dir, "route_training_dataset.csv")
        df.to_csv(csv_path, index=False)

        # NPZ
        npz_path = os.path.join(output_dir, "route_training_dataset.npz")
        with open(npz_path, "wb") as f:
            np.savez(
                f,
                features=self.features,
                actions=self.actions,
                feature_names=np.array(self.feature_names),
                n_routes=self.n_routes,
                n_samples=self.n_samples,
                seed=self.seed,
            )

        return csv_path, npz_path


# ---------------------------------------------------------------------------
# Feature extraction
# ---------------------------------------------------------------------------

def _extract_features(
    grid: EnvironmentalGrid,
    row: int,
    col: int,
    goal_row: int,
    goal_col: int,
    t_hours: float,
) -> np.ndarray:
    """
    Extract environmental/state features for a single cell.

    Returns a float32 array of length N_FEATURES.
    Missing layers are filled with 0.0.
    """
    n_rows = grid.n_rows
    n_cols = grid.n_cols

    def _get(arr: Optional[np.ndarray], r: int, c: int) -> float:
        if arr is None:
            return 0.0
        return float(arr[r, c])

    # Distance to goal (normalized by grid diagonal)
    dr = row - goal_row
    dc = col - goal_col
    dist = math.sqrt(dr * dr + dc * dc)
    diag = math.sqrt(n_rows ** 2 + n_cols ** 2)
    norm_dist = dist / diag if diag > 0 else 0.0

    features = np.array([
        _get(grid.sic_mean, row, col),
        _get(grid.sic_uncertainty, row, col),
        _get(grid.iceberg_risk, row, col),
        _get(grid.iceberg_risk_uncertainty, row, col),
        _get(grid.iceberg_uncertainty, row, col),
        _get(grid.wind_cost, row, col),
        _get(grid.current_cost, row, col),
        _get(grid.current_uo, row, col),
        _get(grid.current_vo, row, col),
        0.0,  # depth — not available in synthetic grid
        norm_dist,
        float(dr) / n_rows,   # relative row to goal
        float(dc) / n_cols,   # relative col to goal
        t_hours,
        float(n_rows),
        float(n_cols),
    ], dtype=np.float32)

    return features


# ---------------------------------------------------------------------------
# Expert route generation
# ---------------------------------------------------------------------------

def _get_navigable_cells(grid: EnvironmentalGrid) -> List[Tuple[int, int]]:
    """Return list of all navigable (row, col) pairs."""
    rows, cols = grid.navigable.nonzero()
    return list(zip(rows.tolist(), cols.tolist()))


def _sample_start_goal(
    nav_cells: List[Tuple[int, int]],
    rng: np.random.RandomState,
    min_dist: float = 5.0,
    max_attempts: int = 200,
) -> Optional[Tuple[Tuple[int, int], Tuple[int, int]]]:
    """
    Sample a random start/goal pair with minimum Euclidean distance.

    Returns None if no valid pair found after max_attempts.
    """
    n = len(nav_cells)
    if n < 2:
        return None

    for _ in range(max_attempts):
        idx_a = rng.randint(0, n)
        idx_b = rng.randint(0, n)
        if idx_a == idx_b:
            continue
        a = nav_cells[idx_a]
        b = nav_cells[idx_b]
        dist = math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)
        if dist >= min_dist:
            return (a, b)

    return None


# ---------------------------------------------------------------------------
# Main generator
# ---------------------------------------------------------------------------

def generate_training_dataset(
    grid: Optional[EnvironmentalGrid] = None,
    n_routes: int = 50,
    n_scenarios: int = 5,
    alpha: float = 0.05,
    vessel_speed_knots: float = 12.0,
    seed: int = 42,
    min_route_length: int = 3,
    output_dir: Optional[str] = None,
) -> TrainingDataset:
    """
    Generate a supervised training dataset from expert CVaR routes.

    Algorithm:
        1. Generate a synthetic grid (or use provided).
        2. For each of n_routes:
           a. Sample random start/goal pair on navigable cells.
           b. Generate n_scenarios uncertainty scenarios.
           c. Run select_robust_route() → expert route.
           d. Extract (features, action) for each step along the route.
        3. Stack all samples into arrays.

    Parameters
    ----------
    grid : EnvironmentalGrid, optional
        Environmental grid. If None, generates a synthetic 40x50 grid.
    n_routes : int
        Number of expert routes to generate.
    n_scenarios : int
        Scenarios per route (for CVaR selection).
    alpha : float
        CVaR confidence level.
    vessel_speed_knots : float
        Vessel speed.
    seed : int
        Random seed.
    min_route_length : int
        Minimum route length (in steps) to include.
    output_dir : str, optional
        If provided, save CSV and NPZ to this directory.

    Returns
    -------
    TrainingDataset
    """
    if grid is None:
        from src.environment.synthetic import generate_synthetic
        grid = generate_synthetic(n_rows=40, n_cols=50, seed=seed)

    rng = np.random.RandomState(seed)
    nav_cells = _get_navigable_cells(grid)
    weights = CostWeights()

    all_features: List[np.ndarray] = []
    all_actions: List[int] = []
    n_success = 0
    n_attempts = 0
    max_attempts = n_routes * 5

    while n_success < n_routes and n_attempts < max_attempts:
        n_attempts += 1

        # Sample start/goal
        pair = _sample_start_goal(nav_cells, rng, min_dist=5.0)
        if pair is None:
            continue
        start, goal = pair

        # Generate scenarios
        scenarios = generate_scenarios(
            grid, n_scenarios=n_scenarios, seed=seed + n_attempts,
        )

        # Get expert route via CVaR selection
        try:
            result = select_robust_route(
                grid, scenarios, start, goal,
                weights=weights,
                alpha=alpha,
                vessel_speed_knots=vessel_speed_knots,
            )
        except Exception:
            continue

        path = result.selected_path
        if len(path) < min_route_length:
            continue

        # Extract (features, action) for each step
        for i in range(len(path) - 1):
            r, c = path[i]
            r_next, c_next = path[i + 1]
            dr = r_next - r
            dc = c_next - c

            action_key = (dr, dc)
            if action_key not in ACTION_TO_INDEX:
                continue  # skip invalid actions (shouldn't happen)

            features = _extract_features(
                grid, r, c, goal[0], goal[1],
                t_hours=float(i),
            )
            all_features.append(features)
            all_actions.append(ACTION_TO_INDEX[action_key])

        n_success += 1

    # Stack arrays
    if all_features:
        features_arr = np.stack(all_features, axis=0)
        actions_arr = np.array(all_actions, dtype=np.int32)
    else:
        features_arr = np.zeros((0, N_FEATURES), dtype=np.float32)
        actions_arr = np.zeros((0,), dtype=np.int32)

    dataset = TrainingDataset(
        features=features_arr,
        actions=actions_arr,
        feature_names=FEATURE_NAMES.copy(),
        action_map={str(k): v for k, v in ACTION_TO_INDEX.items()},
        n_routes=n_success,
        n_samples=len(all_actions),
        n_scenarios_per_route=n_scenarios,
        seed=seed,
        metadata={
            "alpha": alpha,
            "vessel_speed_knots": vessel_speed_knots,
            "min_route_length": min_route_length,
            "grid_rows": grid.n_rows,
            "grid_cols": grid.n_cols,
            "n_navigable_cells": int(grid.navigable.sum()),
        },
    )

    if output_dir:
        dataset.save(output_dir)

    return dataset

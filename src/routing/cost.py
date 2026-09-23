"""
Baseline Environmental Cost Function
=====================================

Computes a weighted traversal cost for each cell on an EnvironmentalGrid.
The cost is deterministic and uses only the mean environmental fields.

Cost formulation:
    C(i) = w_sic * SIC(i)
          + w_ice * IcebergRisk(i)
          + w_wind * WindCost(i)
          + w_curr * max(CurrentCost(i), 0)

CurrentCost semantics:
    - Favorable current (CurrentCost < 0): contributes zero penalty.
    - Neutral current  (CurrentCost = 0): contributes zero penalty.
    - Adverse current  (CurrentCost > 0): contributes proportional positive cost.

This is a baseline modeling choice, not a claim of physical optimality.
All per-cell costs are guaranteed non-negative, so A* is well-behaved.

The total cost between two adjacent cells is:

    C_total = environmental_cost(dst) + w_distance * movement_distance

Movement distance: 1.0 for cardinal, sqrt(2) for diagonal.
"""

import math
from dataclasses import dataclass

import numpy as np

from src.environment.grid import EnvironmentalGrid


@dataclass
class CostWeights:
    """
    Configurable weights for the baseline cost function.

    These are NOT optimised values. They are explicit defaults for
    experimentation and will be documented as such.
    """
    w_sic: float = 1.0       # weight for sea-ice concentration
    w_ice: float = 1.0       # weight for iceberg risk
    w_wind: float = 1.0      # weight for wind cost
    w_curr: float = 1.0      # weight for ocean current cost
    w_distance: float = 1.0  # weight for movement distance

    def __post_init__(self):
        assert self.w_sic >= 0, "w_sic must be non-negative"
        assert self.w_ice >= 0, "w_ice must be non-negative"
        assert self.w_wind >= 0, "w_wind must be non-negative"
        assert self.w_curr >= 0, "w_curr must be non-negative"
        assert self.w_distance >= 0, "w_distance must be non-negative"


# Cardinals: up, down, left, right
# Diagonals: 4 diagonal neighbours
DIRS_8 = [
    (-1, 0, 1.0),   # up
    (1, 0, 1.0),    # down
    (0, -1, 1.0),   # left
    (0, 1, 1.0),    # right
    (-1, -1, math.sqrt(2)),  # up-left
    (-1, 1, math.sqrt(2)),   # up-right
    (1, -1, math.sqrt(2)),   # down-left
    (1, 1, math.sqrt(2)),    # down-right
]


class CostMap:
    """
    Pre-computes and caches the per-cell environmental cost on a grid.

    The cost is a single scalar per cell combining all available layers
    with the configured weights.
    """

    def __init__(self, grid: EnvironmentalGrid, weights: CostWeights):
        self.grid = grid
        self.weights = weights
        self._env_cost = self._compute_environmental_cost()

    def _compute_environmental_cost(self) -> np.ndarray:
        """Compute the weighted environmental cost per cell."""
        g = self.grid
        w = self.weights
        shape = (g.n_rows, g.n_cols)
        cost = np.zeros(shape, dtype=np.float64)

        if g.sic_mean is not None:
            cost += w.w_sic * g.sic_mean

        if g.iceberg_risk is not None:
            cost += w.w_ice * g.iceberg_risk

        if g.wind_cost is not None:
            cost += w.w_wind * g.wind_cost

        if g.current_cost is not None:
            # Favorable current (< 0) → zero penalty
            # Adverse current (> 0) → proportional positive cost
            cost += w.w_curr * np.maximum(g.current_cost, 0.0)

        return cost

    @property
    def env_cost(self) -> np.ndarray:
        """Per-cell environmental cost array."""
        return self._env_cost

    def cell_cost(self, row: int, col: int) -> float:
        """Return the environmental cost of a single cell."""
        return float(self._env_cost[row, col])

    def edge_cost(self, src_rc: tuple, dst_rc: tuple,
                  movement_distance: float) -> float:
        """
        Compute the cost of moving from src to dst.

        Returns environmental_cost(dst) + w_distance * movement_distance.

        Parameters
        ----------
        src_rc : (row, col) of the source cell
        dst_rc : (row, col) of the destination cell
        movement_distance : 1.0 for cardinal, sqrt(2) for diagonal
        """
        r, c = dst_rc
        env = self._env_cost[r, c]
        dist = self.weights.w_distance * movement_distance
        return env + dist

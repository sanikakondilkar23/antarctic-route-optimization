"""
Unified Environmental Cost Function
===================================

Computes a weighted traversal cost for each cell on an EnvironmentalGrid.
Every term is optional: a layer that is absent (or non-finite at a cell) is
omitted from the sum for that cell rather than being replaced by zero, so a
missing measurement can never masquerade as a benign one.

Cost formulation
----------------
    C(i) = w_sic        * sic_mean(i)
         + w_ice_class  * ice_multiplier(i)
         + w_ice        * iceberg_risk(i)
         + w_wind       * wind_cost(i)
         + w_curr       * max(current_cost(i), 0)
         + w_depth      * depth_penalty(i)
         + w_unc        * sic_uncertainty(i)

    C_total(a -> b) = C(b) + w_distance * movement_distance

CurrentCost semantics
    Favorable current (CurrentCost < 0) contributes zero penalty;
    adverse current contributes a proportional positive cost.

Depth penalty
    ``depth`` is metres, positive downwards.  The penalty is the normalised
    approach to the vessel draft:

        depth_penalty(i) = clip((draft - depth(i)) / draft, 0, 1)

    so open water scores 0 and a cell exactly at the draft limit scores 1.
    Non-navigability is decided by ``grid.navigable`` (built from the GEBCO
    land mask against the same draft), not by this term.

Ice-class multiplier
    ``ice_multiplier`` is the committed POLARIS-style heuristic from
    ``backend/cache/routing_multiplier_2026.npy``
    (open 1.0 / marginal 2.0 / moderate pack 8.0 / hard pack 50.0 /
    impassable ``+inf``).  It is applied only when ``w_ice_class > 0``; the
    default of 0.0 keeps the historical linear-SIC objective, and setting it
    above 0 makes the ``+inf`` class genuinely impassable.

Missing-data policy
    A term is dropped for a cell when its layer is absent or non-finite
    there.  ``omitted_cells`` records how many cells that happened for, so a
    route produced with a partially-covered layer is never presented as if
    the layer were complete.

This is a modelling choice, not a claim of physical optimality.  All weights
are explicit, documented and configurable.
"""

import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from src.environment.grid import EnvironmentalGrid


@dataclass
class CostWeights:
    """
    Configurable weights for the environmental cost function.

    Defaults preserve the project's historical objective exactly
    (``w_sic = 1.0``, everything else 0) so that routes remain reproducible
    against the committed verification artifacts until a term is enabled
    deliberately.

    ``vessel_draft_m`` is a vessel property, not a tunable weight: it defines
    the depth at which a cell stops being navigable.
    """

    w_sic: float = 1.0         # sea-ice concentration (SIC fraction)
    w_ice: float = 0.0         # iceberg risk (0-1)
    w_wind: float = 0.0        # wind traversal cost
    w_curr: float = 0.0        # adverse ocean current
    w_distance: float = 1.0    # movement distance
    w_depth: float = 0.0       # shallow-water penalty
    w_unc: float = 0.0         # SIC forecast-uncertainty penalty
    w_ice_class: float = 0.0   # POLARIS-style ice-class multiplier
    vessel_draft_m: float = 6.5

    def __post_init__(self):
        for name in ("w_sic", "w_ice", "w_wind", "w_curr", "w_distance",
                     "w_depth", "w_unc", "w_ice_class"):
            assert getattr(self, name) >= 0, f"{name} must be non-negative"
        assert self.vessel_draft_m > 0, "vessel_draft_m must be positive"

    def to_dict(self) -> Dict[str, float]:
        return {
            "w_sic": self.w_sic,
            "w_ice": self.w_ice,
            "w_wind": self.w_wind,
            "w_curr": self.w_curr,
            "w_distance": self.w_distance,
            "w_depth": self.w_depth,
            "w_unc": self.w_unc,
            "w_ice_class": self.w_ice_class,
            "vessel_draft_m": self.vessel_draft_m,
        }

    def active_layer_terms(self) -> List[str]:
        """Logical layer names this weight set actually reads."""
        out = []
        if self.w_sic > 0:
            out.append("sic_mean")
        if self.w_ice_class > 0:
            out.append("ice_multiplier")
        if self.w_ice > 0:
            out.append("iceberg_risk")
        if self.w_wind > 0:
            out.append("wind_cost")
        if self.w_curr > 0:
            out.append("current_cost")
        if self.w_depth > 0:
            out.append("depth")
        if self.w_unc > 0:
            out.append("sic_uncertainty")
        return out


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


def depth_penalty(depth: np.ndarray, draft_m: float) -> np.ndarray:
    """
    Normalised shallow-water penalty in [0, 1]; NaN where depth is unknown.

    0 at or below ``draft_m`` of water under the keel, rising linearly to 1
    at the surface.
    """
    d = np.asarray(depth, dtype=np.float64)
    out = np.clip((draft_m - d) / draft_m, 0.0, 1.0)
    out[~np.isfinite(d)] = np.nan
    return out


class CostMap:
    """
    Pre-computes and caches the per-cell environmental cost on a grid.

    The cost is a single scalar per cell combining every enabled layer with
    the configured weights.  ``terms`` keeps the individual contributions so a
    route's cost can be attributed to the layers that produced it.
    """

    def __init__(self, grid: EnvironmentalGrid, weights: CostWeights):
        self.grid = grid
        self.weights = weights
        self._env_cost, self._terms, self._omitted = self._compute()

    # -- computation ------------------------------------------------------

    def _add(self, name: str, values: np.ndarray) -> None:
        """Add one weighted term, omitting it where it is not finite."""
        w = getattr(self.weights, f"w_{name}", 0.0)
        if w <= 0:
            return
        arr = np.asarray(values, dtype=np.float64)
        finite = np.isfinite(arr)
        if not finite.any():
            self._omitted[name] = int(self.grid.n_rows * self.grid.n_cols)
            return
        contribution = np.zeros_like(arr)
        contribution[finite] = w * arr[finite]
        self._env_cost = self._env_cost + contribution
        self._terms[name] = contribution
        self._omitted[name] = int((~finite).sum())

    def _compute(self):
        g = self.grid
        shape = (g.n_rows, g.n_cols)
        cost = np.zeros(shape, dtype=np.float64)
        terms: Dict[str, np.ndarray] = {}
        omitted: Dict[str, int] = {}

        self._env_cost = cost
        self._terms = terms
        self._omitted = omitted

        if g.sic_mean is not None:
            self._add("sic", g.sic_mean)

        if self.weights.w_ice_class > 0 and g.ice_multiplier is not None:
            self._add("ice_class", g.ice_multiplier)

        if g.iceberg_risk is not None:
            self._add("ice", g.iceberg_risk)

        if g.wind_cost is not None:
            self._add("wind", g.wind_cost)

        if g.current_cost is not None:
            # Favorable current (< 0) -> zero penalty.
            self._add("curr", np.maximum(
                np.asarray(g.current_cost, dtype=np.float64), 0.0))

        if g.depth is not None:
            self._add("depth", depth_penalty(g.depth,
                                             self.weights.vessel_draft_m))

        if g.sic_uncertainty is not None:
            self._add("unc", g.sic_uncertainty)

        return self._env_cost, self._terms, self._omitted

    # -- accessors --------------------------------------------------------

    @property
    def env_cost(self) -> np.ndarray:
        """Per-cell environmental cost array."""
        return self._env_cost

    @property
    def terms(self) -> Dict[str, np.ndarray]:
        """Per-term weighted contribution, keyed by weight name."""
        return self._terms

    @property
    def omitted_cells(self) -> Dict[str, int]:
        """Cells where an enabled term had no finite value and was dropped."""
        return self._omitted

    @property
    def layers_in_cost(self) -> List[str]:
        """Logical layer names that contributed to the cost."""
        mapping = {
            "sic": "sic_mean",
            "ice_class": "ice_multiplier",
            "ice": "iceberg_risk",
            "wind": "wind_cost",
            "curr": "current_cost",
            "depth": "depth",
            "unc": "sic_uncertainty",
        }
        return [mapping[k] for k in self._terms if k in mapping]

    def breakdown(self) -> Dict[str, Any]:
        """Serialisable description of how the cost was built."""
        return {
            "formula": ("w_sic*sic_mean + w_ice_class*ice_multiplier + "
                        "w_ice*iceberg_risk + w_wind*wind_cost + "
                        "w_curr*max(current_cost,0) + w_depth*depth_penalty "
                        "+ w_unc*sic_uncertainty"),
            "weights": self.weights.to_dict(),
            "layers_in_cost": self.layers_in_cost,
            "terms": sorted(self._terms),
            "omitted_cells": dict(self._omitted),
            "total_cost_finite_cells": int(np.isfinite(self._env_cost).sum()),
            "total_cost_nonfinite_cells": int(
                (~np.isfinite(self._env_cost)).sum()),
        }

    def cell_cost(self, row: int, col: int) -> float:
        """Get the environmental cost of a single cell."""
        return float(self._env_cost[row, col])

    def edge_cost(self, src_rc: tuple, dst_rc: tuple,
                  movement_distance: float) -> float:
        """
        Cost of moving from src to dst.

        ``src_rc`` is accepted for interface compatibility; the cost is a
        destination-cell property, so it does not enter the sum.
        """
        r, c = dst_rc
        env = self._env_cost[r, c]
        dist = self.weights.w_distance * movement_distance
        return env + dist

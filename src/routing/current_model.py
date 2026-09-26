"""
Directional Ocean-Current Cost Model
=====================================

Projects ocean-current velocity (uo, vo) onto the vessel's movement
direction to compute effective travel speed and direction-aware cost.

Scientific basis:
    Ocean currents in CMEMS GLORYS are given as velocity components:
        uo : zonal velocity (m/s), positive = eastward
        vo : meridional velocity (m/s), positive = northward

    When a vessel moves along a grid edge from cell A to cell B, the
    ocean-current component along the movement direction affects the
    vessel's effective speed:

        v_effective = v_vessel + v_current_along_route

    where v_current_along_route = dot(current_vector, unit_direction).

    A favorable current (positive projection) increases effective speed
    and reduces travel time.  An adverse current (negative projection)
    decreases effective speed and increases travel time.

Units:
    - uo, vo: m/s (SI, from CMEMS)
    - Movement direction: unitless (grid-unit vector, normalized)
    - Projected current: m/s (scalar, signed)
    - Effective speed: knots (converted from m/s)
    - Travel time: hours

Numerical safeguards:
    - Zero-length movement → projected current = 0.0
    - NaN in uo/vo → treated as zero current
    - Effective speed clamped to v_min (default 0.5 knots) to prevent
      division by zero or negative travel time

Configurable assumption:
    The current-influence factor (default 1.0) scales the projected
    current before adding to vessel speed.  This is NOT a validated
    physical coefficient.  Set to 0.0 to disable current effect while
    preserving the directional API.

References:
    - CMEMS GLORYS12 reanalysis: uo/vo at surface depth ~0.494 m
    - Effective-speed formulation inspired by maritime weather routing
      (e.g., Courtney & Brooks, 2012) but NOT validated against real
      vessel performance data.
"""

from __future__ import annotations

import math
from typing import Optional, Tuple

import numpy as np


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

KNOTS_TO_MS = 1852.0 / 3600.0  # 1 knot = 0.51444... m/s
MS_TO_KNOTS = 1.0 / KNOTS_TO_MS  # 1 m/s = 1.94384... knots

# Minimum effective speed in knots (prevents division by zero)
V_MIN_KNOTS = 0.5

# Default current influence factor (1.0 = full effect, 0.0 = disabled)
DEFAULT_CURRENT_INFLUENCE = 1.0


# ---------------------------------------------------------------------------
# Directional projection
# ---------------------------------------------------------------------------

def project_current_along_movement(
    uo: float,
    vo: float,
    dr: int,
    dc: int,
) -> float:
    """
    Project ocean-current vector onto the vessel's movement direction.

    The movement direction vector is (dc, -dr) in geographic coordinates:
        dc > 0 → eastward component
        -dr > 0 → northward component (since dr > 0 means south on the grid)

    The current vector is (uo, vo) in geographic coordinates:
        uo > 0 → eastward
        vo > 0 → northward

    The projection is the scalar component of the current along the
    movement direction, in m/s.

    Parameters
    ----------
    uo : float
        Zonal current velocity (m/s), positive = eastward.
        May be NaN (treated as 0.0).
    vo : float
        Meridional current velocity (m/s), positive = northward.
        May be NaN (treated as 0.0).
    dr : int
        Row change (positive = southward on grid).
    dc : int
        Column change (positive = eastward on grid).

    Returns
    -------
    float
        Projected current speed (m/s), signed.
        Positive = favorable (current helps movement).
        Negative = adverse (current opposes movement).
        Zero for zero-length movement.
    """
    # Handle zero-length movement
    if dr == 0 and dc == 0:
        return 0.0

    # Handle NaN
    if not (math.isfinite(uo) and math.isfinite(vo)):
        return 0.0

    # Movement direction in geographic coordinates
    # (dc, -dr): dc>0 means east, -dr>0 means north
    length = math.sqrt(dc * dc + dr * dr)
    if length < 1e-12:
        return 0.0

    # Unit direction vector
    ux = dc / length   # eastward component
    uy = -dr / length  # northward component

    # Current vector
    cx = uo  # eastward
    cy = vo  # northward

    # Dot product: projection of current onto movement direction (m/s)
    return cx * ux + cy * uy


# ---------------------------------------------------------------------------
# Effective speed
# ---------------------------------------------------------------------------

def compute_effective_speed_knots(
    vessel_speed_knots: float,
    projected_current_ms: float,
    current_influence: float = DEFAULT_CURRENT_INFLUENCE,
    v_min_knots: float = V_MIN_KNOTS,
) -> float:
    """
    Compute effective vessel speed including ocean-current effect.

    Parameters
    ----------
    vessel_speed_knots : float
        Vessel speed through water in knots (always > 0).
    projected_current_ms : float
        Ocean-current component along movement direction (m/s).
        Positive = favorable, negative = adverse.
    current_influence : float
        Scaling factor for current effect (0.0 to 1.0).
        1.0 = full effect, 0.0 = disabled.
    v_min_knots : float
        Minimum effective speed in knots (safeguard).

    Returns
    -------
    float
        Effective speed in knots (always >= v_min_knots).

    Notes
    -----
    The current_influence parameter is a configurable assumption.
    It is NOT a validated physical coefficient.  The default (1.0)
    assumes the full measured current affects vessel speed.  In
    practice, vessel response to currents depends on hull form,
    loading, sea state, and other factors not modeled here.
    """
    # Convert projected current from m/s to knots
    projected_current_knots = projected_current_ms * MS_TO_KNOTS

    # Apply influence factor
    effective_current = current_influence * projected_current_knots

    # Effective speed = vessel speed + current contribution
    v_eff = vessel_speed_knots + effective_current

    # Clamp to minimum
    return max(v_eff, v_min_knots)


# ---------------------------------------------------------------------------
# Maximum current magnitude (for heuristic)
# ---------------------------------------------------------------------------

def estimate_max_current_ms(
    uo_grid: Optional[np.ndarray],
    vo_grid: Optional[np.ndarray],
) -> float:
    """
    Estimate the maximum current magnitude across the grid.

    Used to compute a conservative (admissible) A* heuristic that
    assumes worst-case current opposition.

    Parameters
    ----------
    uo_grid : np.ndarray or None
        2D array of zonal current (m/s). None → returns 0.0.
    vo_grid : np.ndarray or None
        2D array of meridional current (m/s). None → returns 0.0.

    Returns
    -------
    float
        Maximum current speed magnitude (m/s), always >= 0.
    """
    if uo_grid is None or vo_grid is None:
        return 0.0

    # Replace NaN with 0 for max computation
    uo_clean = np.nan_to_num(uo_grid, nan=0.0)
    vo_clean = np.nan_to_num(vo_grid, nan=0.0)

    # Maximum magnitude = max(sqrt(uo² + vo²))
    magnitude = np.sqrt(uo_clean ** 2 + vo_clean ** 2)
    return float(np.max(magnitude))

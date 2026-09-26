"""
Synthetic Antarctic-Like Environment Generator
===============================================

Generates a small, deterministic, reproducible environmental grid
for testing and development.

Labels:
    "Synthetic experimental environment — NOT real Antarctic data"

The generator creates a simplified scenario with:
    - Open-water corridor (navigable, low SIC)
    - Dense sea-ice region (high SIC, partially blocked)
    - Iceberg cluster zone (high iceberg risk)
    - Transition zone with high uncertainty
    - Wind and current cost fields
"""

import numpy as np

from src.environment.grid import EnvironmentalGrid


def _gaussian_blob(rows: int, cols: int, center_rc: tuple,
                   spread: float, peak: float = 1.0) -> np.ndarray:
    """Create a 2D Gaussian blob centered at (row, col)."""
    r = np.arange(rows).reshape(-1, 1)
    c = np.arange(cols).reshape(1, -1)
    cr, cc = center_rc
    blob = peak * np.exp(-((r - cr) ** 2 + (c - cc) ** 2) / (2 * spread ** 2))
    return blob


def generate_synthetic(
    n_rows: int = 40,
    n_cols: int = 50,
    resolution_deg: float = 0.05,
    seed: int = 42,
    lat_min: float = -70.0,
    lon_min: float = 72.0,
) -> EnvironmentalGrid:
    """
    Generate a synthetic Antarctic-like environmental grid.

    This is NOT real Antarctic data. It is a deterministic test fixture
    with clearly defined features for algorithm development.

    Layout (rough):
        Rows increase southward (more negative latitude).
        Columns increase eastward.

        Top rows:     open water / low ice
        Middle rows:  ice edge transition zone
        Bottom rows:  dense pack ice

        Left columns:  relatively clear
        Right columns: iceberg cluster

    Parameters
    ----------
    n_rows, n_cols : int
        Grid dimensions.
    resolution_deg : float
        Grid spacing in degrees.
    seed : int
        Random seed for reproducibility.
    lat_min, lon_min : float
        Southwest corner coordinates.

    Returns
    -------
    EnvironmentalGrid
        Fully populated grid with all layers.
    """
    rng = np.random.RandomState(seed)

    # --- Coordinate arrays ---
    lat = np.linspace(lat_min, lat_min + (n_rows - 1) * resolution_deg, n_rows)
    lon = np.linspace(lon_min, lon_min + (n_cols - 1) * resolution_deg, n_cols)

    # --- Navigable mask ---
    # Start fully navigable, then block some cells
    navigable = np.ones((n_rows, n_cols), dtype=bool)

    # Block bottom 3 rows as "continent" or "fast ice"
    navigable[-3:, :] = False

    # Block a few scattered cells as "islands" or "icebergs"
    island_rows = [5, 12, 20, 30]
    island_cols = [8, 40, 25, 15]
    for ir, ic in zip(island_rows, island_cols):
        if 0 <= ir < n_rows and 0 <= ic < n_cols:
            navigable[ir, ic] = False

    # --- Sea-ice concentration (SIC) ---
    # Gradient: low at top (north), high at bottom (south)
    sic_gradient = np.linspace(0.0, 0.9, n_rows).reshape(-1, 1)
    sic_gradient = np.broadcast_to(sic_gradient, (n_rows, n_cols)).copy()

    # Add a dense ice patch in the lower-left
    sic_patch = _gaussian_blob(
        n_rows, n_cols, center_rc=(30, 10), spread=5.0, peak=0.3
    )
    sic_mean = np.clip(sic_gradient + sic_patch, 0.0, 1.0)

    # Zero out SIC on non-navigable cells (they are blocked anyway)
    sic_mean[~navigable] = 0.0

    # --- SIC uncertainty ---
    # Higher near the ice edge (rows 15-25) and near patches
    ice_edge_center = 20
    sic_uncertainty = 0.05 + 0.15 * np.exp(
        -((np.arange(n_rows) - ice_edge_center) ** 2) / (2 * 6 ** 2)
    ).reshape(-1, 1)
    sic_uncertainty = np.broadcast_to(sic_uncertainty, (n_rows, n_cols)).copy()

    # Add small random noise for realism
    sic_uncertainty += rng.uniform(0, 0.02, (n_rows, n_cols))
    sic_uncertainty = np.clip(sic_uncertainty, 0.0, 0.5)

    # --- Iceberg risk ---
    # Cluster in the right-center region
    iceberg_risk = np.zeros((n_rows, n_cols), dtype=float)
    iceberg_risk += _gaussian_blob(
        n_rows, n_cols, center_rc=(15, 35), spread=6.0, peak=0.8
    )
    iceberg_risk += _gaussian_blob(
        n_rows, n_cols, center_rc=(22, 42), spread=4.0, peak=0.6
    )
    iceberg_risk += _gaussian_blob(
        n_rows, n_cols, center_rc=(10, 30), spread=3.0, peak=0.5
    )
    iceberg_risk = np.clip(iceberg_risk, 0.0, 1.0)

    # --- Iceberg risk uncertainty (dimensionless) ---
    # Synthetic model: higher risk areas have higher risk-field uncertainty.
    # This is dimensionless [0,1] and represents uncertainty in the
    # iceberg-risk probability, NOT spatial/positional uncertainty.
    # NOT calibrated to real Antarctic iceberg forecast errors.
    iceberg_risk_uncertainty = 0.05 + 0.15 * iceberg_risk
    iceberg_risk_uncertainty += rng.uniform(0, 0.02, (n_rows, n_cols))
    iceberg_risk_uncertainty = np.clip(iceberg_risk_uncertainty, 0.0, 0.3)

    # --- Iceberg uncertainty ---
    # Higher near the ice edge and in the iceberg cluster
    iceberg_uncertainty = 2.0 + 5.0 * iceberg_risk  # km
    iceberg_uncertainty += rng.uniform(0, 1.0, (n_rows, n_cols))
    iceberg_uncertainty = np.clip(iceberg_uncertainty, 0.0, 20.0)

    # --- Wind cost ---
    # Westerly wind pattern: headwind (positive cost) in open water,
    # crosswind in the transition zone
    wind_cost = np.zeros((n_rows, n_cols), dtype=float)
    wind_cost[:15, :] = 0.3     # moderate headwind in open water
    wind_cost[15:30, :] = 0.6   # stronger wind in ice edge zone
    wind_cost[30:, :] = 0.1     # sheltered near continent
    # Add east-west variation
    wind_cost[:, 35:] += 0.2
    wind_cost = np.clip(wind_cost, 0.0, 1.5)

    # --- Current cost ---
    # ACC-like eastward current in the middle, weaker elsewhere
    current_cost = np.zeros((n_rows, n_cols), dtype=float)
    current_cost[10:25, :] = -0.3  # favorable eastward current (negative = help)
    current_cost[:10, :] = 0.1     # slight adverse current
    current_cost[30:, :] = 0.0     # negligible near continent
    # Add spatial variation
    current_cost += rng.uniform(-0.05, 0.05, (n_rows, n_cols))
    current_cost = np.clip(current_cost, -1.0, 1.0)

    return EnvironmentalGrid(
        n_rows=n_rows,
        n_cols=n_cols,
        lat=lat,
        lon=lon,
        navigable=navigable,
        sic_mean=sic_mean,
        sic_uncertainty=sic_uncertainty,
        iceberg_risk=iceberg_risk,
        iceberg_risk_uncertainty=iceberg_risk_uncertainty,
        iceberg_uncertainty=iceberg_uncertainty,
        wind_cost=wind_cost,
        current_cost=current_cost,
        resolution_deg=resolution_deg,
    )


def generate_minimal(
    n_rows: int = 10,
    n_cols: int = 10,
    seed: int = 42,
) -> EnvironmentalGrid:
    """
    Generate a minimal grid for fast unit tests.

    Only includes navigable + SIC mean. Other layers are omitted.
    """
    rng = np.random.RandomState(seed)

    lat = np.linspace(-70.0, -70.0 + (n_rows - 1) * 0.05, n_rows)
    lon = np.linspace(72.0, 72.0 + (n_cols - 1) * 0.05, n_cols)

    navigable = np.ones((n_rows, n_cols), dtype=bool)
    navigable[-1, :] = False  # last row blocked

    sic_mean = rng.uniform(0.0, 0.8, (n_rows, n_cols))

    return EnvironmentalGrid(
        n_rows=n_rows,
        n_cols=n_cols,
        lat=lat,
        lon=lon,
        navigable=navigable,
        sic_mean=sic_mean,
    )

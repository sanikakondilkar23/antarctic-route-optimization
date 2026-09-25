"""
Scenario Generation for Environmental Uncertainty
==================================================

Generates multiple plausible environmental scenarios by perturbing
mean forecast fields according to their uncertainty estimates.

Baseline assumption (clearly synthetic):
    Perturbations are drawn from a Gaussian distribution centered at
    the mean, with standard deviation given by the uncertainty field,
    then clipped to physically meaningful ranges.

This is NOT a validated physical error model.
It is a transparent experimental assumption for studying how forecast
uncertainty affects route optimization.

Labels:
    "Synthetic uncertainty experiment — NOT real Antarctic forecast uncertainty"
"""

from dataclasses import dataclass
from typing import Callable, List, Optional

import numpy as np

from src.environment.grid import EnvironmentalGrid


@dataclass
class Scenario:
    """
    A single perturbed environmental scenario.

    Lightweight: only stores the layers that differ from the mean.
    Wind and current are NOT perturbed (held at the mean) because
    no uncertainty fields are provided for them.

    Attributes
    ----------
    scenario_id : int
        Unique identifier (0 to n_scenarios-1).
    sic : np.ndarray
        Perturbed sea-ice concentration, clipped to [0, 1].
    iceberg_risk : np.ndarray
        Perturbed iceberg risk, clipped to [0, 1].
    """
    scenario_id: int
    sic: np.ndarray
    iceberg_risk: np.ndarray

    def to_grid(self, base_grid: EnvironmentalGrid) -> EnvironmentalGrid:
        """
        Construct an EnvironmentalGrid with this scenario's perturbed layers.

        All unperturbed layers (wind_cost, current_cost, navigable, coords)
        are copied from the base grid. Uncertainty layers are NOT carried
        forward (they are generation parameters, not routing inputs).

        Parameters
        ----------
        base_grid : EnvironmentalGrid
            The mean/baseline grid to copy structure from.

        Returns
        -------
        EnvironmentalGrid
            A new grid with perturbed SIC and iceberg risk.
        """
        return EnvironmentalGrid(
            n_rows=base_grid.n_rows,
            n_cols=base_grid.n_cols,
            lat=base_grid.lat.copy(),
            lon=base_grid.lon.copy(),
            navigable=base_grid.navigable.copy(),
            sic_mean=self.sic.copy(),
            sic_uncertainty=None,
            iceberg_risk=self.iceberg_risk.copy(),
            iceberg_risk_uncertainty=None,
            iceberg_uncertainty=None,
            wind_cost=base_grid.wind_cost.copy() if base_grid.wind_cost is not None else None,
            current_cost=base_grid.current_cost.copy() if base_grid.current_cost is not None else None,
            resolution_deg=base_grid.resolution_deg,
            projection=base_grid.projection,
        )


def generate_scenarios(
    grid: EnvironmentalGrid,
    n_scenarios: int = 20,
    seed: int = 0,
    sic_scale: float = 1.0,
    iceberg_scale: float = 1.0,
) -> List[Scenario]:
    """
    Generate perturbed environmental scenarios from mean + uncertainty.

    For each scenario s and each cell i:

        SIC_s(i)       = clip(SIC_mean(i)       + eps_sic(i),  0, 1)
        IceRisk_s(i)   = clip(IceRisk_mean(i)   + eps_ice(i),  0, 1)

    where:
        eps_sic(i) ~ N(0, sic_scale * sic_uncertainty(i))
        eps_ice(i) ~ N(0, iceberg_scale * iceberg_risk_uncertainty(i))

    IMPORTANT: Both uncertainty fields are dimensionless and represent
    standard deviations on the respective [0,1] risk/concentration fields.
    The km-valued iceberg_uncertainty is NOT used here.

    Parameters
    ----------
    grid : EnvironmentalGrid
        Must have sic_mean, sic_uncertainty, iceberg_risk,
        iceberg_risk_uncertainty layers available.
    n_scenarios : int
        Number of scenarios to generate.
    seed : int
        Random seed for reproducibility.
    sic_scale : float
        Multiplier on SIC uncertainty (default 1.0 = use raw uncertainty).
    iceberg_scale : float
        Multiplier on iceberg risk uncertainty (default 1.0 = use raw uncertainty).

    Returns
    -------
    List[Scenario]
        List of n_scenarios Scenario objects.

    Raises
    ------
    ValueError
        If required layers are missing from the grid.
    """
    # Validate required layers
    required = ["sic_mean", "sic_uncertainty", "iceberg_risk", "iceberg_risk_uncertainty"]
    for name in required:
        if not grid.has_layer(name):
            raise ValueError(
                f"Layer '{name}' is required for scenario generation but is not available."
            )

    rng = np.random.RandomState(seed)

    sic_mean = grid.sic_mean
    sic_std = grid.sic_uncertainty * sic_scale
    ice_mean = grid.iceberg_risk
    ice_std = grid.iceberg_risk_uncertainty * iceberg_scale

    scenarios: List[Scenario] = []

    for s_id in range(n_scenarios):
        # Gaussian perturbation + clipping
        eps_sic = rng.normal(0, 1, sic_mean.shape) * sic_std
        eps_ice = rng.normal(0, 1, ice_mean.shape) * ice_std

        sic_perturbed = np.clip(sic_mean + eps_sic, 0.0, 1.0)
        ice_perturbed = np.clip(ice_mean + eps_ice, 0.0, 1.0)

        scenarios.append(Scenario(
            scenario_id=s_id,
            sic=sic_perturbed,
            iceberg_risk=ice_perturbed,
        ))

    return scenarios


def scenario_to_env_fn(
    scenario: Scenario,
    base_grid: EnvironmentalGrid,
    base_env_fn: Optional[Callable[[float], EnvironmentalGrid]] = None,
) -> Callable[[float], EnvironmentalGrid]:
    """
    Convert a static Scenario into an env_fn(t) callable.

    If base_env_fn is provided, the scenario perturbation is applied on
    top of the base env_fn's output at each timestep. Otherwise, the
    scenario grid is returned for all t (static scenario).

    Parameters
    ----------
    scenario : Scenario
        The scenario to convert.
    base_grid : EnvironmentalGrid
        The base grid (used by scenario.to_grid).
    base_env_fn : callable, optional
        Base time-dependent environment function. If provided, the scenario
        perturbation is applied to env_fn(t) output instead of base_grid.

    Returns
    -------
    callable
        env_fn(t) -> EnvironmentalGrid
    """
    scenario_replacements = {
        "sic_mean": scenario.sic,
        "iceberg_risk": scenario.iceberg_risk,
    }

    def _apply_replacements(grid: EnvironmentalGrid) -> EnvironmentalGrid:
        import copy
        g = copy.copy(grid)
        for attr, replacement in scenario_replacements.items():
            if hasattr(g, attr) and getattr(g, attr) is not None:
                setattr(g, attr, replacement.copy())
        return g

    if base_env_fn is not None:
        def env_fn(t: float) -> EnvironmentalGrid:
            base = base_env_fn(t)
            return _apply_replacements(base)
        return env_fn
    else:
        scenario_grid = scenario.to_grid(base_grid)
        return lambda _t: scenario_grid

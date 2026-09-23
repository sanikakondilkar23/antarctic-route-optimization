"""
Configuration for Antarctic Route Optimization
===============================================

All values are PLACEHOLDERS for Step 1.
Final values will be determined after the research audit (Step 2+).

Do NOT treat these as tuned or validated parameters.
"""

from dataclasses import dataclass, field
from typing import Optional


# =============================================================================
# GRID / ENVIRONMENT RESOLUTION
# =============================================================================

@dataclass
class GridConfig:
    """Spatial grid configuration for the operational area."""
    # Antarctic operational area bounds (degrees)
    lat_min: float = -70.0    # southern boundary
    lat_max: float = -64.0    # northern boundary
    lon_min: float = 70.0     # eastern boundary
    lon_max: float = 80.0     # western boundary

    # Grid resolution in degrees (~5.5 km at 0.05 deg)
    resolution_deg: float = 0.05

    # Projection: EPSG:3031 (Antarctic Polar Stereographic)
    # Used for distance calculations, not for grid construction
    projection: str = "EPSG:3031"


# =============================================================================
# VESSEL PARAMETERS
# =============================================================================

@dataclass
class VesselConfig:
    """Physical characteristics of the vessel."""
    # --- Identity ---
    name: str = "Research Vessel (placeholder)"

    # --- Ice class (IMO Polar Code) ---
    # PC1=year-round all waters, PC5=year-round moderate first-year ice
    ice_class: str = "PC5"

    # --- Dimensions ---
    length_m: float = 100.0       # length overall
    beam_m: float = 18.0          # beam
    draft_m: float = 6.5          # design draft

    # --- Propulsion ---
    power_kw: float = 8000.0      # installed power
    service_speed_knots: float = 12.0

    # --- Fuel ---
    fuel_type: str = "MGO"        # Marine Gas Oil (Polar Code compliant)

    # --- Lindqvist ice resistance parameters ---
    # These determine how speed degrades in ice
    # Placeholder values — will be calibrated from literature
    lindqvist_A: float = 0.0     # crushing resistance coefficient
    lindqvist_B: float = 0.0     # bending resistance coefficient
    lindqvist_C: float = 0.0     # submergence resistance coefficient


# =============================================================================
# ENVIRONMENTAL COST WEIGHTS
# =============================================================================

@dataclass
class CostWeights:
    """Weights for the multi-factor edge cost function."""
    # Each weight scales a normalized cost component
    # Final weights TBD after baseline experiments
    distance: float = 1.0
    time: float = 1.0
    fuel: float = 1.0
    sea_ice: float = 1.0
    iceberg: float = 1.0
    current: float = 1.0
    uncertainty: float = 1.0


# =============================================================================
# RISK PARAMETERS
# =============================================================================

@dataclass
class RiskConfig:
    """Parameters for environmental risk calculation."""
    # SIC thresholds (0-1 concentration)
    sic_low: float = 0.3          # below this: low risk
    sic_medium: float = 0.6       # below this: medium risk
    sic_high: float = 0.8         # above this: high risk / impassable

    # Iceberg proximity thresholds (nautical miles)
    iceberg_danger_nm: float = 5.0
    iceberg_warning_nm: float = 15.0
    iceberg_caution_nm: float = 25.0

    # Bathymetry safety margin (meters)
    min_depth_m: float = 20.0

    # POLARIS risk index minimum acceptable
    min_rio: int = 0


# =============================================================================
# UNCERTAINTY PARAMETERS
# =============================================================================

@dataclass
class UncertaintyConfig:
    """Parameters for forecast uncertainty modeling."""
    # Number of Monte Carlo scenarios to generate
    n_scenarios: int = 15

    # SIC uncertainty
    # sigma as fraction of SIC value (e.g., 0.1 = ±10%)
    sic_sigma_fraction: float = 0.15

    # Iceberg positional uncertainty
    # sigma_0: initial uncertainty (km) at t=0
    iceberg_sigma_0_km: float = 2.0
    # growth rate: sigma grows as sigma_0 + alpha * sqrt(t_hours)
    iceberg_sigma_growth: float = 1.5  # km per sqrt(hour)

    # Spatial correlation length for SIC perturbations (grid cells)
    sic_correlation_length: int = 3

    # Random seed for reproducibility
    random_seed: int = 42


# =============================================================================
# SCENARIO / OPTIMIZATION PARAMETERS
# =============================================================================

@dataclass
class OptimizationConfig:
    """Parameters for the route optimization algorithm."""
    # Risk aversion parameter (0=risk-neutral, 1=max risk-averse)
    risk_aversion: float = 0.5

    # CVaR confidence level (alpha)
    # alpha=0.05 means we care about the worst 5% of scenarios
    cvar_alpha: float = 0.05

    # Maximum voyage time (hours)
    max_voyage_hours: float = 200.0

    # A* grid connectivity: 8 (cardinal+diagonal) or 16 (adds knight moves)
    connectivity: int = 8

    # Path smoothing: Chaikin corner cutting iterations
    smoothing_iterations: int = 2


# =============================================================================
# EVALUATION PARAMETERS
# =============================================================================

@dataclass
class EvaluationConfig:
    """Parameters for route evaluation and comparison."""
    # Baselines to generate for comparison
    baselines: list = field(default_factory=lambda: [
        "great_circle",
        "distance_only_astar",
        "deterministic_risk_astar",
    ])

    # Metrics to compute
    metrics: list = field(default_factory=lambda: [
        "total_distance_km",
        "total_time_hours",
        "fuel_proxy_tons",
        "max_single_edge_risk",
        "cumulative_sic_exposure",
        "min_iceberg_clearance_nm",
        "cvar_95_cost",
        "worst_case_cost",
        "p_high_risk_fraction",
        "route_stability_km",
    ])

    # Risk threshold for "high risk" classification
    high_risk_threshold: float = 0.7


# =============================================================================
# MASTER CONFIG
# =============================================================================

@dataclass
class AppConfig:
    """Top-level configuration aggregating all sub-configs."""
    grid: GridConfig = field(default_factory=GridConfig)
    vessel: VesselConfig = field(default_factory=VesselConfig)
    weights: CostWeights = field(default_factory=CostWeights)
    risk: RiskConfig = field(default_factory=RiskConfig)
    uncertainty: UncertaintyConfig = field(default_factory=UncertaintyConfig)
    optimization: OptimizationConfig = field(default_factory=OptimizationConfig)
    evaluation: EvaluationConfig = field(default_factory=EvaluationConfig)


# Default configuration instance
DEFAULT_CONFIG = AppConfig()

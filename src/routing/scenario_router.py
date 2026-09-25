"""
Scenario-Based Route Evaluation
================================

Runs the SAME deterministic A* on multiple scenario grids and
evaluates how the optimal route changes across plausible futures.

Also provides TD-A* scenario evaluation and CVaR-based robust
route selection (M5).

This module does NOT implement a new routing algorithm.
It reuses the existing A* from src.routing.astar and
the time-dependent A* from src.routing.td_astar.

Cost definition (consistent with A*):
    total_cost = env_cost(start) + sum_{i=1}^{N} [env_cost(p_i) + w_distance * d(p_{i-1}, p_i)]

Purpose:
    Establish whether environmental uncertainty materially affects
    the preferred route, providing experimental evidence for or
    against investing in a robust route-selection method.

Labels:
    "Synthetic uncertainty experiment -- NOT real Antarctic forecast uncertainty"
"""

from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np

from src.environment.grid import EnvironmentalGrid
from src.routing.astar import RouteResult, astar
from src.routing.cost import CostWeights
from src.routing.td_astar import TDRouteResult, td_astar
from src.uncertainty.cvar import compute_cvar
from src.uncertainty.scenarios import Scenario, scenario_to_env_fn


@dataclass
class RouteMetrics:
    """Per-route environmental exposure metrics."""
    total_cost: float
    route_length: float
    sic_min: float
    sic_mean: float
    sic_max: float
    iceberg_mean: float
    wind_mean: float
    current_mean: float


@dataclass
class ComparisonResult:
    """Full comparison of deterministic route vs scenario-optimal routes."""

    # Deterministic route (fixed across all scenarios)
    deterministic_path: List[Tuple[int, int]]
    deterministic_cost: float
    deterministic_length: float
    deterministic_metrics: RouteMetrics

    # Per-scenario optimal routes
    scenario_routes: Dict[int, RouteResult]
    scenario_metrics: Dict[int, RouteMetrics]

    # Deterministic route evaluated under each scenario
    det_under_scenario: Dict[int, float]

    # Stability metrics
    jaccard_overlap: Dict[int, float]   # |A ∩ B| / |A ∪ B|
    route_coverage: Dict[int, float]    # |A ∩ B| / |A| (det route coverage)

    # Regret
    regret: Dict[int, float]  # det_cost_under_s - opt_cost_s


@dataclass
class CVaRResult:
    """Result of CVaR-based robust route evaluation."""

    # Candidate route that was selected
    selected_path: List[Tuple[int, int]]
    selected_times: List[float]           # cumulative arrival times per step
    selected_scenario_grid: Optional[EnvironmentalGrid]  # grid the route was optimized for
    selected_cost_mean: float
    selected_cvar: float
    selected_var: float
    selected_worst_case: float

    # Per-candidate metrics (keyed by scenario_id of the scenario that generated the route)
    candidate_paths: Dict[int, List[Tuple[int, int]]]
    candidate_times: Dict[int, List[float]]  # per-candidate arrival times
    candidate_costs: Dict[int, List[float]]  # candidate_id -> costs across all scenarios
    candidate_cvar: Dict[int, float]
    candidate_mean: Dict[int, float]

    # Deterministic route for comparison
    deterministic_path: List[Tuple[int, int]]
    deterministic_cvar: float
    deterministic_mean: float

    # Configuration
    n_scenarios: int
    alpha: float


def compute_route_metrics(
    grid: EnvironmentalGrid,
    path: List[Tuple[int, int]],
    weights: CostWeights,
) -> RouteMetrics:
    """
    Compute environmental exposure metrics and total objective cost for a path.

    Cost formula (consistent with A*):
        total = env_cost(start) + sum_{i=1}^{N} [env_cost(p_i) + w_distance * d(p_{i-1}, p_i)]
    """
    from src.routing.cost import CostMap

    if not path:
        return RouteMetrics(0, 0, 0, 0, 0, 0, 0, 0)

    cost_map = CostMap(grid, weights)

    rows = [p[0] for p in path]
    cols = [p[1] for p in path]

    # Total objective cost — consistent with A*
    total = 0.0
    for i, (r, c) in enumerate(path):
        cell_env = cost_map.cell_cost(r, c)
        if i == 0:
            total += cell_env  # start cell environmental cost
        else:
            pr, pc = path[i - 1]
            dr = r - pr
            dc = c - pc
            dist = np.sqrt(dr * dr + dc * dc)
            total += cell_env + weights.w_distance * dist

    # Geometric route length
    route_len = 0.0
    for i in range(1, len(path)):
        dr = path[i][0] - path[i - 1][0]
        dc = path[i][1] - path[i - 1][1]
        route_len += np.sqrt(dr * dr + dc * dc)

    # Environmental exposure along route
    sic_vals = grid.sic_mean[rows, cols] if grid.sic_mean is not None else np.zeros(len(rows))
    ice_vals = grid.iceberg_risk[rows, cols] if grid.iceberg_risk is not None else np.zeros(len(rows))
    wind_vals = grid.wind_cost[rows, cols] if grid.wind_cost is not None else np.zeros(len(rows))
    curr_vals = grid.current_cost[rows, cols] if grid.current_cost is not None else np.zeros(len(rows))

    return RouteMetrics(
        total_cost=float(total),
        route_length=float(route_len),
        sic_min=float(sic_vals.min()) if len(sic_vals) > 0 else 0.0,
        sic_mean=float(sic_vals.mean()) if len(sic_vals) > 0 else 0.0,
        sic_max=float(sic_vals.max()) if len(sic_vals) > 0 else 0.0,
        iceberg_mean=float(ice_vals.mean()) if len(ice_vals) > 0 else 0.0,
        wind_mean=float(wind_vals.mean()) if len(wind_vals) > 0 else 0.0,
        current_mean=float(curr_vals.mean()) if len(curr_vals) > 0 else 0.0,
    )


def jaccard_overlap(
    path_a: List[Tuple[int, int]],
    path_b: List[Tuple[int, int]],
) -> float:
    """
    Jaccard similarity: |A ∩ B| / |A ∪ B|.

    Returns 1.0 if paths are identical, 0.0 if completely disjoint.
    """
    set_a = set(path_a)
    set_b = set(path_b)
    if not set_a or not set_b:
        return 0.0
    return len(set_a & set_b) / len(set_a | set_b)


def route_coverage(
    path_det: List[Tuple[int, int]],
    path_sc: List[Tuple[int, int]],
) -> float:
    """
    Fraction of deterministic-route cells visited by scenario route: |A ∩ B| / |A|.

    Returns 1.0 if scenario route covers all deterministic-route cells.
    """
    set_det = set(path_det)
    set_sc = set(path_sc)
    if not set_det:
        return 0.0
    return len(set_det & set_sc) / len(set_det)


def evaluate_scenarios(
    base_grid: EnvironmentalGrid,
    scenarios: List[Scenario],
    start: Tuple[int, int],
    goal: Tuple[int, int],
    weights: Optional[CostWeights] = None,
) -> ComparisonResult:
    """
    Run the central experiment: deterministic route vs scenario-optimal routes.

    Steps:
        1. Run A* on the mean environment -> deterministic route (fixed).
        2. For each scenario s:
           a. Build scenario grid.
           b. Run A* on scenario grid -> scenario-optimal route.
           c. Evaluate deterministic route under scenario s (same cost function).
           d. Compute Jaccard overlap, coverage, and regret.
    """
    if weights is None:
        weights = CostWeights()

    # --- Step 1: Deterministic route (mean environment) ---
    det_result = astar(base_grid, start, goal, weights=weights)
    if not det_result.success:
        raise RuntimeError("Deterministic A* failed -- no route exists on the mean environment.")

    det_metrics = compute_route_metrics(base_grid, det_result.path, weights)

    # --- Step 2: Per-scenario evaluation ---
    scenario_routes: Dict[int, RouteResult] = {}
    scenario_metrics: Dict[int, RouteMetrics] = {}
    det_under_scenario: Dict[int, float] = {}
    jaccard: Dict[int, float] = {}
    coverage: Dict[int, float] = {}
    regret: Dict[int, float] = {}

    for scenario in scenarios:
        # Build scenario grid
        scenario_grid = scenario.to_grid(base_grid)

        # Run A* on scenario
        sc_result = astar(scenario_grid, start, goal, weights=weights)
        scenario_routes[scenario.scenario_id] = sc_result

        if sc_result.success:
            sc_metrics = compute_route_metrics(scenario_grid, sc_result.path, weights)
            scenario_metrics[scenario.scenario_id] = sc_metrics

            # Deterministic route evaluated under this scenario (same cost function)
            det_cost_under = compute_route_metrics(scenario_grid, det_result.path, weights)
            det_under_scenario[scenario.scenario_id] = det_cost_under.total_cost

            # Overlap metrics
            jaccard[scenario.scenario_id] = jaccard_overlap(det_result.path, sc_result.path)
            coverage[scenario.scenario_id] = route_coverage(det_result.path, sc_result.path)

            # Regret: det route cost under scenario minus scenario-optimal cost
            regret[scenario.scenario_id] = (
                det_cost_under.total_cost - sc_metrics.total_cost
            )
        else:
            scenario_metrics[scenario.scenario_id] = RouteMetrics(
                float("inf"), 0, 0, 0, 0, 0, 0, 0
            )
            det_under_scenario[scenario.scenario_id] = float("inf")
            jaccard[scenario.scenario_id] = 0.0
            coverage[scenario.scenario_id] = 0.0
            regret[scenario.scenario_id] = float("inf")

    return ComparisonResult(
        deterministic_path=det_result.path,
        deterministic_cost=det_result.total_cost,
        deterministic_length=det_result.route_length,
        deterministic_metrics=det_metrics,
        scenario_routes=scenario_routes,
        scenario_metrics=scenario_metrics,
        det_under_scenario=det_under_scenario,
        jaccard_overlap=jaccard,
        route_coverage=coverage,
        regret=regret,
    )


# ---------------------------------------------------------------------------
# TD-A* scenario evaluation (M5)
# ---------------------------------------------------------------------------

def _td_evaluate_route_on_scenario(
    path: List[Tuple[int, int]],
    scenario_grid: EnvironmentalGrid,
    weights: CostWeights,
    vessel_speed_knots: float = 12.0,
) -> float:
    """
    Evaluate a fixed path's cost under a scenario using TD-A* cost model.

    Walks the path edge-by-edge, computing travel-time-based cost with
    directional current, consistent with td_astar.td_edge_cost.

    Returns the total cost (travel time * w_distance + env cost).
    """
    from src.routing.current_model import project_current_along_movement
    from src.routing.td_astar import KNOTS_TO_KMH, _cell_env_cost
    from src.routing.current_model import compute_effective_speed_knots

    if len(path) < 2:
        return _cell_env_cost(scenario_grid, path[0][0], path[0][1], weights)

    cell_size_km = scenario_grid.cell_size_km()
    total_cost = _cell_env_cost(scenario_grid, path[0][0], path[0][1], weights)

    for i in range(1, len(path)):
        r_prev, c_prev = path[i - 1]
        r, c = path[i]
        dr = r - r_prev
        dc = c - c_prev
        dist = np.sqrt(dr * dr + dc * dc)

        # Project current onto movement direction
        proj_curr = 0.0
        if scenario_grid.current_uo is not None and scenario_grid.current_vo is not None:
            uo_val = float(scenario_grid.current_uo[r, c])
            vo_val = float(scenario_grid.current_vo[r, c])
            proj_curr = project_current_along_movement(uo_val, vo_val, dr, dc)

        # Travel time
        edge_distance_km = dist * cell_size_km
        v_eff = compute_effective_speed_knots(vessel_speed_knots, proj_curr)
        travel_time_h = edge_distance_km / (v_eff * KNOTS_TO_KMH)

        # Environmental cost at destination
        env_cost = _cell_env_cost(scenario_grid, r, c, weights)

        total_cost += travel_time_h * weights.w_distance + env_cost

    return total_cost


def evaluate_scenarios_td(
    base_grid: EnvironmentalGrid,
    scenarios: List[Scenario],
    start: Tuple[int, int],
    goal: Tuple[int, int],
    weights: Optional[CostWeights] = None,
    vessel_speed_knots: float = 12.0,
    env_fn: Optional[Callable] = None,
) -> Dict[int, TDRouteResult]:
    """
    Run TD-A* on each scenario and return the per-scenario results.

    Parameters
    ----------
    base_grid : EnvironmentalGrid
        The mean/baseline grid.
    scenarios : list of Scenario
        Perturbed scenarios.
    start, goal : (row, int)
        Start and goal cells.
    weights : CostWeights, optional
        Cost weights.
    vessel_speed_knots : float
        Vessel speed in knots.
    env_fn : callable, optional
        Base time-dependent environment function. If provided, scenario
        env_fns are composed on top (scenario perturbation applied after
        the base env_fn). If None, scenarios use static base_grid.

    Returns
    -------
    dict
        {scenario_id: TDRouteResult}
    """
    if weights is None:
        weights = CostWeights()

    results: Dict[int, TDRouteResult] = {}
    for scenario in scenarios:
        scenario_env_fn = scenario_to_env_fn(scenario, base_grid, base_env_fn=env_fn)
        result = td_astar(
            base_grid, start, goal,
            weights=weights,
            vessel_speed_knots=vessel_speed_knots,
            env_fn=scenario_env_fn,
        )
        results[scenario.scenario_id] = result

    return results


# ---------------------------------------------------------------------------
# Robust route selection via CVaR (M5)
# ---------------------------------------------------------------------------

def select_robust_route(
    base_grid: EnvironmentalGrid,
    scenarios: List[Scenario],
    start: Tuple[int, int],
    goal: Tuple[int, int],
    weights: Optional[CostWeights] = None,
    alpha: float = 0.05,
    vessel_speed_knots: float = 12.0,
    env_fn: Optional[Callable] = None,
) -> CVaRResult:
    """
    Scenario-based CVaR route selection.

    Algorithm:
        1. For each scenario s_i: run TD-A* → candidate route r_i.
        2. For each candidate r_i: evaluate cost under ALL K scenarios.
        3. Compute CVaR_alpha for each candidate.
        4. Select the candidate with minimum CVaR.

    With K=15 and alpha=0.05:
        ceil(0.05 * 15) = 1
        CVaR = mean of worst 1 scenario = max(costs)
        VaR  = max(costs)
        Both are identical in this regime.

    Parameters
    ----------
    base_grid : EnvironmentalGrid
        Mean/baseline grid.
    scenarios : list of Scenario
        K perturbed scenarios.
    start, goal : (row, int)
        Start and goal cells.
    weights : CostWeights, optional
        Cost weights.
    alpha : float
        CVaR confidence level in (0, 1].
    vessel_speed_knots : float
        Vessel speed in knots.
    env_fn : callable, optional
        Base time-dependent environment function. If provided, scenario
        env_fns are composed on top. If None, scenarios use static base_grid.

    Returns
    -------
    CVaRResult
        Selected route and per-candidate metrics.
    """
    if weights is None:
        weights = CostWeights()

    k = len(scenarios)

    # Step 1: Generate one candidate route per scenario via TD-A*
    td_results = evaluate_scenarios_td(
        base_grid, scenarios, start, goal, weights, vessel_speed_knots,
        env_fn=env_fn,
    )

    # Collect successful candidate routes
    candidate_paths: Dict[int, List[Tuple[int, int]]] = {}
    candidate_times: Dict[int, List[float]] = {}
    scenario_grids: Dict[int, EnvironmentalGrid] = {}
    for scenario in scenarios:
        sid = scenario.scenario_id
        if td_results[sid].success:
            candidate_paths[sid] = td_results[sid].path
            candidate_times[sid] = td_results[sid].times
            scenario_grids[sid] = scenario.to_grid(base_grid)

    # If no candidates succeeded, fall back to deterministic
    if not candidate_paths:
        det_result = astar(base_grid, start, goal, weights=weights)
        return CVaRResult(
            selected_path=det_result.path if det_result.success else [],
            selected_times=[],
            selected_scenario_grid=None,
            selected_cost_mean=det_result.total_cost if det_result.success else float("inf"),
            selected_cvar=float("inf"),
            selected_var=float("inf"),
            selected_worst_case=float("inf"),
            candidate_paths={},
            candidate_times={},
            candidate_costs={},
            candidate_cvar={},
            candidate_mean={},
            deterministic_path=det_result.path if det_result.success else [],
            deterministic_cvar=float("inf"),
            deterministic_mean=det_result.total_cost if det_result.success else float("inf"),
            n_scenarios=k,
            alpha=alpha,
        )

    # Step 2: Evaluate each candidate route under ALL scenarios
    candidate_costs: Dict[int, List[float]] = {}
    for cand_id, cand_path in candidate_paths.items():
        costs = []
        for scenario in scenarios:
            scenario_grid = scenario.to_grid(base_grid)
            cost = _td_evaluate_route_on_scenario(
                cand_path, scenario_grid, weights, vessel_speed_knots,
            )
            costs.append(cost)
        candidate_costs[cand_id] = costs

    # Step 3: Compute CVaR for each candidate
    candidate_cvar: Dict[int, float] = {}
    candidate_mean: Dict[int, float] = {}
    for cand_id, costs in candidate_costs.items():
        _, cvar = compute_cvar(costs, alpha)
        candidate_cvar[cand_id] = cvar
        candidate_mean[cand_id] = float(np.mean(costs))

    # Step 4: Select candidate with minimum CVaR
    best_id = min(candidate_cvar, key=candidate_cvar.get)
    best_costs = candidate_costs[best_id]
    best_var, best_cvar = compute_cvar(best_costs, alpha)

    # Deterministic route for comparison
    det_result = astar(base_grid, start, goal, weights=weights)
    if det_result.success:
        det_costs = []
        for scenario in scenarios:
            scenario_grid = scenario.to_grid(base_grid)
            cost = _td_evaluate_route_on_scenario(
                det_result.path, scenario_grid, weights, vessel_speed_knots,
            )
            det_costs.append(cost)
        _, det_cvar = compute_cvar(det_costs, alpha)
        det_mean = float(np.mean(det_costs))
    else:
        det_result = RouteResult(False, [], 0.0, 0.0, 0)
        det_cvar = float("inf")
        det_mean = float("inf")

    return CVaRResult(
        selected_path=candidate_paths[best_id],
        selected_times=candidate_times[best_id],
        selected_scenario_grid=scenario_grids[best_id],
        selected_cost_mean=candidate_mean[best_id],
        selected_cvar=best_cvar,
        selected_var=best_var,
        selected_worst_case=max(best_costs),
        candidate_paths=candidate_paths,
        candidate_times=candidate_times,
        candidate_costs=candidate_costs,
        candidate_cvar=candidate_cvar,
        candidate_mean=candidate_mean,
        deterministic_path=det_result.path,
        deterministic_cvar=det_cvar,
        deterministic_mean=det_mean,
        n_scenarios=k,
        alpha=alpha,
    )

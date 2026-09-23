"""
Experiment: Scenario-Based Route Comparison (Corrected)
=======================================================

Central question: Does environmental forecast uncertainty materially
change the preferred route compared to optimizing on the mean forecast?

Method:
    1. Run A* on the mean environment -> deterministic route.
    2. Controlled sweep: zero / SIC-only / iceberg-only / both uncertainties.
    3. Uncertainty scale sweep (0.0 to 3.0) for both sources.
    4. Clipping analysis: measure how much perturbation hits [0,1] bounds.
    5. Evaluate deterministic route under each scenario (same cost function).
    6. Report Jaccard overlap, coverage, regret, and route cost variance.

Outputs:
    outputs/results/scenario_experiment.json
    outputs/figures/scenario_controlled_sweep.png
    outputs/figures/scenario_scale_sweep.png
    outputs/figures/scenario_clipping_analysis.png

Labels:
    "Synthetic uncertainty experiment -- NOT real Antarctic forecast uncertainty"
"""

import json
import sys
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from src.environment.synthetic import generate_synthetic
from src.routing.astar import astar
from src.routing.cost import CostWeights
from src.routing.scenario_router import (
    compute_route_metrics,
    evaluate_scenarios,
    jaccard_overlap,
    route_coverage,
)
from src.uncertainty.scenarios import generate_scenarios


START = (2, 2)
GOAL = (35, 45)
N_SCENARIOS = 20
SEED = 42


def find_navigable_target(grid, preferred_rc):
    """Return preferred_rc if navigable, otherwise nearest navigable cell."""
    r, c = preferred_rc
    if grid.navigable[r, c]:
        return (r, c)
    for dist in range(1, max(grid.n_rows, grid.n_cols)):
        for dr in range(-dist, dist + 1):
            for dc in range(-dist, dist + 1):
                nr, nc = r + dr, c + dc
                if 0 <= nr < grid.n_rows and 0 <= nc < grid.n_cols:
                    if grid.navigable[nr, nc]:
                        return (nr, nc)
    raise ValueError("No navigable cell found near target")


def clipping_analysis(grid, n_scenarios=50):
    """Measure how much of the perturbation is clipped at [0,1] bounds."""
    rng = np.random.RandomState(SEED)

    sic_raw = rng.normal(0, 1, (n_scenarios, grid.n_rows, grid.n_cols))
    sic_pert = sic_raw * grid.sic_uncertainty[np.newaxis, :, :]
    sic_before = grid.sic_mean[np.newaxis, :, :] + sic_pert
    sic_after = np.clip(sic_before, 0.0, 1.0)

    sic_clipped_low = (sic_before < 0.0).mean()
    sic_clipped_high = (sic_before > 1.0).mean()
    sic_max_excess = float(np.abs(sic_before - sic_after).max())
    sic_mean_excess = float(np.abs(sic_before - sic_after).mean())

    ice_raw = rng.normal(0, 1, (n_scenarios, grid.n_rows, grid.n_cols))
    ice_pert = ice_raw * grid.iceberg_risk_uncertainty[np.newaxis, :, :]
    ice_before = grid.iceberg_risk[np.newaxis, :, :] + ice_pert
    ice_after = np.clip(ice_before, 0.0, 1.0)

    ice_clipped_low = (ice_before < 0.0).mean()
    ice_clipped_high = (ice_before > 1.0).mean()
    ice_max_excess = float(np.abs(ice_before - ice_after).max())
    ice_mean_excess = float(np.abs(ice_before - ice_after).mean())

    return {
        "sic": {
            "clipped_low_frac": round(float(sic_clipped_low), 6),
            "clipped_high_frac": round(float(sic_clipped_high), 6),
            "max_excess": round(sic_max_excess, 6),
            "mean_excess": round(sic_mean_excess, 6),
        },
        "iceberg": {
            "clipped_low_frac": round(float(ice_clipped_low), 6),
            "clipped_high_frac": round(float(ice_clipped_high), 6),
            "max_excess": round(ice_max_excess, 6),
            "mean_excess": round(ice_mean_excess, 6),
        },
    }


def run_controlled_sweep(grid, start, goal, weights, n_scenarios=20):
    """Zero / SIC-only / iceberg-only / both uncertainties."""
    configs = {
        "zero": {"sic_scale": 0.0, "iceberg_scale": 0.0},
        "sic_only": {"sic_scale": 1.0, "iceberg_scale": 0.0},
        "iceberg_only": {"sic_scale": 0.0, "iceberg_scale": 1.0},
        "both": {"sic_scale": 1.0, "iceberg_scale": 1.0},
    }

    results = {}
    for name, cfg in configs.items():
        scenarios = generate_scenarios(
            grid, n_scenarios=n_scenarios, seed=SEED,
            sic_scale=cfg["sic_scale"], iceberg_scale=cfg["iceberg_scale"],
        )
        comp = evaluate_scenarios(grid, scenarios, start, goal, weights=weights)

        sc_costs = [r.total_cost for r in comp.scenario_routes.values() if r.success]
        jaccards = list(comp.jaccard_overlap.values())
        coverages = list(comp.route_coverage.values())
        regrets = [v for v in comp.regret.values() if v != float("inf")]

        results[name] = {
            "sic_scale": cfg["sic_scale"],
            "iceberg_scale": cfg["iceberg_scale"],
            "det_cost": round(comp.deterministic_cost, 6),
            "mean_scenario_cost": round(float(np.mean(sc_costs)), 6) if sc_costs else None,
            "cost_std": round(float(np.std(sc_costs)), 6) if sc_costs else None,
            "mean_jaccard": round(float(np.mean(jaccards)), 6),
            "mean_coverage": round(float(np.mean(coverages)), 6),
            "mean_regret": round(float(np.mean(regrets)), 6) if regrets else None,
            "max_regret": round(float(np.max(regrets)), 6) if regrets else None,
            "n_routes_differ": sum(1 for j in jaccards if j < 0.99),
            "n_scenarios": n_scenarios,
        }

    return results


def run_scale_sweep(grid, start, goal, weights, scales=None, n_scenarios=20):
    """Sweep uncertainty scale from 0 to 3.0."""
    if scales is None:
        scales = [0.0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0]

    results = []
    for scale in scales:
        scenarios = generate_scenarios(
            grid, n_scenarios=n_scenarios, seed=SEED,
            sic_scale=scale, iceberg_scale=scale,
        )
        comp = evaluate_scenarios(grid, scenarios, start, goal, weights=weights)

        sc_costs = [r.total_cost for r in comp.scenario_routes.values() if r.success]
        jaccards = list(comp.jaccard_overlap.values())
        regrets = [v for v in comp.regret.values() if v != float("inf")]

        results.append({
            "scale": scale,
            "det_cost": round(comp.deterministic_cost, 6),
            "mean_scenario_cost": round(float(np.mean(sc_costs)), 6) if sc_costs else None,
            "cost_std": round(float(np.std(sc_costs)), 6) if sc_costs else None,
            "mean_jaccard": round(float(np.mean(jaccards)), 6),
            "mean_regret": round(float(np.mean(regrets)), 6) if regrets else None,
            "n_routes_differ": sum(1 for j in jaccards if j < 0.99),
        })

    return results


def main():
    print("=" * 60)
    print("STEP 2C: Scenario-Based Route Comparison (Corrected)")
    print("Synthetic uncertainty experiment -- NOT real Antarctic forecast uncertainty")
    print("=" * 60)
    print()

    # --- Generate environment ---
    grid = generate_synthetic(n_rows=40, n_cols=50, seed=SEED)
    print(grid.summary())
    print()

    start = find_navigable_target(grid, START)
    goal = find_navigable_target(grid, GOAL)
    print(f"Start cell: {start}")
    print(f"Goal cell:  {goal}")
    print()

    weights = CostWeights(w_sic=1.0, w_ice=1.0, w_wind=1.0, w_curr=1.0, w_distance=1.0)

    # --- Clipping analysis ---
    print("--- Clipping Analysis ---")
    clip = clipping_analysis(grid, n_scenarios=50)
    for field in ["sic", "iceberg"]:
        c = clip[field]
        print(f"  {field:10s}: clipped_low={c['clipped_low_frac']:.4f}, "
              f"clipped_high={c['clipped_high_frac']:.4f}, "
              f"max_excess={c['max_excess']:.6f}, "
              f"mean_excess={c['mean_excess']:.6f}")
    print()

    # --- Controlled sweep ---
    print("--- Controlled Sweep (zero / SIC-only / iceberg-only / both) ---")
    sweep = run_controlled_sweep(grid, start, goal, weights, n_scenarios=N_SCENARIOS)
    for name, res in sweep.items():
        print(f"  {name:12s}: det_cost={res['det_cost']:.4f}, "
              f"mean_sc_cost={res['mean_scenario_cost']}, "
              f"jaccard={res['mean_jaccard']:.4f}, "
              f"coverage={res['mean_coverage']:.4f}, "
              f"regret={res['mean_regret']}, "
              f"n_differ={res['n_routes_differ']}/{res['n_scenarios']}")
    print()

    # --- Scale sweep ---
    print("--- Uncertainty Scale Sweep ---")
    scale_res = run_scale_sweep(grid, start, goal, weights, n_scenarios=N_SCENARIOS)
    for r in scale_res:
        print(f"  scale={r['scale']:.2f}: det={r['det_cost']:.4f}, "
              f"sc_mean={r['mean_scenario_cost']}, std={r['cost_std']}, "
              f"jaccard={r['mean_jaccard']:.4f}, "
              f"regret={r['mean_regret']}, "
              f"n_differ={r['n_routes_differ']}")
    print()

    # --- Standard full experiment (scale=1.0) ---
    print("--- Full Experiment (scale=1.0) ---")
    scenarios = generate_scenarios(grid, n_scenarios=N_SCENARIOS, seed=SEED)
    result = evaluate_scenarios(grid, scenarios, start, goal, weights=weights)

    det_cost = result.deterministic_cost
    det_length = result.deterministic_length
    det_metrics = result.deterministic_metrics

    sc_costs = [r.total_cost for r in result.scenario_routes.values() if r.success]
    sc_lengths = [r.route_length for r in result.scenario_routes.values() if r.success]
    regrets = [v for v in result.regret.values() if v != float("inf")]
    jaccards = [v for v in result.jaccard_overlap.values()]
    coverages = [v for v in result.route_coverage.values()]

    mean_sc_cost = float(np.mean(sc_costs)) if sc_costs else 0.0
    mean_sc_length = float(np.mean(sc_lengths)) if sc_lengths else 0.0
    mean_regret = float(np.mean(regrets)) if regrets else 0.0
    median_regret = float(np.median(regrets)) if regrets else 0.0
    max_regret = float(np.max(regrets)) if regrets else 0.0
    p90_regret = float(np.percentile(regrets, 90)) if regrets else 0.0
    mean_jaccard = float(np.mean(jaccards))
    mean_coverage = float(np.mean(coverages))
    n_different = sum(1 for j in jaccards if j < 0.99)

    print(f"  Det route length: {det_length:.4f}, cost: {det_cost:.4f}")
    print(f"  Mean scenario cost: {mean_sc_cost:.4f} (std={float(np.std(sc_costs)):.4f})")
    print(f"  Mean regret: {mean_regret:.4f}, median: {median_regret:.4f}, P90: {p90_regret:.4f}")
    print(f"  Mean Jaccard overlap: {mean_jaccard:.4f}")
    print(f"  Mean route coverage:  {mean_coverage:.4f}")
    print(f"  Routes differ: {n_different}/{N_SCENARIOS}")
    print()

    # --- Save JSON ---
    results_dir = project_root / "outputs" / "results"
    results_dir.mkdir(parents=True, exist_ok=True)

    per_scenario = []
    for sc_id in sorted(result.scenario_routes.keys()):
        sc_r = result.scenario_routes[sc_id]
        entry = {
            "scenario_id": sc_id,
            "route_found": sc_r.success,
            "scenario_optimal_cost": round(sc_r.total_cost, 6) if sc_r.success else None,
            "scenario_optimal_length": round(sc_r.route_length, 6) if sc_r.success else None,
            "det_route_under_scenario_cost": round(
                result.det_under_scenario.get(sc_id, float("inf")), 6
            ),
            "jaccard_overlap": round(result.jaccard_overlap.get(sc_id, 0.0), 6),
            "route_coverage": round(result.route_coverage.get(sc_id, 0.0), 6),
            "regret": round(result.regret.get(sc_id, float("inf")), 6),
        }
        per_scenario.append(entry)

    results_dict = {
        "label": "Synthetic uncertainty experiment -- NOT real Antarctic forecast uncertainty",
        "seed": SEED,
        "n_scenarios": N_SCENARIOS,
        "start": list(start),
        "goal": list(goal),
        "scenario_generation": {
            "method": "Gaussian perturbation + clipping to [0,1]",
            "sic_scale": 1.0,
            "iceberg_scale": 1.0,
            "sic_uncertainty_range": "dimensionless [0,1]",
            "iceberg_risk_uncertainty_range": "dimensionless [0,0.3]",
        },
        "clipping_analysis": clip,
        "controlled_sweep": sweep,
        "scale_sweep": scale_res,
        "deterministic_route": {
            "route_length": round(det_length, 6),
            "total_cost": round(det_cost, 6),
            "sic_mean": round(det_metrics.sic_mean, 6),
            "iceberg_mean": round(det_metrics.iceberg_mean, 6),
            "wind_mean": round(det_metrics.wind_mean, 6),
            "current_mean": round(det_metrics.current_mean, 6),
        },
        "aggregate": {
            "mean_scenario_route_length": round(mean_sc_length, 6),
            "mean_scenario_optimal_cost": round(mean_sc_cost, 6),
            "cost_std": round(float(np.std(sc_costs)), 6),
            "mean_regret": round(mean_regret, 6),
            "median_regret": round(median_regret, 6),
            "p90_regret": round(p90_regret, 6),
            "max_regret": round(max_regret, 6),
            "mean_jaccard_overlap": round(mean_jaccard, 6),
            "mean_route_coverage": round(mean_coverage, 6),
            "scenarios_with_different_route": n_different,
        },
        "per_scenario": per_scenario,
    }

    json_path = results_dir / "scenario_experiment.json"
    with open(json_path, "w") as f:
        json.dump(results_dict, f, indent=2)
    print(f"Results saved to: {json_path}")

    # --- Figure 1: Controlled sweep bar chart ---
    fig1, axes1 = plt.subplots(1, 3, figsize=(15, 5))
    names = list(sweep.keys())
    labels = ["Zero", "SIC only", "Iceberg only", "Both"]
    x = np.arange(len(names))

    ax = axes1[0]
    jaccards_arr = [sweep[n]["mean_jaccard"] for n in names]
    coverages_arr = [sweep[n]["mean_coverage"] for n in names]
    b1 = ax.bar(x - 0.2, jaccards_arr, 0.35, label="Jaccard overlap", color="steelblue")
    b2 = ax.bar(x + 0.2, coverages_arr, 0.35, label="Route coverage", color="coral")
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=15)
    ax.set_ylabel("Metric value")
    ax.set_title("Route Stability by Uncertainty Source")
    ax.set_ylim(0, 1.05)
    ax.legend()

    ax = axes1[1]
    regrets_arr = [sweep[n]["mean_regret"] if sweep[n]["mean_regret"] is not None else 0.0 for n in names]
    ax.bar(x, regrets_arr, 0.6, color="steelblue", edgecolor="black")
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=15)
    ax.set_ylabel("Mean regret (cost)")
    ax.set_title("Mean Regret by Uncertainty Source")
    ax.axhline(0, color="black", linewidth=0.5)

    ax = axes1[2]
    costs_arr = [sweep[n]["mean_scenario_cost"] if sweep[n]["mean_scenario_cost"] is not None else 0.0 for n in names]
    det_c = sweep["zero"]["det_cost"]
    ax.bar(x, [det_c] * len(names), 0.6, label="Deterministic", color="lightgray", edgecolor="black")
    ax.bar(x, costs_arr, 0.4, label="Scenario-optimal mean", color="steelblue", edgecolor="black")
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=15)
    ax.set_ylabel("Route cost")
    ax.set_title("Cost: Deterministic vs Scenario-Optimal")
    ax.legend()

    fig1.suptitle(
        "STEP 2C: Controlled Uncertainty Sweep\n"
        "Synthetic experiment -- NOT real Antarctic forecast uncertainty",
        fontweight="bold",
    )
    plt.tight_layout(rect=[0, 0, 1, 0.92])
    fig_dir = project_root / "outputs" / "figures"
    fig_dir.mkdir(parents=True, exist_ok=True)
    fig1.savefig(fig_dir / "scenario_controlled_sweep.png", dpi=150, bbox_inches="tight")
    plt.close(fig1)
    print("Figure saved: outputs/figures/scenario_controlled_sweep.png")

    # --- Figure 2: Scale sweep line plot ---
    fig2, axes2 = plt.subplots(1, 3, figsize=(15, 5))
    scales = [r["scale"] for r in scale_res]

    ax = axes2[0]
    ax.plot(scales, [r["mean_jaccard"] for r in scale_res], "o-", color="steelblue")
    ax.set_xlabel("Uncertainty scale")
    ax.set_ylabel("Mean Jaccard overlap")
    ax.set_title("Route Stability vs Uncertainty")
    ax.set_ylim(-0.05, 1.05)

    ax = axes2[1]
    ax.plot(scales, [r["mean_regret"] if r["mean_regret"] is not None else 0.0 for r in scale_res],
            "o-", color="coral")
    ax.set_xlabel("Uncertainty scale")
    ax.set_ylabel("Mean regret (cost)")
    ax.set_title("Regret vs Uncertainty")
    ax.axhline(0, color="black", linewidth=0.5)

    ax = axes2[2]
    ax.plot(scales, [r["cost_std"] if r["cost_std"] is not None else 0.0 for r in scale_res],
            "o-", color="darkgreen")
    ax.set_xlabel("Uncertainty scale")
    ax.set_ylabel("Cost std dev")
    ax.set_title("Route Cost Variance vs Uncertainty")

    fig2.suptitle(
        "STEP 2C: Uncertainty Scale Sweep\n"
        "Synthetic experiment -- NOT real Antarctic forecast uncertainty",
        fontweight="bold",
    )
    plt.tight_layout(rect=[0, 0, 1, 0.92])
    fig2.savefig(fig_dir / "scenario_scale_sweep.png", dpi=150, bbox_inches="tight")
    plt.close(fig2)
    print("Figure saved: outputs/figures/scenario_scale_sweep.png")

    # --- Figure 3: Clipping analysis ---
    fig3, axes3 = plt.subplots(1, 2, figsize=(12, 5))

    for idx, field in enumerate(["sic", "iceberg"]):
        ax = axes3[idx]
        c = clip[field]
        labels_c = ["Clipped low\n(<0)", "Unclipped", "Clipped high\n(>1)"]
        vals = [c["clipped_low_frac"], 1.0 - c["clipped_low_frac"] - c["clipped_high_frac"],
                c["clipped_high_frac"]]
        colors = ["#3498db", "#2ecc71", "#e74c3c"]
        ax.bar(labels_c, vals, color=colors, edgecolor="black")
        ax.set_ylabel("Fraction of cells")
        ax.set_title(f"{field.upper()} Perturbation Clipping")
        ax.set_ylim(0, 1.05)
        for i, v in enumerate(vals):
            ax.text(i, v + 0.02, f"{v:.4f}", ha="center", fontsize=10)

    fig3.suptitle(
        "STEP 2C: Clipping Analysis\n"
        "How much perturbation hits [0,1] bounds?",
        fontweight="bold",
    )
    plt.tight_layout(rect=[0, 0, 1, 0.88])
    fig3.savefig(fig_dir / "scenario_clipping_analysis.png", dpi=150, bbox_inches="tight")
    plt.close(fig3)
    print("Figure saved: outputs/figures/scenario_clipping_analysis.png")

    # --- Figure 4: Route variability (original) ---
    fig4, ax4 = plt.subplots(figsize=(10, 8))
    extent = [grid.lon.min(), grid.lon.max(), grid.lat.min(), grid.lat.max()]

    ax4.imshow(grid.sic_mean, origin="lower", extent=extent,
               cmap="Blues_r", alpha=0.4, vmin=0, vmax=1, aspect="auto")

    nav_img = np.zeros((*grid.navigable.shape, 4))
    nav_img[~grid.navigable] = [0.8, 0.2, 0.2, 0.4]
    ax4.imshow(nav_img, origin="lower", extent=extent, aspect="auto")

    det_path = result.deterministic_path
    for sc_id, sc_r in result.scenario_routes.items():
        if sc_r.success and sc_r.path != det_path:
            sc_lons = [grid.lon[c] for _, c in sc_r.path]
            sc_lats = [grid.lat[r] for r, _ in sc_r.path]
            ax4.plot(sc_lons, sc_lats, "-", color="gray", alpha=0.25,
                     linewidth=0.8, zorder=2)

    det_lons = [grid.lon[c] for _, c in det_path]
    det_lats = [grid.lat[r] for r, _ in det_path]
    ax4.plot(det_lons, det_lats, "o-", color="#00CC00", markersize=3,
             linewidth=2.5, label="Deterministic (mean) route", zorder=4)

    ax4.plot(grid.lon[start[1]], grid.lat[start[0]], "s", color="blue",
             markersize=12, label="Start", zorder=5)
    ax4.plot(grid.lon[goal[1]], grid.lat[goal[0]], "*", color="red",
             markersize=15, label="Goal", zorder=5)

    ax4.set_xlabel("Longitude")
    ax4.set_ylabel("Latitude")
    ax4.set_title(
        "STEP 2C: Route Variability Across Scenarios\n"
        "Synthetic uncertainty experiment -- NOT real Antarctic forecast uncertainty"
    )
    ax4.legend(loc="upper left")
    fig4.savefig(fig_dir / "scenario_route_variability.png", dpi=150, bbox_inches="tight")
    plt.close(fig4)
    print("Figure saved: outputs/figures/scenario_route_variability.png")

    # --- Interpretation ---
    print()
    print("INTERPRETATION")
    print("-" * 40)
    if mean_jaccard > 0.85:
        classification = "A. Uncertainty has little effect on route selection."
    elif mean_jaccard > 0.5:
        classification = "B. Uncertainty changes route selection moderately."
    else:
        classification = "C. Uncertainty substantially changes route selection."
    print(f"  Classification: {classification}")
    print(f"  Mean Jaccard overlap: {mean_jaccard:.4f}")
    print(f"  Mean regret: {mean_regret:.4f}")
    print()
    print("Done.")


if __name__ == "__main__":
    main()

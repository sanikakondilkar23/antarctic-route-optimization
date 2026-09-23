"""
Experiment: Baseline Deterministic A* Routing
=============================================

Uses the synthetic Antarctic-like environment from STEP 2A.

Outputs:
    outputs/figures/baseline_astar_route.png
    outputs/figures/baseline_cost_map.png
    outputs/results/baseline_astar.json

Labels:
    "Synthetic experimental environment — NOT real Antarctic data"
"""

import json
import math
import sys
import time
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from src.environment.synthetic import generate_synthetic
from src.routing.astar import astar
from src.routing.cost import CostMap, CostWeights


# Deterministic start and goal (row, col) in the 40x50 synthetic grid
START = (2, 2)
GOAL = (35, 45)


def find_navigable_target(grid, preferred_rc):
    """Return preferred_rc if navigable, otherwise nearest navigable cell."""
    r, c = preferred_rc
    if grid.navigable[r, c]:
        return (r, c)
    # Spiral out to find nearest navigable cell
    for dist in range(1, max(grid.n_rows, grid.n_cols)):
        for dr in range(-dist, dist + 1):
            for dc in range(-dist, dist + 1):
                nr, nc = r + dr, c + dc
                if 0 <= nr < grid.n_rows and 0 <= nc < grid.n_cols:
                    if grid.navigable[nr, nc]:
                        return (nr, nc)
    raise ValueError("No navigable cell found near target")


def main():
    print("=" * 60)
    print("STEP 2B: Baseline Deterministic A* Routing")
    print("Synthetic experimental environment — NOT real Antarctic data")
    print("=" * 60)
    print()

    # --- Generate environment ---
    grid = generate_synthetic(n_rows=40, n_cols=50, seed=42)
    print(grid.summary())
    print()

    # --- Find valid start and goal ---
    start = find_navigable_target(grid, START)
    goal = find_navigable_target(grid, GOAL)
    print(f"Start cell: {start}")
    print(f"Goal cell:  {goal}")
    print()

    # --- Run A* ---
    weights = CostWeights(
        w_sic=1.0, w_ice=1.0, w_wind=1.0, w_curr=1.0, w_distance=1.0
    )
    result = astar(grid, start, goal, weights=weights)

    print(f"Route found:    {result.success}")
    print(f"Route length:   {result.route_length:.4f} (grid units)")
    print(f"Total cost:     {result.total_cost:.4f}")
    print(f"Expanded nodes: {result.expanded_nodes}")
    print(f"Computation:    {result.elapsed_seconds * 1000:.2f} ms")
    print(f"Waypoints:      {result.num_waypoints}")
    print()

    # --- Route metrics ---
    if result.success:
        path_rows = [p[0] for p in result.path]
        path_cols = [p[1] for p in result.path]

        sic_vals = grid.sic_mean[path_rows, path_cols]
        ice_vals = grid.iceberg_risk[path_rows, path_cols]
        wind_vals = grid.wind_cost[path_rows, path_cols]
        curr_vals = grid.current_cost[path_rows, path_cols]

        print("Route environmental metrics:")
        print(f"  SIC:       min={sic_vals.min():.4f}  "
              f"mean={sic_vals.mean():.4f}  max={sic_vals.max():.4f}")
        print(f"  Iceberg:   min={ice_vals.min():.4f}  "
              f"mean={ice_vals.mean():.4f}  max={ice_vals.max():.4f}")
        print(f"  Wind:      min={wind_vals.min():.4f}  "
              f"mean={wind_vals.mean():.4f}  max={wind_vals.max():.4f}")
        print(f"  Current:   min={curr_vals.min():.4f}  "
              f"mean={curr_vals.mean():.4f}  max={curr_vals.max():.4f}")
        print()

        # --- Save JSON results ---
        results_dir = project_root / "outputs" / "results"
        results_dir.mkdir(parents=True, exist_ok=True)
        json_path = results_dir / "baseline_astar.json"

        results_dict = {
            "start": list(start),
            "goal": list(goal),
            "success": result.success,
            "route_length": round(result.route_length, 6),
            "total_cost": round(result.total_cost, 6),
            "expanded_nodes": result.expanded_nodes,
            "elapsed_ms": round(result.elapsed_seconds * 1000, 2),
            "num_waypoints": result.num_waypoints,
            "weights": {
                "w_sic": weights.w_sic,
                "w_ice": weights.w_ice,
                "w_wind": weights.w_wind,
                "w_curr": weights.w_curr,
                "w_distance": weights.w_distance,
            },
            "route_metrics": {
                "sic_min": round(float(sic_vals.min()), 6),
                "sic_mean": round(float(sic_vals.mean()), 6),
                "sic_max": round(float(sic_vals.max()), 6),
                "iceberg_mean": round(float(ice_vals.mean()), 6),
                "wind_mean": round(float(wind_vals.mean()), 6),
                "current_mean": round(float(curr_vals.mean()), 6),
            },
            "grid_shape": [grid.n_rows, grid.n_cols],
            "seed": 42,
        }

        with open(json_path, "w") as f:
            json.dump(results_dict, f, indent=2)
        print(f"Results saved to: {json_path}")

    # --- Figure 1: Route visualization ---
    fig, ax = plt.subplots(figsize=(10, 8))
    extent = [grid.lon.min(), grid.lon.max(), grid.lat.min(), grid.lat.max()]

    # Background: SIC as risk indicator
    ax.imshow(grid.sic_mean, origin="lower", extent=extent,
              cmap="Blues_r", alpha=0.5, vmin=0, vmax=1, aspect="auto")

    # Navigable outline
    nav_edge = np.zeros((*grid.navigable.shape, 4))
    nav_edge[grid.navigable] = [0.9, 0.95, 0.9, 0.15]   # light green, translucent
    nav_edge[~grid.navigable] = [0.8, 0.2, 0.2, 0.5]    # red, semi-transparent
    ax.imshow(nav_edge, origin="lower", extent=extent, aspect="auto")

    # Iceberg risk overlay
    ax.imshow(grid.iceberg_risk, origin="lower", extent=extent,
              cmap="OrRd", alpha=0.3, vmin=0, vmax=1, aspect="auto")

    # Route line
    if result.success:
        route_lons = [grid.lon[c] for _, c in result.path]
        route_lats = [grid.lat[r] for r, _ in result.path]
        ax.plot(route_lons, route_lats, "o-", color="#00CC00",
                markersize=3, linewidth=2, label="A* route", zorder=5)

    # Start and goal
    ax.plot(grid.lon[start[1]], grid.lat[start[0]], "s", color="blue",
            markersize=12, label="Start", zorder=6)
    ax.plot(grid.lon[goal[1]], grid.lat[goal[0]], "*", color="red",
            markersize=15, label="Goal", zorder=6)

    ax.set_xlabel("Longitude")
    ax.set_ylabel("Latitude")
    ax.set_title(
        "STEP 2B: Baseline A* Route\n"
        "Synthetic experimental environment — NOT real Antarctic data"
    )
    ax.legend(loc="upper left")

    fig_dir = project_root / "outputs" / "figures"
    fig_dir.mkdir(parents=True, exist_ok=True)
    route_path = fig_dir / "baseline_astar_route.png"
    fig.savefig(route_path, dpi=150, bbox_inches="tight")
    plt.close(fig)
    print(f"\nRoute figure saved to: {route_path}")

    # --- Figure 2: Cost map ---
    cost_map = CostMap(grid, weights)

    fig2, ax2 = plt.subplots(figsize=(10, 8))
    im = ax2.imshow(cost_map.env_cost, origin="lower", extent=extent,
                    cmap="YlOrRd", alpha=0.8, aspect="auto")
    plt.colorbar(im, ax=ax2, label="Environmental cost", fraction=0.046)

    # Overlay navigable boundary
    nav_boundary = np.zeros((*grid.navigable.shape, 4))
    nav_boundary[~grid.navigable] = [0, 0, 0, 0.6]
    ax2.imshow(nav_boundary, origin="lower", extent=extent, aspect="auto")

    if result.success:
        ax2.plot(route_lons, route_lats, "o-", color="#00CC00",
                 markersize=3, linewidth=2, label="A* route", zorder=5)

    ax2.plot(grid.lon[start[1]], grid.lat[start[0]], "s", color="blue",
             markersize=12, label="Start", zorder=6)
    ax2.plot(grid.lon[goal[1]], grid.lat[goal[0]], "*", color="red",
             markersize=15, label="Goal", zorder=6)

    ax2.set_xlabel("Longitude")
    ax2.set_ylabel("Latitude")
    ax2.set_title(
        "STEP 2B: Baseline Environmental Cost Map\n"
        "Synthetic experimental environment — NOT real Antarctic data"
    )
    ax2.legend(loc="upper left")

    cost_path = fig_dir / "baseline_cost_map.png"
    fig2.savefig(cost_path, dpi=150, bbox_inches="tight")
    plt.close(fig2)
    print(f"Cost map figure saved to: {cost_path}")

    print("\nDone.")


if __name__ == "__main__":
    main()

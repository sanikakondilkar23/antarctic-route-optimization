"""
Experiment: Visualize the synthetic environmental grid.

Generates:
    outputs/figures/synthetic_environment.png

Labels:
    "Synthetic experimental environment — NOT real Antarctic data"
"""

import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

import matplotlib
matplotlib.use("Agg")  # non-interactive backend for saving
import matplotlib.pyplot as plt
import numpy as np

from src.environment.synthetic import generate_synthetic


def main():
    """Generate and save a 4-panel visualization of the synthetic environment."""
    print("Generating synthetic environment...")
    grid = generate_synthetic(n_rows=40, n_cols=50, seed=42)
    print(grid.summary())
    print()

    fig, axes = plt.subplots(2, 2, figsize=(14, 10))

    extent = [grid.lon.min(), grid.lon.max(), grid.lat.min(), grid.lat.max()]

    # --- Panel 1: Navigability ---
    ax = axes[0, 0]
    nav_img = grid.navigable.astype(float)
    im0 = ax.imshow(nav_img, origin="lower", extent=extent, cmap="RdYlGn",
                    vmin=0, vmax=1, aspect="auto")
    ax.set_title("Navigability (green=navigable, red=blocked)")
    ax.set_xlabel("Longitude")
    ax.set_ylabel("Latitude")
    plt.colorbar(im0, ax=ax, fraction=0.046, pad=0.04)

    # --- Panel 2: SIC ---
    ax = axes[0, 1]
    im1 = ax.imshow(grid.sic_mean, origin="lower", extent=extent,
                    cmap="Blues_r", vmin=0, vmax=1, aspect="auto")
    ax.set_title("Sea-Ice Concentration (SIC) Mean")
    ax.set_xlabel("Longitude")
    ax.set_ylabel("Latitude")
    plt.colorbar(im1, ax=ax, fraction=0.046, pad=0.04, label="SIC (0-1)")

    # --- Panel 3: Iceberg Risk ---
    ax = axes[1, 0]
    im2 = ax.imshow(grid.iceberg_risk, origin="lower", extent=extent,
                    cmap="OrRd", vmin=0, vmax=1, aspect="auto")
    ax.set_title("Iceberg Risk Score")
    ax.set_xlabel("Longitude")
    ax.set_ylabel("Latitude")
    plt.colorbar(im2, ax=ax, fraction=0.046, pad=0.04, label="Risk (0-1)")

    # --- Panel 4: SIC Uncertainty ---
    ax = axes[1, 1]
    im3 = ax.imshow(grid.sic_uncertainty, origin="lower", extent=extent,
                    cmap="YlOrRd", vmin=0, aspect="auto")
    ax.set_title("SIC Uncertainty (std dev)")
    ax.set_xlabel("Longitude")
    ax.set_ylabel("Latitude")
    plt.colorbar(im3, ax=ax, fraction=0.046, pad=0.04, label="sigma")

    # --- Title ---
    fig.suptitle(
        "STEP 2A: Synthetic Antarctic-Like Environment\n"
        "Synthetic experimental environment — NOT real Antarctic data",
        fontsize=13, fontweight="bold", y=0.98
    )
    plt.tight_layout(rect=[0, 0, 1, 0.93])

    # --- Save ---
    out_dir = project_root / "outputs" / "figures"
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "synthetic_environment.png"
    fig.savefig(out_path, dpi=150, bbox_inches="tight")
    plt.close(fig)

    print(f"Figure saved to: {out_path}")
    print("Done.")


if __name__ == "__main__":
    main()

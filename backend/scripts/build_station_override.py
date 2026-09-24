#!/usr/bin/env python3
"""
Build the station approach override for the PolarPath routing grid.

Maitri's exact routing cell lies on the NSIDC land mask (NaN ->
impassable), so A* would have no goal cell for routes to Maitri (and
the same holds for Bharati). A 50 km radius override around each
station marks a traversable approach disc and records the station's
goal cell, modelling the helicopter-transfer distance used when
vessels cannot reach the pier.

Produces:
    cache/routing_station_override.npy   [H_route, H_lon] bool
    cache/routing_station_goals.json     {name: [row, col]}
    plots/station_override.png           SIC map + override contours

Does NOT modify the cost grids or the land masks; integration into
the A* cost loading happens separately (Task 5).
"""
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "cache"
PLOTS = ROOT / "plots"

APPROACH_RADIUS_KM = 50
R = 6371.0
STATIONS = {
    "Maitri": (-70.77, 11.73),
    "Bharati": (-69.41, 76.19),
}


def main():
    routing_lat = np.load(CACHE / "routing_lat.npy")   # [173]
    routing_lon = np.load(CACHE / "routing_lon.npy")   # [369]
    H_route = len(routing_lat)
    H_lon = len(routing_lon)

    lat2d, lon2d = np.meshgrid(routing_lat, routing_lon, indexing="ij")

    override = np.zeros((H_route, H_lon), dtype=bool)
    station_goal_cells = {}

    for name, (slat, slon) in STATIONS.items():
        dlat = np.deg2rad(lat2d - slat)
        dlon = np.deg2rad(lon2d - slon)
        a = (np.sin(dlat / 2) ** 2 +
             np.cos(np.deg2rad(slat)) * np.cos(np.deg2rad(lat2d)) *
             np.sin(dlon / 2) ** 2)
        d_km = 2 * R * np.arcsin(np.sqrt(a))
        in_radius = d_km < APPROACH_RADIUS_KM
        override |= in_radius

        i_lat = int(np.argmin(np.abs(routing_lat - slat)))
        j_lon = int(np.argmin(np.abs(routing_lon - slon)))
        station_goal_cells[name] = (i_lat, j_lon)
        print(f"{name}: {int(in_radius.sum())} cells within "
              f"{APPROACH_RADIUS_KM} km, goal cell = ({i_lat}, {j_lon}) = "
              f"({routing_lat[i_lat]}, {routing_lon[j_lon]})")

    np.save(CACHE / "routing_station_override.npy", override)
    with open(CACHE / "routing_station_goals.json", "w") as f:
        json.dump({k: [int(v[0]), int(v[1])]
                   for k, v in station_goal_cells.items()}, f, indent=2)

    # STEP 2 verification
    ma = station_goal_cells["Maitri"]
    bh = station_goal_cells["Bharati"]
    overlap = np.intersect1d(np.argwhere(override)[:, 0] * H_lon +
                             np.argwhere(override)[:, 1], []) is not None
    # simpler overlap check: count cells within 50 km of BOTH stations
    dlat_m = np.deg2rad(lat2d - STATIONS["Maitri"][0])
    dlon_m = np.deg2rad(lon2d - STATIONS["Maitri"][1])
    a_m = np.sin(dlat_m / 2) ** 2 + np.cos(np.deg2rad(-70.77)) * \
        np.cos(np.deg2rad(lat2d)) * np.sin(dlon_m / 2) ** 2
    dm = 2 * R * np.arcsin(np.sqrt(a_m))
    dlat_b = np.deg2rad(lat2d - STATIONS["Bharati"][0])
    dlon_b = np.deg2rad(lon2d - STATIONS["Bharati"][1])
    a_b = np.sin(dlat_b / 2) ** 2 + np.cos(np.deg2rad(-69.41)) * \
        np.cos(np.deg2rad(lat2d)) * np.sin(dlon_b / 2) ** 2
    db = 2 * R * np.arcsin(np.sqrt(a_b))
    print(f"Both-station cells (overlap < 100 km): "
          f"{int(((dm < 100) & (db < 100)).sum())}")

    # Cape Town not in override
    ct_lat = int(np.argmin(np.abs(routing_lat - (-33.92))))
    ct_lon = int(np.argmin(np.abs(routing_lon - 18.42)))
    print(f"Cape Town cell ({ct_lat},{ct_lon}) in override: "
          f"{bool(override[ct_lat, ct_lon])}")

    # STEP 2 preview plot
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    sic = np.load(CACHE / "routing_sic_2026.npy")[0]
    fig, ax = plt.subplots(figsize=(14, 5))
    ax.imshow(sic, cmap="Blues_r", origin="lower", aspect="auto",
              extent=[routing_lon[0], routing_lon[-1],
                      routing_lat[0], routing_lat[-1]], vmin=0, vmax=1)
    ax.contour(routing_lon, routing_lat, override.astype(int),
               levels=[0.5], colors="red", linewidths=2)
    ax.plot(11.73, -70.77, "g*", markersize=20, label="Maitri")
    ax.plot(76.19, -69.41, "g*", markersize=20, label="Bharati")
    ax.set_xlabel("Longitude")
    ax.set_ylabel("Latitude")
    ax.legend()
    plt.tight_layout()
    plt.savefig(PLOTS / "station_override.png", dpi=120)
    print(f"Saved plots/station_override.png")


if __name__ == "__main__":
    main()
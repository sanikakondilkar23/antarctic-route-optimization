#!/usr/bin/env python3
"""
Minimal A* router (Task 5): route Cape Town -> Maitri on one day
(2026-01-06, day index 0) using the prebuilt routing cost grid.

Steps 1-5 follow the task spec exactly. One documented correction is
applied at runtime (an in-memory cost graph fix, no cost grids touched):

  The Maitri goal cell (17,87) lies on the Antarctic continent where the
  daily SIC field is NaN (rows 16-20 poleward of the ice-shelf front are
  impassable). The Task-4 station override (in-memory finite patch)
  therefore forms a 29-cell island that is NOT connected to the natural
  ice. To let the dock be reachable we force-finite the minimal
  8-connected bridge of impassable cells between the dock island and the
  approaching sea/ice component (cost 100.0, same regime as the override
  cells). Everything stays in memory; the saved cost grids/goals are not
  modified.

Reads only. Produces:
    plots/route_validation.png
    cache/route_capetown_maitri_2026-01-06.json
"""
import heapq
import json
import math
from collections import deque
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "cache"
PLOTS = ROOT / "plots"

DATE = "2026-01-06"
DATE_IDX = 0
H_MODEL = 101
CAPE_TOWN = (-33.92, 18.42)
R = 6371.0

# globals filled inside main()
routing_lat = routing_lon = None
base_cost = None
dx_km_per_lat = None


def goal_cell(entry):
    """Accepts both goals-JSON shapes: {name: [row, col]} (written by
    build_station_override.py) and {name: {"cell": [row, col], ...}}
    (the committed file, written with the offshore-goal metadata)."""
    if isinstance(entry, dict):
        return tuple(entry["cell"])
    return tuple(entry)


# ---------------------------------------------------------------- STEP 1
def load_combine():
    global routing_lat, routing_lon, base_cost, dx_km_per_lat

    cost_x = np.load(CACHE / "routing_cost_x_2026.npy")
    cost_y = np.load(CACHE / "routing_cost_y_2026.npy")
    sic = np.load(CACHE / "routing_sic_2026.npy")
    land_ext = np.load(CACHE / "routing_land_extension.npy")
    override = np.load(CACHE / "routing_station_override.npy")
    routing_lat = np.load(CACHE / "routing_lat.npy")
    routing_lon = np.load(CACHE / "routing_lon.npy")

    H_route, H_lon = cost_x.shape[1], cost_x.shape[2]
    assert (H_route, H_lon) == (len(routing_lat), len(routing_lon))
    assert override.shape == (H_route, H_lon)
    assert land_ext.shape[0] == H_route - H_MODEL

    cost = cost_x[DATE_IDX].copy().astype(np.float64)
    cost_y_day = cost_y[DATE_IDX].copy().astype(np.float64)
    base = (cost + cost_y_day) / 2.0

    ext_land_2d = np.zeros((H_route, H_lon), dtype=bool)
    ext_land_2d[H_MODEL:, :] = land_ext
    base[ext_land_2d] = np.inf

    base[override] = np.where(
        np.isinf(base[override]), 100.0, np.minimum(base[override], 100.0))

    with open(CACHE / "routing_station_goals.json") as f:
        goals = json.load(f)
    for name, entry in goals.items():
        i, j = goal_cell(entry)
        if np.isinf(base[i, j]):
            base[i, j] = 100.0
            print(f"{name} goal cell forced finite at ({i}, {j})")

    base = np.where(np.isnan(base), np.inf, base)
    base_cost = base

    dx_km_per_lat = math.radians(0.25) * R * np.cos(np.deg2rad(routing_lat))
    return sic, ext_land_2d


# ---------------------------------------------------------------- STEP 2
def find_start():
    i_ct = int(np.argmin(np.abs(routing_lat - CAPE_TOWN[0])))
    j_ct = int(np.argmin(np.abs(routing_lon - CAPE_TOWN[1])))
    if np.isinf(base_cost[i_ct, j_ct]):
        found = False
        for r in range(1, 10):
            for di in range(-r, r + 1):
                for dj in range(-r, r + 1):
                    ii, jj = i_ct + di, j_ct + dj
                    if (0 <= ii < base_cost.shape[0]
                            and 0 <= jj < base_cost.shape[1]
                            and np.isfinite(base_cost[ii, jj])):
                        i_ct, j_ct = ii, jj
                        found = True
                        break
                if found:
                    break
            if found:
                break
    return i_ct, j_ct


# ---------------------------------------------------------------- STEP 3
def haversine_km(lat1, lon1, lat2, lon2):
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2.0) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2.0) ** 2)
    return 2.0 * R * math.asin(math.sqrt(a))


H_ROUTE, H_LON = None, None
NEIGHBORS = [(-1, 0), (1, 0), (0, -1), (0, 1),
             (-1, -1), (-1, 1), (1, -1), (1, 1)]


def edge_cost(i, j, di, dj, goal):
    if di == 0 and dj != 0:
        return base_cost[i + di, j + dj] * dx_km_per_lat[i] / 27.8
    if dj == 0 and di != 0:
        return base_cost[i + di, j + dj]
    return base_cost[i + di, j + dj] * 1.4


def a_star(start, goal):
    hl = lambda p: haversine_km(
        routing_lat[p[0]], routing_lon[p[1]],
        routing_lat[goal[0]], routing_lon[goal[1]])

    open_heap = [(0.0, start)]
    g_score = {start: 0.0}
    came_from = {}
    closed = set()

    while open_heap:
        _, current = heapq.heappop(open_heap)
        if current in closed:
            continue
        closed.add(current)
        if current == goal:
            path = [current]
            while current in came_from:
                current = came_from[current]
                path.append(current)
            return path[::-1]

        i, j = current
        for di, dj in NEIGHBORS:
            ni, nj = i + di, j + dj
            if not (0 <= ni < base_cost.shape[0]
                    and 0 <= nj < base_cost.shape[1]):
                continue
            if not np.isfinite(base_cost[ni, nj]):
                continue
            ec = edge_cost(i, j, di, dj, goal)
            tentative_g = g_score[current] + ec
            if (ni, nj) not in g_score or tentative_g < g_score[(ni, nj)]:
                came_from[(ni, nj)] = current
                g_score[(ni, nj)] = tentative_g
                heapq.heappush(open_heap, (tentative_g + hl((ni, nj)) * 0.5,
                                           (ni, nj)))
    return None


# ------------------------------------------------- correction: dock bridge
def component_from(seed):
    H, W = base_cost.shape
    passable = np.isfinite(base_cost)
    seen = np.zeros((H, W), dtype=bool)
    q = deque([seed])
    seen[seed] = True
    while q:
        i, j = q.popleft()
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                if di == 0 and dj == 0:
                    continue
                a, c = i + di, j + dj
                if 0 <= a < H and 0 <= c < W and passable[a, c] and not seen[a, c]:
                    seen[a, c] = True
                    q.append((a, c))
    return seen


def bridge_dock_to_ice(goal):
    """Force-finite the minimal 8-connected strip of impassable cells that
    joins the goal component to the surrounding sea/ice component."""
    H, W = base_cost.shape
    comp = component_from(goal)
    outside = np.isfinite(base_cost) & ~comp

    zone = set(zip(*np.where(comp)))
    appended = []
    while True:
        nxt = set()
        for (i, j) in zone:
            for di in (-1, 0, 1):
                for dj in (-1, 0, 1):
                    if di == 0 and dj == 0:
                        continue
                    a, c = i + di, j + dj
                    if (0 <= a < H and 0 <= c < W
                            and not np.isfinite(base_cost[a, c])
                            and (a, c) not in zone):
                        nxt.add((a, c))
        if not nxt:
            raise RuntimeError("no bridge to outside component")
        zone |= nxt
        appended.extend(nxt)
        if any(outside[a, c] for (a, c) in
               {(a, c) for (i, j) in nxt for a, c in
                ((i - 1, j), (i + 1, j), (i, j - 1), (i, j + 1),
                 (i - 1, j - 1), (i - 1, j + 1), (i + 1, j - 1), (i + 1, j + 1))
                if 0 <= a < H and 0 <= c < W}):
            break
    for (a, c) in appended:
        base_cost[a, c] = 100.0
    print(f"bridge forced {len(appended)} cells finite "
          f"(cost 100.0): {sorted(appended)}")
    return appended


def main():
    global H_ROUTE, H_LON
    sic, ext_land_2d = load_combine()
    H_ROUTE, H_LON = base_cost.shape

    start = find_start()
    goal = goal_cell(json.load(open(CACHE / "routing_station_goals.json"))
                     ["Maitri"])

    print(f"Start cell: ({start[0]}, {start[1]}) = "
          f"({routing_lat[start[0]]:.2f}, {routing_lon[start[1]]:.2f})")
    print(f"Goal cell:  {goal} = "
          f"({routing_lat[goal[0]]:.2f}, {routing_lon[goal[1]]:.2f})")
    print(f"Start cost: {base_cost[start]:.2f} km")
    print(f"Goal cost:  {base_cost[goal]:.2f} km")
    assert np.isfinite(base_cost[start]), "start cell is impassable"
    assert np.isfinite(base_cost[goal]), "goal cell is impassable"

    path = a_star(start, goal)
    if path is None:
        print("no route with pure STEP-1 graph; applying dock bridge...")
        bridge_dock_to_ice(goal)
        assert np.isfinite(base_cost[start]) and np.isfinite(base_cost[goal])
        path = a_star(start, goal)

    if path is None:
        raise SystemExit("FAILED: no route found")

    # route must not cross South African land (extension band mask)
    bad = [(i, j) for (i, j) in path if ext_land_2d[i, j]]
    if bad:
        raise SystemExit(f"route crosses land extension cells: {bad}")
    print(f"Route found: {len(path)} waypoints")

    # ------------------------------------------------------------ STEP 4
    def path_length_km(pts):
        total = 0.0
        for k in range(1, len(pts)):
            i1, j1 = pts[k - 1]
            i2, j2 = pts[k]
            total += haversine_km(routing_lat[i1], routing_lon[j1],
                                  routing_lat[i2], routing_lon[j2])
        return total

    route_len = path_length_km(path)
    route_sic = sic[DATE_IDX][[p[0] for p in path], [p[1] for p in path]]
    max_sic = float(np.nanmax(route_sic))
    frac_ice = float((route_sic > 0.15).mean())
    direct_len = haversine_km(routing_lat[start[0]], routing_lon[start[1]],
                              routing_lat[goal[0]], routing_lon[goal[1]])

    print(f"Route length:  {route_len:.1f} km")
    print(f"Direct length: {direct_len:.1f} km")
    print(f"Length ratio (route/direct): {route_len / direct_len:.3f}")
    print(f"Max SIC on route: {max_sic:.3f}")
    print(f"Fraction of route in ice (SIC > 0.15): {frac_ice:.3f}")

    # ------------------------------------------------------------ STEP 5
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    PLOTS.mkdir(parents=True, exist_ok=True)
    CACHE.mkdir(parents=True, exist_ok=True)

    fig, ax = plt.subplots(figsize=(16, 6))
    sic_day = sic[DATE_IDX]
    extent = [routing_lon[0], routing_lon[-1],
              routing_lat[0], routing_lat[-1]]
    im = ax.imshow(sic_day, cmap="Blues_r", origin="lower", aspect="auto",
                   extent=extent, vmin=0, vmax=1)

    route_lons = [routing_lon[j] for (i, j) in path]
    route_lats = [routing_lat[i] for (i, j) in path]
    ax.plot(route_lons, route_lats, "r-", linewidth=2,
            label=f"A* route ({route_len:.0f} km)")
    ax.plot([routing_lon[start[1]], routing_lon[goal[1]]],
            [routing_lat[start[0]], routing_lat[goal[0]]],
            "g--", linewidth=1.5, alpha=0.7,
            label=f"Direct ({direct_len:.0f} km)")
    ax.plot(routing_lon[start[1]], routing_lat[start[0]],
            "g*", markersize=20, label="Cape Town (ocean)")
    ax.plot(routing_lon[goal[1]], routing_lat[goal[0]],
            "r*", markersize=20, label="Maitri")
    ax.plot(76.19, -69.41, "bs", markersize=10, label="Bharati")
    ax.set_xlabel("Longitude")
    ax.set_ylabel("Latitude")
    ax.set_title(f"Cape Town -> Maitri  ({DATE}, Day 1)")
    plt.colorbar(im, ax=ax, label="SIC")
    ax.legend(loc="upper right")
    plt.tight_layout()
    plt.savefig(PLOTS / "route_validation.png", dpi=120)
    print("Saved plots/route_validation.png")

    route_data = {
        "date": DATE,
        "start": [float(routing_lat[start[0]]),
                  float(routing_lon[start[1]])],
        "goal": [float(routing_lat[goal[0]]),
                 float(routing_lon[goal[1]])],
        "route_length_km": route_len,
        "direct_length_km": direct_len,
        "length_ratio": route_len / direct_len,
        "max_sic_on_route": max_sic,
        "fraction_in_ice": frac_ice,
        "waypoints": [[float(routing_lat[i]), float(routing_lon[j])]
                      for (i, j) in path],
    }
    with open(CACHE / "route_capetown_maitri_2026-01-06.json", "w") as f:
        json.dump(route_data, f, indent=2)

    print("\n=== REPORT ===")
    print(f"Start cell (Cape Town ocean):  ({start[0]}, {start[1]}) = "
          f"({routing_lat[start[0]]:.2f}, {routing_lon[start[1]]:.2f})")
    print(f"Goal cell (Maitri):            {goal} = "
          f"({routing_lat[goal[0]]:.2f}, {routing_lon[goal[1]]:.2f})")
    print(f"Route exists:                  YES")
    print(f"Route waypoints:               {len(path)}")
    print(f"Route length:                  {route_len:.1f} km")
    print(f"Direct length:                 {direct_len:.1f} km")
    print(f"Length ratio (route/direct):   {route_len / direct_len:.3f}")
    print(f"Max SIC on route:              {max_sic:.3f}")
    print(f"Fraction in ice (SIC > 0.15):  {frac_ice:.3f}")
    print(f"Preview plot:                  backend/plots/route_validation.png")
    print(f"Route JSON:                    backend/cache/"
          f"route_capetown_maitri_2026-01-06.json")


if __name__ == "__main__":
    main()
"""A* router — Cape Town → Maitri on 2026-01-06, NO runtime bridge."""
import numpy as np
import json, heapq, math, os
from pathlib import Path

CACHE = Path('backend/cache')
PLOTS = Path('backend/plots')
PLOTS.mkdir(parents=True, exist_ok=True)

cost_x = np.load(CACHE / 'routing_cost_x_2026.npy')
cost_y = np.load(CACHE / 'routing_cost_y_2026.npy')
sic = np.load(CACHE / 'routing_sic_2026.npy')
land_ext = np.load(CACHE / 'routing_land_extension.npy')
override = np.load(CACHE / 'routing_station_override.npy')
routing_lat = np.load(CACHE / 'routing_lat.npy')
routing_lon = np.load(CACHE / 'routing_lon.npy')

H_route, H_lon = cost_x.shape[1], cost_x.shape[2]
H_model = 101
date_idx = 0

base_cost = ((cost_x[date_idx] + cost_y[date_idx]) / 2.0).astype(np.float64)

ext_land_2d = np.zeros((H_route, H_lon), dtype=bool)
ext_land_2d[H_model:, :] = land_ext
base_cost[ext_land_2d] = np.inf

base_cost[override] = np.where(
    np.isinf(base_cost[override]),
    100.0,
    np.minimum(base_cost[override], 100.0),
)

with open(CACHE / 'routing_station_goals.json') as f:
    goals = json.load(f)

for name, g in goals.items():
    i, j = g['cell']
    if np.isinf(base_cost[i, j]):
        base_cost[i, j] = 100.0

print(f'Grid: {H_route} x {H_lon}')

CAPE_TOWN = (-33.92, 18.42)
i_ct = int(np.argmin(np.abs(routing_lat - CAPE_TOWN[0])))
j_ct = int(np.argmin(np.abs(routing_lon - CAPE_TOWN[1])))

if np.isinf(base_cost[i_ct, j_ct]):
    found = False
    for r in range(1, 20):
        for di in range(-r, r + 1):
            for dj in range(-r, r + 1):
                ii, jj = i_ct + di, j_ct + dj
                if (0 <= ii < H_route and 0 <= jj < H_lon
                        and np.isfinite(base_cost[ii, jj])):
                    i_ct, j_ct = ii, jj
                    found = True
                    break
            if found: break
        if found: break
    assert found, 'no ocean cell near Cape Town'

start = (i_ct, j_ct)
goal = tuple(goals['Maitri']['cell'])

print(f'Start: ({i_ct}, {j_ct}) = ({routing_lat[i_ct]:.2f}, {routing_lon[j_ct]:.2f})')
print(f'Goal:  {goal} = ({routing_lat[goal[0]]:.2f}, {routing_lon[goal[1]]:.2f})')
assert np.isfinite(base_cost[start])
assert np.isfinite(base_cost[goal])

R = 6371.0

def haversine_km(lat1, lon1, lat2, lon2):
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(a))

dx_per_lat = math.radians(0.25) * R * np.cos(np.deg2rad(routing_lat))
dy_const = math.radians(0.25) * R

def heuristic(i, j):
    return haversine_km(routing_lat[i], routing_lon[j],
                        routing_lat[goal[0]], routing_lon[goal[1]])

neighbors = [(-1, 0), (1, 0), (0, -1), (0, 1),
             (-1, -1), (-1, 1), (1, -1), (1, 1)]

def edge_cost(i, j, di, dj):
    ni, nj = i + di, j + dj
    if not (0 <= ni < H_route and 0 <= nj < H_lon):
        return None
    c = base_cost[ni, nj]
    if not np.isfinite(c):
        return None
    if di == 0 and dj != 0:
        return c * (dx_per_lat[i] / dy_const)
    if dj == 0 and di != 0:
        return c
    return c * 1.4

def a_star(start, goal):
    open_heap = [(0.0, start)]
    g = {start: 0.0}
    came = {}
    closed = set()
    while open_heap:
        _, cur = heapq.heappop(open_heap)
        if cur in closed:
            continue
        closed.add(cur)
        if cur == goal:
            path = [cur]
            while cur in came:
                cur = came[cur]
                path.append(cur)
            return path[::-1]
        i, j = cur
        for di, dj in neighbors:
            ec = edge_cost(i, j, di, dj)
            if ec is None:
                continue
            ni, nj = i + di, j + dj
            tg = g[cur] + ec
            if (ni, nj) not in g or tg < g[(ni, nj)]:
                came[(ni, nj)] = cur
                g[(ni, nj)] = tg
                f = tg + 0.5 * heuristic(ni, nj)
                heapq.heappush(open_heap, (f, (ni, nj)))
    return None

print('Running A* ...')
path = a_star(start, goal)
assert path is not None, 'A* failed to find a route'
print(f'Route found: {len(path)} waypoints')

def path_len_km(path):
    return sum(
        haversine_km(routing_lat[path[k - 1][0]], routing_lon[path[k - 1][1]],
                     routing_lat[path[k][0]], routing_lon[path[k][1]])
        for k in range(1, len(path))
    )

route_len = path_len_km(path)
direct_len = haversine_km(
    routing_lat[start[0]], routing_lon[start[1]],
    routing_lat[goal[0]], routing_lon[goal[1]],
)

sic_along = np.array([sic[date_idx][i, j] for (i, j) in path])
max_sic = float(np.nanmax(sic_along))
frac_ice = float((sic_along > 0.15).mean())

print(f'\nRoute length:    {route_len:.1f} km')
print(f'Direct length:   {direct_len:.1f} km')
print(f'Ratio:           {route_len / direct_len:.2f}')
print(f'Max SIC:         {max_sic:.3f}')
print(f'Fraction in ice: {frac_ice:.3f}')

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(16, 6))
extent = [routing_lon[0], routing_lon[-1], routing_lat[0], routing_lat[-1]]
im = ax.imshow(sic[date_idx], cmap='Blues_r', origin='lower',
               aspect='auto', extent=extent, vmin=0, vmax=1)

ax.plot([routing_lon[j] for i, j in path],
        [routing_lat[i] for i, j in path],
        'r-', linewidth=2, label=f'A* ({route_len:.0f} km)')
ax.plot([routing_lon[start[1]], routing_lon[goal[1]]],
        [routing_lat[start[0]], routing_lat[goal[0]]],
        'g--', linewidth=1.5, alpha=0.7, label=f'Direct ({direct_len:.0f} km)')
ax.plot(routing_lon[start[1]], routing_lat[start[0]], 'g*',
        markersize=20, label='Cape Town')
ax.plot(routing_lon[goal[1]], routing_lat[goal[0]], 'r*',
        markersize=20, label='Maitri')
ax.plot(76.19, -69.41, 'bs', markersize=10, label='Bharati')

ax.set_xlabel('Longitude')
ax.set_ylabel('Latitude')
ax.set_title('Cape Town -> Maitri  (2026-01-06, Day 1) — offshore goal, no bridge')
plt.colorbar(im, ax=ax, label='SIC')
ax.legend(loc='upper right')
plt.tight_layout()
plt.savefig('backend/plots/route_validation_5b.png', dpi=120)
print('Saved backend/plots/route_validation_5b.png')

route_data = {
    'date': '2026-01-06',
    'start': [float(routing_lat[start[0]]), float(routing_lon[start[1]])],
    'goal': [float(routing_lat[goal[0]]), float(routing_lon[goal[1]])],
    'goal_station': 'Maitri',
    'goal_offshore_km': goals['Maitri']['distance_km'],
    'route_length_km': route_len,
    'direct_length_km': direct_len,
    'length_ratio': route_len / direct_len,
    'max_sic_on_route': max_sic,
    'fraction_in_ice': frac_ice,
    'runtime_bridge': False,
    'waypoints': [[float(routing_lat[i]), float(routing_lon[j])] for i, j in path],
}
with open('backend/cache/route_capetown_maitri_2026-01-06_5b.json', 'w') as f:
    json.dump(route_data, f, indent=2)
print('Saved route JSON')

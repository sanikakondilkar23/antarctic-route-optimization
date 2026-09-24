#!/usr/bin/env python3
"""
gate5_2026.py — GATE 5: final metrics on the 2026 test set.

Reuses eval.py's exact metric functions (miz_rmse_np, compute_iiee) and
eval's conformal-coverage definition, with the frozen 2025 quantiles.
Writes cache/metrics_2026.json and prints the 2025-vs-2026 comparison.

2025 day-1 values are loaded from cache (do not retype). 2025 day-2/day-3
per-horizon values are not stored in cache (2025 eval produced day-1 only);
they are taken from the earlier 3-frame 2025 run quoted in the GATE 5 brief
and flagged as such.

Coverage / IIEE / MIZ RMSE are evaluated on day-1 horizon (h=0), mirroring
the 2025 eval which reported day-1 IIEE and conformal coverage. MIZ RMSE and
persistence are reported for all three horizons.
"""
import json
import os

import numpy as np
import torch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

import sys
sys.path.insert(0, os.path.join(ROOT, "src"))
from eval import miz_rmse_np, compute_iiee  # noqa: E402

TAU = 0.15
REPORT_T = 0.42
N_HORIZONS = 3

# ---------------------------------------------------------------------------
# Load 2026 inputs
# ---------------------------------------------------------------------------
ensemble = np.load("cache/ensemble_2026.npy")          # [N,3,3,H,W]
truth = np.load("cache/true_2026.npy")                  # [N,3,H,W]
valid = np.load("cache/valid_mask.npy")                 # [H,W] bool
lat = np.load("data/processed/lat.npy")                 # [H]
sic_test = np.load("data/test_2026/processed/sic.npy")  # [T,H,W] raw (NaN kept)

N = ensemble.shape[0]
assert N == 167 and truth.shape[0] == N, f"unexpected N={N}"
H, W = valid.shape

valid_f = valid.astype(np.float32)
mask_3d = np.broadcast_to(valid_f[None], (N, 3, H, W))  # [N,3,H,W] metric mask

median = ensemble[:, :, 1, :, :]     # [N,3,H,W] ensemble median
lower = ensemble[:, :, 0, :, :]
upper = ensemble[:, :, 2, :, :]

# ---------------------------------------------------------------------------
# Frozen conformal q90 (2025 calibration; DO NOT recompute)
# ---------------------------------------------------------------------------
with open("cache/metrics_2025.json") as f:
    ref25 = json.load(f)
q90_miz = float(ref25["conformal"]["q90_miz"])     # 0.12617
q90_open = float(ref25["conformal"]["q90_open"])   # 0.00206

# ---------------------------------------------------------------------------
# Per-horizon MIZ RMSE (model median vs persistence)
# ---------------------------------------------------------------------------
# Sample i: inputs = sic[i..i+4], targets = sic[i+5..i+7] (see test_dataset.py).
#  day-1 persistence = observed SIC at i+4
#  day-2 persistence = observed SIC at i+5
#  day-3 persistence = observed SIC at i+6
persist = {
    0: sic_test[4 : N + 4],   # i+4
    1: sic_test[5 : N + 5],   # i+5
    2: sic_test[6 : N + 6],   # i+6
}

per_horizon = {}
for h in range(N_HORIZONS):
    m_rmse = miz_rmse_np(median[:, h], truth[:, h], mask_3d[:, h])
    p_rmse = miz_rmse_np(persist[h], truth[:, h], mask_3d[:, h])
    per_horizon[f"day{h + 1}"] = {
        "miz_rmse_model": m_rmse,
        "miz_rmse_persist": p_rmse,
        "ratio": m_rmse / p_rmse if p_rmse > 0 else float("nan"),
    }

# ---------------------------------------------------------------------------
# IIEE (day-1) at t=0.15 and t=0.42, cosine-latitude weighted
# ---------------------------------------------------------------------------
pred_d1 = torch.from_numpy(median[:, 0:1])   # [N,1,H,W]
y_d1 = truth[:, 0:1]                         # [N,1,H,W]
mask_d1 = mask_3d[:, 0:1]

lat_t = torch.from_numpy(lat).float()
lat_w = torch.cos(torch.deg2rad(lat_t)).view(1, 1, H, 1)


def true_area_weighted(y_np, thr):
    valid_np = (mask_d1 > 0.5) & (~np.isnan(y_np))
    true_bin = (np.nan_to_num(y_np, nan=0.0) > thr).astype(np.float32)
    return float(
        (torch.from_numpy(true_bin) * lat_w * torch.from_numpy(valid_np.astype(np.float32)))
        .sum()
        .item()
    )


iiee = {}
for label, thr in [("t_0.15", TAU), ("t_0.42", REPORT_T)]:
    _, _, _, agg, over_w, under_w = compute_iiee(pred_d1, y_d1, mask_d1, lat, threshold=thr)
    iiee[label] = {
        "aggregate": agg,
        "over": over_w,
        "under": under_w,
        "true_area": true_area_weighted(y_d1, thr),
    }

# ---------------------------------------------------------------------------
# Conformal coverage (day-1), eval-compatible: stratify by TRUTH
# ---------------------------------------------------------------------------
q_strat = np.where(truth[:, 0] > TAU, q90_miz, q90_open)
in_interval = (truth[:, 0] >= median[:, 0] - q_strat) & (truth[:, 0] <= median[:, 0] + q_strat)
cov_valid = mask_d1[:, 0] > 0.5
miz_cells = cov_valid & (truth[:, 0] > TAU)
coverage = {
    "all_valid": float(in_interval[cov_valid].mean()),
    "miz_only": float(in_interval[miz_cells].mean()) if miz_cells.sum() > 0 else 0.0,
}

# ---------------------------------------------------------------------------
# Save metrics_2026.json
# ---------------------------------------------------------------------------
out = {
    "per_horizon": per_horizon,
    "iiee": iiee,
    "coverage": coverage,
    "n_samples": int(N),
    "test_window": "2026-01-01 to 2026-06-23",
}
with open("cache/metrics_2026.json", "w") as f:
    json.dump(out, f, indent=2, default=float)
print(f"Wrote cache/metrics_2026.json")

# ---------------------------------------------------------------------------
# 2025 reference (day-1 from cache; day-2/3 from GATE 5 brief, not in cache)
# ---------------------------------------------------------------------------
ref_3f = json.load(open("cache/metrics_3frame_2025.json"))
ref25_d1_model = float(ref_3f["ensemble_miz_day1"])
ref25_d1_persist = float(ref_3f["persistence_miz_day1"])
ref25_iiee = {
    "t_0.15": float(ref25["iiee_at_0.15"]["aggregate"]),
    "t_0.42": float(ref25["iiee_at_0.42"]["aggregate"]),
}
ref25_under = {
    "t_0.15": int(ref25["iiee_at_0.15"]["under"]),
    "t_0.42": int(ref25["iiee_at_0.42"]["under"]),
}
ref25_cov = (float(ref25["conformal"]["coverage_all"]), float(ref25["conformal"]["coverage_miz"]))

# 2025 day-2/day-3 (task brief, prior uncached 3-frame run):
ref25_d23_model = {1: 0.119, 2: 0.138}
ref25_d23_persist = {1: 0.123, 2: 0.124}

model_2025 = {0: ref25_d1_model, **ref25_d23_model}
persist_2025 = {0: ref25_d1_persist, **ref25_d23_persist}

print()
print("=" * 78)
print("GATE 5 REPORT — 2026 TEST METRICS vs 2025 VALIDATION")
print("=" * 78)
hdr = f"{'Metric':<28}{'2025 (val)':>14}{'2026 (test)':>14}{'Ratio':>9}"
print(hdr)

def row(name, v25, v26):
    r = v26 / v25 if v25 and v25 > 0 else float("nan")
    flag = "  <== >1.5x" if r > 1.5 or r < 1 / 1.5 else ""
    print(f"{name:<28}{v25:>14.4f}{v26:>14.4f}{r:>9.2f}{flag}")

for idx, key in [(0, "day1"), (1, "day2"), (2, "day3")]:
    row(f"MIZ RMSE {key}", model_2025[idx], per_horizon[key]["miz_rmse_model"])
for idx, key in [(0, "day1"), (1, "day2"), (2, "day3")]:
    row(f"Persistence {key}", persist_2025[idx], per_horizon[key]["miz_rmse_persist"])
for idx, key in [(0, "day1"), (1, "day2"), (2, "day3")]:
    r25 = model_2025[idx] / persist_2025[idx]
    row(f"Ratio {key}", r25, per_horizon[key]["ratio"])

row("IIEE @ 0.15 (aggregate)", ref25_iiee["t_0.15"], iiee["t_0.15"]["aggregate"])
row("IIEE @ 0.42 (aggregate)", ref25_iiee["t_0.42"], iiee["t_0.42"]["aggregate"])
print(f"{'Under @ 0.15 (weighted)':<28}{ref25_under['t_0.15']:>14,}{iiee['t_0.15']['under']:>14,}")
print(f"{'Under @ 0.42 (weighted)':<28}{ref25_under['t_0.42']:>14,}{iiee['t_0.42']['under']:>14,}")
row("Coverage (conformal)", ref25_cov[0], coverage["all_valid"])
row("Coverage (MIZ)", ref25_cov[1], coverage["miz_only"])

print()
print("Unless annotated '<== >1.5x', 2026 is within 1.5x of 2025 in both directions.")
print("2025 day-2/day-3 rows are task-brief references (prior 3-frame run, not cached);\n"
      "2025 day-1, IIEE, under, coverage are loaded from cache/metrics_2025.json and\n"
      "cache/metrics_3frame_2025.json.")
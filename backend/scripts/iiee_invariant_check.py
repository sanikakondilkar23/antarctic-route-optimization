"""
Corrected IIEE diagnostic: valid_mask applied, true_bin fixed at 0.15,
pred threshold varies independently. Four-row comparison.
"""
import os

import numpy as np
import torch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAU_TRUE = 0.15

pred_day1 = np.load(os.path.join(ROOT, 'cache', 'ensemble_3frame_2025_day1.npy'))
true_raw = np.load(os.path.join(ROOT, 'plots', 'true.npy'))
lat = np.load(os.path.join(ROOT, 'data', 'processed', 'lat.npy'))
train_sic = np.load(os.path.join(ROOT, 'data', 'processed', 'sic.npy'))

if true_raw.ndim == 4:
    true_day1 = true_raw[:, 0]
else:
    true_day1 = true_raw

valid_mask = np.any(~np.isnan(train_sic), axis=0)  # [H, W]

lat_t = torch.from_numpy(lat).float()
w = torch.cos(torch.deg2rad(lat_t)).view(1, -1, 1)  # [1, H, 1]

# true values
true_buggy = np.nan_to_num(true_day1, nan=0.0)
true_fixed = np.where(valid_mask[None, :, :], true_day1, np.nan)
true_fixed_clean = np.nan_to_num(true_fixed, nan=0.0)

buggy_mask = np.ones_like(true_day1, dtype=bool)
fixed_mask = np.broadcast_to(valid_mask[None, :, :], true_day1.shape)


def compute_iiee(pred, true_clean, mask_2d, t_pred, t_true, w):
    """Aggregate IIEE: sum over all valid cells, divide by true_area.
    true_bin uses t_true (fixed), pred_bin uses t_pred (varies)."""
    v = torch.from_numpy(np.array(mask_2d)).float()
    p = torch.from_numpy(pred).float()
    t = torch.from_numpy(true_clean).float()

    valid = (v > 0.5)
    true_bin = ((t > t_true) & valid).float()
    pred_bin = ((p > t_pred) & valid).float()

    over = ((pred_bin > true_bin).float() * w * v).sum().item()
    under = ((pred_bin < true_bin).float() * w * v).sum().item()
    true_area = (true_bin * w).sum().item()
    total = over + under

    iiee_agg = total / max(true_area, 1e-6)

    # per-sample
    diff = (pred_bin - true_bin).abs() * w * v
    over_ps = ((pred_bin > true_bin).float() * w * v)
    under_ps = ((pred_bin < true_bin).float() * w * v)
    ta_per = (true_bin * w).sum(dim=[-2, -1]).clamp(min=1e-6)
    total_per = diff.sum(dim=[-2, -1])
    over_per = over_ps.sum(dim=[-2, -1])
    under_per = under_ps.sum(dim=[-2, -1])
    iiee_ps = (total_per / ta_per).mean().item()

    return {
        'over': over, 'under': under, 'true_area': true_area,
        'iiee_agg': iiee_agg, 'iiee_ps': iiee_ps,
    }


print("=" * 80)
print("IIEE COMPARISON: buggy mask vs fixed mask")
print("true_bin = (true > 0.15) in ALL cases; pred threshold varies")
print("=" * 80)
print()

for t_pred in [0.15, 0.42]:
    r_buggy = compute_iiee(pred_day1, true_buggy, buggy_mask, t_pred, TAU_TRUE, w)
    r_fixed = compute_iiee(pred_day1, true_fixed_clean, fixed_mask, t_pred, TAU_TRUE, w)

    print(f"--- Pred threshold = {t_pred} ---")
    print(f"  {'':>12} | {'over':>14} | {'under':>14} | {'true_area':>14} | {'iiee_agg':>10} | {'iiee_ps':>10}")
    print(f"  {'-' * 82}")
    print(f"  {'buggy':>12} | {r_buggy['over']:>14.1f} | {r_buggy['under']:>14.1f} | {r_buggy['true_area']:>14.1f} | {r_buggy['iiee_agg']:>10.5f} | {r_buggy['iiee_ps']:>10.5f}")
    print(f"  {'fixed':>12} | {r_fixed['over']:>14.1f} | {r_fixed['under']:>14.1f} | {r_fixed['true_area']:>14.1f} | {r_fixed['iiee_agg']:>10.5f} | {r_fixed['iiee_ps']:>10.5f}")
    print()

# ── INVARIANT CHECKS ───────────────────────────────────────────────────
print("=" * 80)
print("INVARIANT CHECKS")
print("=" * 80)

# 1: true_area identical across buggy/fixed for same threshold
for t_pred in [0.15, 0.42]:
    rb = compute_iiee(pred_day1, true_buggy, buggy_mask, t_pred, TAU_TRUE, w)
    rf = compute_iiee(pred_day1, true_fixed_clean, fixed_mask, t_pred, TAU_TRUE, w)
    ok = abs(rb['true_area'] - rf['true_area']) < 1.0
    print(f"  @ {t_pred}: true_area buggy={rb['true_area']:.1f} fixed={rf['true_area']:.1f}  -> {'PASS' if ok else 'FAIL'}")

# 2: over should DROP from buggy to fixed
for t_pred in [0.15, 0.42]:
    rb = compute_iiee(pred_day1, true_buggy, buggy_mask, t_pred, TAU_TRUE, w)
    rf = compute_iiee(pred_day1, true_fixed_clean, fixed_mask, t_pred, TAU_TRUE, w)
    ok = rf['over'] <= rb['over'] + 1.0
    print(f"  @ {t_pred}: over buggy={rb['over']:.1f} fixed={rf['over']:.1f}  -> {'PASS' if ok else 'FAIL'}")

# 3: IIEE should DROP from buggy to fixed
for t_pred in [0.15, 0.42]:
    rb = compute_iiee(pred_day1, true_buggy, buggy_mask, t_pred, TAU_TRUE, w)
    rf = compute_iiee(pred_day1, true_fixed_clean, fixed_mask, t_pred, TAU_TRUE, w)
    ok = rf['iiee_agg'] <= rb['iiee_agg'] + 0.01
    print(f"  @ {t_pred}: iiee buggy={rb['iiee_agg']:.5f} fixed={rf['iiee_agg']:.5f}  -> {'PASS' if ok else 'FAIL'}")

# 4: denominator stable between @0.15 and @0.42
r015 = compute_iiee(pred_day1, true_fixed_clean, fixed_mask, 0.15, TAU_TRUE, w)
r042 = compute_iiee(pred_day1, true_fixed_clean, fixed_mask, 0.42, TAU_TRUE, w)
ok = abs(r015['true_area'] - r042['true_area']) < 0.1
print(f"  denominator stable: ta_015={r015['true_area']:.1f} ta_042={r042['true_area']:.1f}  -> {'PASS' if ok else 'FAIL'}")

# 5: cells reclaimed
buggy_open = (true_buggy < 0.01) & buggy_mask
fixed_open = (true_fixed_clean < 0.01) & fixed_mask
cells_reclaimed = buggy_open.sum() - fixed_open.sum()
print(f"\n  Cells reclaimed by mask fix: {cells_reclaimed:,}")

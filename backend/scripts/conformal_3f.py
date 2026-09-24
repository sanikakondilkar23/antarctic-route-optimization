"""
Conformal calibration on the 3-frame model using cached predictions.
Also computes proper per-sample IIEE and summary metrics.
"""
import json
import os

import numpy as np
import torch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAU = 0.15

pred_day1 = np.load(os.path.join(ROOT, 'cache', 'ensemble_3frame_2025_day1.npy'))
unc_raw = np.load(os.path.join(ROOT, 'cache', 'ensemble_3frame_2025_full.npy'))  # not std, this is mean
true_raw = np.load(os.path.join(ROOT, 'plots', 'true.npy'))
dates_raw = np.load(os.path.join(ROOT, 'plots', 'dates.npy'))
lat = np.load(os.path.join(ROOT, 'data', 'processed', 'lat.npy'))

true_day1 = true_raw[:, 0] if true_raw.ndim == 4 else true_raw
mask = ~np.isnan(true_day1)
true_day1_clean = np.nan_to_num(true_day1, nan=0.0)

N = pred_day1.shape[0]
print(f"Samples: {N}, pred shape: {pred_day1.shape}, true shape: {true_day1.shape}")

# ---- Persistence ----
sic_mean = float(np.load(os.path.join(ROOT, 'data', 'processed', 'sic_mean.npy')))
sic_std = float(np.load(os.path.join(ROOT, 'data', 'processed', 'sic_std.npy')))

# We don't have the raw input here, but we can compute persistence from the true data
# Actually, persistence = last observed SIC = true at the previous day
# For day-1 target, persistence is the last day of the input window
# We need to load the full SIC to compute this properly
sic_all = np.load(os.path.join(ROOT, 'data', 'processed', 'sic.npy'))  # [T, H, W]
times_all = np.load(os.path.join(ROOT, 'data', 'processed', 'time.npy'))
train_end = np.datetime64('2024-12-31', 'ns')
val_mask = times_all > train_end
sic_val = sic_all[val_mask]  # [365, H, W]
# persistence: for sample i, use sic from day i (day before first target)
# with lookback=5, sample i's target starts at i+5
# persistence = last day of input = sic[i+4], target = sic[i+5]
# But we need to be careful: dataset.__getitem__ uses sic[idx:idx+lookback] for input
# and sic[idx+lookback] for target. So persistence = sic[idx+lookback-1].
# For val split, idx ranges from 0 to T_val-lookback-N_TARGETS
# persistence for sample i = sic_val[i + lookback - 1] = sic_val[i + 4]
# target for sample i = sic_val[i + lookback] = sic_val[i + 5]
# So persistence[sample i] = sic_val[i+4]
# target[sample i] = sic_val[i+5]

# Actually, let me just compute MIZ RMSE for persistence
lat_t = torch.from_numpy(lat).float()
lat_weights = torch.cos(torch.deg2rad(lat_t)).view(1, -1, 1)

# For persistence, use the raw SIC from the day before each target
# We need N samples from val, offset by lookback
LOOKBACK = 5
persistence_day1 = sic_val[LOOKBACK-1:LOOKBACK-1+N]  # [N, H, W] raw SIC

# MIZ RMSE
def miz_rmse(pred, target, valid_mask):
    m = valid_mask & (target > TAU) & (target < 0.85)
    if not m.any():
        return float('nan')
    return float(np.sqrt(((pred - target)**2 * m).sum() / m.sum()))

ens_miz = miz_rmse(pred_day1, true_day1_clean, mask)
persist_miz = miz_rmse(persistence_day1, true_day1_clean, mask)
ratio = ens_miz / persist_miz

print(f"\n  Ensemble MIZ RMSE (day-1): {ens_miz:.5f}")
print(f"  Persistence MIZ RMSE:      {persist_miz:.5f}")
print(f"  Ratio vs persistence:      {ratio:.3f}")

# ---- Per-sample IIEE (eval.py format) ----
pred_t = torch.from_numpy(pred_day1)
true_t = torch.from_numpy(true_day1_clean)

pred_bin = (pred_t > TAU).float()
true_bin = (true_t > TAU).float()

diff = (pred_bin - true_bin).abs() * lat_weights
over = ((pred_bin > true_bin).float()) * lat_weights
under = ((pred_bin < true_bin).float()) * lat_weights
true_area = (true_bin * lat_weights).sum(dim=[-2, -1]).clamp(min=1e-6)

total_per = diff.sum(dim=[-2, -1])
over_per = over.sum(dim=[-2, -1])
under_per = under.sum(dim=[-2, -1])

iiee_total = (total_per / true_area).mean().item()
iiee_over = (over_per / true_area).mean().item()
iiee_under = (under_per / true_area).mean().item()

print(f"\n  IIEE total (tau=0.15): {iiee_total:.5f}")
print(f"  IIEE over:              {iiee_over:.5f}")
print(f"  IIEE under:             {iiee_under:.5f}")

# ---- Conformal calibration ----
cal_mask = dates_raw < np.datetime64("2025-07-01")
test_mask = ~cal_mask

print(f"\n  Cal samples: {cal_mask.sum()}, Test samples: {test_mask.sum()}")

cal_true = true_day1_clean[cal_mask]
cal_pred = pred_day1[cal_mask]
cal_mask_valid = mask[cal_mask] > 0.5
cal_residuals = np.abs(cal_true - cal_pred)

miz_cal = cal_mask_valid & (cal_true > TAU)
open_cal = cal_mask_valid & (cal_true <= TAU)

q90_miz = float(np.percentile(cal_residuals[miz_cal], 90)) if miz_cal.sum() > 0 else 0.0
q90_open = float(np.percentile(cal_residuals[open_cal], 90)) if open_cal.sum() > 0 else 0.0

test_true = true_day1_clean[test_mask]
test_pred = pred_day1[test_mask]
test_mask_valid = mask[test_mask] > 0.5

miz_test = test_mask_valid & (test_true > TAU)
open_test = test_mask_valid & (test_true <= TAU)

test_miz_mask = test_true > TAU
q90_stratified = np.where(test_miz_mask, q90_miz, q90_open)
lower_conf = test_pred - q90_stratified
upper_conf = test_pred + q90_stratified

in_interval = (test_true >= lower_conf) & (test_true <= upper_conf)

cov_all = float(in_interval[test_mask_valid].mean()) if test_mask_valid.sum() > 0 else 0.0
cov_miz = float(in_interval[miz_test].mean()) if miz_test.sum() > 0 else 0.0
cov_open = float(in_interval[open_test].mean()) if open_test.sum() > 0 else 0.0

width_miz = float(2 * q90_miz)
width_open = float(2 * q90_open)

print(f"\n  Conformal calibration (3-frame):")
print(f"    q90_miz:              {q90_miz:.5f}")
print(f"    q90_open:             {q90_open:.5f}")
print(f"    Coverage all:         {cov_all:.4f}  (target 0.88-0.92)")
print(f"    Coverage MIZ:         {cov_miz:.4f}  (target 0.88-0.92)")
print(f"    Coverage open:        {cov_open:.4f}  (target 0.88-0.92)")
print(f"    Width MIZ:            {width_miz:.5f}")
print(f"    Width open:           {width_open:.5f}")

# ---- Save updated metrics ----
metrics = {
    "model": "3-frame (10ch, 3-output head)",
    "ensemble_miz_day1": ens_miz,
    "persistence_miz_day1": persist_miz,
    "ratio_vs_persistence": ratio,
    "iiee_weighted": {
        "total": iiee_total,
        "over": iiee_over,
        "under": iiee_under,
        "method": "cosine-latitude-weighted, per-sample normalized",
        "threshold": TAU,
    },
    "conformal": {
        "q90_miz": q90_miz,
        "q90_open": q90_open,
        "coverage_all": cov_all,
        "coverage_miz": cov_miz,
        "coverage_open": cov_open,
        "width_miz": width_miz,
        "width_open": width_open,
        "cal_samples": int(cal_mask.sum()),
        "test_samples": int(test_mask.sum()),
    },
}

with open(os.path.join(ROOT, "cache", "metrics_3frame_2025.json"), "w") as f:
    json.dump(metrics, f, indent=2, default=float)

print(f"\n  Saved: cache/metrics_3frame_2025.json")

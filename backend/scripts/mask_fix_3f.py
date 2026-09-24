"""
Mask-fix diagnostic: applies train_valid mask to eval, recomputes all metrics.
Steps 2-8 of the mask-fix plan.
"""
import json
import os

import numpy as np
import torch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TAU = 0.15

# ── Load data ──────────────────────────────────────────────────────────
pred_day1 = np.load(os.path.join(ROOT, 'cache', 'ensemble_3frame_2025_day1.npy'))
true_raw = np.load(os.path.join(ROOT, 'plots', 'true.npy'))
lat = np.load(os.path.join(ROOT, 'data', 'processed', 'lat.npy'))
sic_all = np.load(os.path.join(ROOT, 'data', 'processed', 'sic.npy'))        # [T, H, W] raw SIC, NaN where no data
train_sic = sic_all

if true_raw.ndim == 4:
    true_day1 = true_raw[:, 0]
else:
    true_day1 = true_raw

# ── STEP 2: Build train_valid mask and apply ──────────────────────────
train_valid = np.any(~np.isnan(train_sic), axis=0)   # [H, W]
print(f"STEP 2 — Mask fix applied")
print(f"  train valid cells: {train_valid.sum()} / {train_valid.size}")
print(f"  masked-out cells:  {(~train_valid).sum()}")

# Apply mask: cells not valid in training become NaN in eval true
eval_true_masked = np.where(train_valid[None, :, :], true_day1, np.nan)
mask = ~np.isnan(eval_true_masked)

print(f"  eval cells after mask: {mask.sum()} / {mask.size * mask.shape[0] if mask.ndim > 2 else mask.size}")

# ── STEP 3: 1D latitude FP rate (corrected) ──────────────────────────
print(f"\n{'='*70}")
print("STEP 3 — 1D latitude FP rate (mask-corrected)")
print(f"{'='*70}")

fp = ((pred_day1 > TAU) & (eval_true_masked < 0.01) & mask)
open_ocean = ((eval_true_masked < 0.01) & mask)

print(f"{'lat_center':>10} | {'n_open':>10} | {'n_fp':>10} | {'fp_rate':>8}")
print("-" * 55)
for i in range(0, len(lat), 4):
    hi = min(i + 4, len(lat))
    band_fp = fp[:, i:hi, :].sum()
    band_total = open_ocean[:, i:hi, :].sum()
    if band_total > 0:
        print(f"{lat[i:hi].mean():>10.2f} | {band_total:>10,} | {band_fp:>10,} | {band_fp/band_total:>8.4f}")
    else:
        print(f"{lat[i:hi].mean():>10.2f} | {'0':>10} | {'0':>10} | {'N/A':>8}")

# ── STEP 4: IIEE at t=0.15 and t=0.42 ────────────────────────────────
print(f"\n{'='*70}")
print("STEP 4 — IIEE (mask-corrected)")
print(f"{'='*70}")

pred_t = torch.from_numpy(pred_day1)
true_t = torch.from_numpy(np.nan_to_num(eval_true_masked, nan=0.0))
lat_t = torch.from_numpy(lat).float()
lat_weights = torch.cos(torch.deg2rad(lat_t)).view(1, -1, 1)

for t_val in [0.15, 0.42]:
    pred_bin = (pred_t > t_val).float()
    true_bin = (true_t > t_val).float()

    diff = (pred_bin - true_bin).abs() * lat_weights
    over = ((pred_bin > true_bin).float()) * lat_weights
    under = ((pred_bin < true_bin).float()) * lat_weights
    true_area = (true_bin * lat_weights).sum(dim=[-2, -1]).clamp(min=1e-6)

    total_per = diff.sum(dim=[-2, -1])
    over_per = over.sum(dim=[-2, -1])
    under_per = under.sum(dim=[-2, -1])

    iiee = (total_per / true_area).mean().item()
    iiee_o = (over_per / true_area).mean().item()
    iiee_u = (under_per / true_area).mean().item()
    print(f"  IIEE @ t={t_val:.2f}: total={iiee:.5f}  over={iiee_o:.5f}  under={iiee_u:.5f}")

# ── STEP 5: Reliability diagram (corrected) ───────────────────────────
print(f"\n{'='*70}")
print("STEP 5 — Reliability diagram (mask-corrected)")
print(f"{'='*70}")

true_clean = np.nan_to_num(eval_true_masked, nan=0.0)
print(f"{'true_SIC_bin':>14} | {'n_cells':>10} | {'mean_pred':>10} | {'p10':>8} | {'p90':>8}")
print("-" * 70)
bins = [0.0, 0.05, 0.15, 0.30, 0.50, 0.70, 0.90, 1.01]
for i in range(len(bins) - 1):
    lo, hi = bins[i], bins[i+1]
    bm = (true_clean >= lo) & (true_clean < hi) & mask
    if bm.sum() == 0:
        continue
    p = pred_day1[bm]
    print(f"{lo:.2f}-{hi:.2f}      | {bm.sum():>10,} | "
          f"{p.mean():>10.4f} | {np.percentile(p,10):>8.4f} | "
          f"{np.percentile(p,90):>8.4f}")

open_ocean_masked = (true_clean < 0.01) & mask
if open_ocean_masked.sum() > 0:
    p = pred_day1[open_ocean_masked]
    print()
    print("=== Open ocean (true SIC < 0.01, mask-corrected) ===")
    print(f"  Count:           {open_ocean_masked.sum():,}")
    print(f"  Mean pred:       {p.mean():.4f}")
    print(f"  Median pred:     {np.median(p):.4f}")
    print(f"  p90 pred:        {np.percentile(p, 90):.4f}")
    print(f"  p99 pred:        {np.percentile(p, 99):.4f}")
    print(f"  Fraction > 0.15: {(p > 0.15).mean()*100:.2f}%")
    print(f"  Fraction > 0.30: {(p > 0.30).mean()*100:.2f}%")

# ── STEP 6: Conformal calibration (corrected) ─────────────────────────
print(f"\n{'='*70}")
print("STEP 6 — Conformal calibration (mask-corrected)")
print(f"{'='*70}")

dates = np.load(os.path.join(ROOT, 'plots', 'dates.npy'))
cal_mask = dates < np.datetime64("2025-07-01")
test_mask = ~cal_mask

print(f"  Cal samples: {cal_mask.sum()}, Test samples: {test_mask.sum()}")

cal_true = true_clean[cal_mask]
cal_pred = pred_day1[cal_mask]
cal_valid = mask[cal_mask]
cal_residuals = np.abs(cal_true - cal_pred)

miz_cal = cal_valid & (cal_true > TAU)
open_cal = cal_valid & (cal_true <= TAU)

q90_miz = float(np.percentile(cal_residuals[miz_cal], 90)) if miz_cal.sum() > 0 else 0.0
q90_open = float(np.percentile(cal_residuals[open_cal], 90)) if open_cal.sum() > 0 else 0.0

test_true = true_clean[test_mask]
test_pred = pred_day1[test_mask]
test_valid = mask[test_mask]

miz_test = test_valid & (test_true > TAU)
open_test = test_valid & (test_true <= TAU)

test_miz_mask = test_true > TAU
q90_stratified = np.where(test_miz_mask, q90_miz, q90_open)
lower_conf = test_pred - q90_stratified
upper_conf = test_pred + q90_stratified

in_interval = (test_true >= lower_conf) & (test_true <= upper_conf)

cov_all = float(in_interval[test_valid].mean()) if test_valid.sum() > 0 else 0.0
cov_miz = float(in_interval[miz_test].mean()) if miz_test.sum() > 0 else 0.0
cov_open = float(in_interval[open_test].mean()) if open_test.sum() > 0 else 0.0

width_miz = float(2 * q90_miz)
width_open = float(2 * q90_open)

print(f"  q90_miz:              {q90_miz:.5f}")
print(f"  q90_open:             {q90_open:.5f}")
print(f"  Coverage all:         {cov_all:.4f}  (target 0.88-0.92)")
print(f"  Coverage MIZ:         {cov_miz:.4f}  (target 0.88-0.92)")
print(f"  Coverage open:        {cov_open:.4f}  (target 0.88-0.92)")
print(f"  Width MIZ:            {width_miz:.5f}")
print(f"  Width open:           {width_open:.5f}")

# ── STEP 7: Residual FP population ────────────────────────────────────
print(f"\n{'='*70}")
print("STEP 7 — Residual FP population (mask-corrected)")
print(f"{'='*70}")

fp_corrected = ((pred_day1 > TAU) & (true_clean < 0.01) & mask)
print(f"  Total FP cells:  {fp_corrected.sum():,}")
print(f"  FP rate:         {fp_corrected.sum() / max(open_ocean_masked.sum(), 1):.4f}")

print(f"\n  Spatial distribution of residual FPs:")
print(f"  {'lat_center':>10} | {'n_open':>10} | {'n_fp':>10} | {'fp_rate':>8}")
print(f"  " + "-" * 55)
for i in range(0, len(lat), 4):
    hi = min(i + 4, len(lat))
    band_fp = fp_corrected[:, i:hi, :].sum()
    band_total = open_ocean_masked[:, i:hi, :].sum()
    if band_total > 0 and band_fp > 0:
        print(f"  {lat[i:hi].mean():>10.2f} | {band_total:>10,} | {band_fp:>10,} | {band_fp/band_total:>8.4f}")

# ── MIZ RMSE (corrected) ─────────────────────────────────────────────
true_for_rmse = np.nan_to_num(eval_true_masked, nan=0.0)
valid_for_rmse = mask & (true_for_rmse > TAU) & (true_for_rmse < 0.85)
if valid_for_rmse.any():
    diff_rmse = pred_day1 - true_for_rmse
    ens_miz = float(np.sqrt((diff_rmse ** 2 * valid_for_rmse).sum() / valid_for_rmse.sum()))
else:
    ens_miz = float('nan')

# Persistence
sic_mean = float(np.load(os.path.join(ROOT, 'data', 'processed', 'sic_mean.npy')))
sic_std_val = float(np.load(os.path.join(ROOT, 'data', 'processed', 'sic_std.npy')))
sic_val = sic_all[np.load(os.path.join(ROOT, 'data', 'processed', 'time.npy')) > np.datetime64('2024-12-31', 'ns')]
LOOKBACK = 5
N = pred_day1.shape[0]
persist_day1 = sic_val[LOOKBACK-1:LOOKBACK-1+N]
persist_masked = np.where(train_valid[None, :, :], persist_day1, np.nan)
persist_clean = np.nan_to_num(persist_masked, nan=0.0)
valid_persist = mask & (persist_clean > TAU) & (persist_clean < 0.85)
if valid_persist.any():
    diff_p = persist_clean - true_for_rmse
    persist_miz = float(np.sqrt((diff_p ** 2 * valid_persist).sum() / valid_persist.sum()))
else:
    persist_miz = float('nan')
ratio = ens_miz / persist_miz if persist_miz > 0 and not np.isnan(persist_miz) else float('nan')

print(f"\n{'='*70}")
print("Additional metrics (mask-corrected)")
print(f"{'='*70}")
print(f"  MIZ RMSE day-1:   {ens_miz:.5f}")
print(f"  Persistence RMSE: {persist_miz:.5f}")
print(f"  Ratio:            {ratio:.3f}")

# ── STEP 8: Save updated metrics ──────────────────────────────────────
metrics = {
    "model": "3-frame (10ch, 3-output head), mask-corrected",
    "mask_fix": "train_valid applied (9963 cells masked out)",
    "ensemble_miz_day1": ens_miz,
    "persistence_miz_day1": persist_miz,
    "ratio_vs_persistence": ratio,
    "iiee_weighted": {},
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
    "reliability_open_ocean": {},
}

for t_val in [0.15, 0.42]:
    pred_bin = (pred_t > t_val).float()
    true_bin = (true_t > t_val).float()
    diff = (pred_bin - true_bin).abs() * lat_weights
    over = ((pred_bin > true_bin).float()) * lat_weights
    under = ((pred_bin < true_bin).float()) * lat_weights
    true_area = (true_bin * lat_weights).sum(dim=[-2, -1]).clamp(min=1e-6)
    total_per = diff.sum(dim=[-2, -1])
    over_per = over.sum(dim=[-2, -1])
    under_per = under.sum(dim=[-2, -1])
    iiee = (total_per / true_area).mean().item()
    iiee_o = (over_per / true_area).mean().item()
    iiee_u = (under_per / true_area).mean().item()
    metrics["iiee_weighted"][f"t{t_val}"] = {
        "total": iiee, "over": iiee_o, "under": iiee_u
    }

if open_ocean_masked.sum() > 0:
    p_oo = pred_day1[open_ocean_masked]
    metrics["reliability_open_ocean"] = {
        "count": int(open_ocean_masked.sum()),
        "mean_pred": float(p_oo.mean()),
        "median_pred": float(np.median(p_oo)),
        "p90_pred": float(np.percentile(p_oo, 90)),
        "fraction_gt_015": float((p_oo > 0.15).mean()),
        "fraction_gt_030": float((p_oo > 0.30).mean()),
    }

with open(os.path.join(ROOT, "cache", "metrics_3frame_2025.json"), "w") as f:
    json.dump(metrics, f, indent=2, default=float)

print(f"\n  Saved: cache/metrics_3frame_2025.json")

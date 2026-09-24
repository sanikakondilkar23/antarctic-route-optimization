#!/usr/bin/env python3
"""
Compute per-date metrics (MIZ RMSE, coverage, IIEE@0.42) for the PolarPath viewer.
Writes frontend/data/metrics.json keyed by date string.

Coverage is per-date forecast-interval coverage using the STRATIFIED CONFORMAL
intervals (q90_miz / q90_open) loaded from cache/metrics_2025.json, exactly as
eval.py computes it for the 2025 test set. MIZ RMSE uses eval's definition
(valid & actual in (0.15, 0.85)).

Usage:
    python scripts/gen_metrics.py              # 2025 validation (plots/*.npy)
    python scripts/gen_metrics.py --test2026   # 2026 test (cache/*_2026.npy)
"""
import argparse
import json
import os

import numpy as np
import torch

parser = argparse.ArgumentParser()
parser.add_argument("--test2026", action="store_true",
                    help="Compute per-date metrics for the 2026 test set.")
args = parser.parse_args()

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(ROOT, "..", "frontend")
OUT = os.path.join(FRONTEND_DIR, "data", "metrics.json")
N_DATES = 30
MIZ_THRESH = 0.15
IIEE_THRESH = 0.42

lat = np.load(os.path.join(ROOT, "data", "processed", "lat.npy"))
lon = np.load(os.path.join(ROOT, "data", "processed", "lon.npy"))

if args.test2026:
    true_sic = np.load(os.path.join(ROOT, "cache", "true_2026.npy"))
    # [167,1,H,W] so pred_sic[i, 0] matches the [N,1,H,W] convention below.
    pred_sic = np.load(os.path.join(ROOT, "cache", "ensemble_2026.npy"))[:, 0, 1][:, None]
    dates = np.load(os.path.join(ROOT, "cache", "dates_2026.npy"))
    # true_2026 is NaN->0 filled on land; exclude via the static valid mask.
    valid_mask = np.load(os.path.join(ROOT, "cache", "valid_mask.npy"))
else:
    true_sic = np.load(os.path.join(ROOT, "plots", "true.npy"))
    pred_sic = np.load(os.path.join(ROOT, "plots", "pred.npy"))
    dates = np.load(os.path.join(ROOT, "plots", "dates.npy"))
    valid_mask = None

# Load precomputed conformal calibration (same quantiles eval.py writes).
with open(os.path.join(ROOT, "cache", "metrics_2025.json")) as f:
    ref = json.load(f)
conformal = ref.get("conformal", {})
q90_miz = float(conformal.get("q90_miz", 0.0))
q90_open = float(conformal.get("q90_open", 0.0))
print(f"Conformal q90_miz={q90_miz:.5f} q90_open={q90_open:.5f}")

if args.test2026:
    # Must match prep_frontend_data.py --test2026 exactly (same date keys).
    indices = np.linspace(0, len(dates) - 1, N_DATES).astype(int)
else:
    indices = np.round(np.linspace(0, len(dates) - 1, N_DATES)).astype(int)
selected = [str(dates[i])[:10] for i in indices]

# Approximate cell area in km^2 using spherical approx
R = 6371.0
d_lat = np.radians(abs(lat[1] - lat[0]))
d_lon = np.radians(abs(lon[1] - lon[0]))
area_2d = (R * d_lat) * (R * d_lon * np.cos(np.radians(lat)))[:, None]
area_2d = np.broadcast_to(area_2d, (len(lat), len(lon)))
total_area = float(np.nansum(area_2d))

metrics = {}
for date_idx, date_str in zip(indices, selected):
    actual = true_sic[date_idx, 0]
    predicted = pred_sic[date_idx, 0]

    if args.test2026:
        valid = valid_mask
    else:
        valid = ~np.isnan(actual)  # eval-compatible valid_mask (excludes land/ice shelf)
    miz = valid & (actual >= MIZ_THRESH) & (actual < 0.85)
    if miz.sum() > 0:
        miz_rmse = float(np.sqrt(np.nanmean((actual[miz] - predicted[miz]) ** 2)))
    else:
        miz_rmse = float(np.sqrt(np.nanmean((actual[valid] - predicted[valid]) ** 2)))

    # Stratified conformal interval, exactly as eval.py (test_miz_mask = truth > TAU)
    q_stratified = np.where(actual > MIZ_THRESH, q90_miz, q90_open)
    in_interval = valid & (np.abs(actual - predicted) <= q_stratified)
    coverage = float(in_interval.sum() / valid.sum()) if valid.sum() > 0 else 0.0

    ice_actual = valid & (actual >= IIEE_THRESH)
    ice_pred = valid & (predicted >= IIEE_THRESH)
    mismatch_area = float(np.nansum(area_2d[(ice_actual != ice_pred) & valid]))
    iiee = mismatch_area / total_area if total_area > 0 else 0.0

    metrics[date_str] = {
        "miz_rmse": round(miz_rmse, 4),
        "coverage": round(coverage, 4),
        "iiee": round(iiee, 4),
    }

if args.test2026:
    # Per-horizon aggregate metrics for the Horizon selector (full 167-sample
    # test set), using eval.py's exact functions and the frozen 2025 quantiles —
    # identical to gate5_2026.py for day-1.
    import sys
    sys.path.insert(0, os.path.join(ROOT, "src"))
    from eval import miz_rmse_np, compute_iiee

    sum_ens = np.load(os.path.join(ROOT, "cache", "ensemble_2026.npy"))
    sum_true = np.load(os.path.join(ROOT, "cache", "true_2026.npy"))
    sum_v = np.load(os.path.join(ROOT, "cache", "valid_mask.npy"))
    N = sum_ens.shape[0]
    Hw, Ww = sum_v.shape
    sum_mask = np.broadcast_to(sum_v.astype(np.float32)[None], (N, 3, Hw, Ww))
    sum_median = sum_ens[:, :, 1, :, :]

    horizon_metrics = {}
    for h in range(3):
        med_h = sum_median[:, h]
        tru_h = sum_true[:, h]
        msk_h = sum_mask[:, h].astype(bool)

        miz = miz_rmse_np(med_h, tru_h, sum_mask[:, h])

        q_strat = np.where(tru_h > MIZ_THRESH, q90_miz, q90_open)
        in_int = (tru_h >= med_h - q_strat) & (tru_h <= med_h + q_strat)
        cov_cells = msk_h
        miz_cells = cov_cells & (tru_h > MIZ_THRESH)
        cov_all = float(in_int[cov_cells].mean())
        cov_miz = float(in_int[miz_cells].mean()) if miz_cells.sum() > 0 else 0.0

        _, _, _, iiee_agg, _, _ = compute_iiee(
            torch.from_numpy(med_h[:, None, :, :].copy()),
            tru_h[:, None, :, :],
            sum_mask[:, h][:, None], lat, threshold=IIEE_THRESH,
        )

        horizon_metrics[f"day{h + 1}"] = {
            "miz_rmse": round(float(miz), 4),
            "coverage": round(float(cov_all), 4),
            "coverage_miz": round(float(cov_miz), 4),
            "iiee": round(float(iiee_agg), 4),
        }

    HOUT = os.path.join(FRONTEND_DIR, "data", "horizon_metrics.json")
    with open(os.path.join(ROOT, "cache", "metrics_2025.json")) as f:
        _ref25 = json.load(f)
    _conf = _ref25.get("conformal", {})
    horizon_metrics["conformal"] = {
        "q90_miz": float(_conf.get("q90_miz", 0.12617)),
        "q90_open": float(_conf.get("q90_open", 0.00206)),
    }
    _ct_path = os.path.join(FRONTEND_DIR, "data", "confidence_thresholds.json")
    if os.path.exists(_ct_path):
        with open(_ct_path) as f:
            _ct = json.load(f)
        horizon_metrics["confidence_bins"] = {
            "high_threshold": _ct["p33"],
            "low_threshold": _ct["p66"],
            "uncertainty_vmax": 0.0197,
            "note": "ice-cell quantiles (p33/p66 of combined_std where predicted SIC > 0.15)",
            "source": _ct.get("source", ""),
            "n_ice_cells": _ct.get("n_ice_cells"),
        }
    else:
        print("WARNING: frontend/data/confidence_thresholds.json missing; "
              "skip confidence_bins (run prep_frontend_data.py --test2026 first).")
    with open(HOUT, "w") as f:
        json.dump(horizon_metrics, f)
    print(f"Wrote {HOUT}: {json.dumps(horizon_metrics, indent=2)}")

with open(OUT, "w") as f:
    json.dump(metrics, f)
print(f"Wrote {OUT} for {len(metrics)} dates")
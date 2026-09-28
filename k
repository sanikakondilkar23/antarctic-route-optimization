"""
inference_2026.py — GATE 4 inference on 2026 unseen test data.

3-seed ConvLSTM ensemble, 20 MC Dropout passes per model per sample,
stratified conformal intervals (frozen from 2025 calibration).

Optimized for CPU: accumulate MC passes as tensors, convert once per model.
Pre-loads all data to avoid DataLoader overhead.
"""

import json
import os
import sys
import time

import numpy as np
import torch
import torch.nn as nn

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))
from model import ConvLSTMForecaster
from test_dataset import TestDataset

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CHECKPOINT_PATHS = [
    os.path.join(ROOT, "runs", "final_10ch_3f_seed0", "best_model.pt"),
    os.path.join(ROOT, "runs", "final_10ch_3f_seed1", "best_model.pt"),
    os.path.join(ROOT, "runs", "final_10ch_3f_seed2", "best_model.pt"),
]
N_MC_PASSES = 20
BATCH_SIZE = 8
CACHE_DIR = os.path.join(ROOT, "cache")
PLOT_DIR = os.path.join(ROOT, "plots")

CLASS_HIGH = 0
CLASS_MEDIUM = 1
CLASS_LOW = 2
CLASS_MASKED = 255


def enable_dropout_only(model):
    """Set model to eval mode, then re-enable Dropout layers only."""
    model.eval()
    for m in model.modules():
        if isinstance(m, (nn.Dropout, nn.Dropout2d, nn.Dropout1d)):
            m.train()


def main():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")

    # ------------------------------------------------------------------
    # 1. Verify test dataloader and pre-load all data
    # ------------------------------------------------------------------
    test_ds = TestDataset()
    N_samples = len(test_ds)
    assert N_samples == 167, f"Expected 167 samples, got {N_samples}"
    H, W = test_ds.H, test_ds.W
    print(f"Test samples: {N_samples}, grid: {H}x{W}")

    # Pre-load all data into a single tensor (avoid DataLoader overhead)
    all_x = torch.zeros(N_samples, 5, 10, H, W, dtype=torch.float32)
    all_y = torch.zeros(N_samples, 3, H, W, dtype=torch.float32)
    all_dates = np.zeros(N_samples, dtype="datetime64[ns]")
    for i in range(N_samples):
        x, y, _ = test_ds[i]
        all_x[i] = x
        all_y[i] = y
        all_dates[i] = test_ds.date_of(i)
    print(f"Pre-loaded all {N_samples} samples into memory")

    # ------------------------------------------------------------------
    # 2. Verify checkpoints
    # ------------------------------------------------------------------
    for path in CHECKPOINT_PATHS:
        assert os.path.exists(path), f"Checkpoint missing: {path}"
    print(f"All {len(CHECKPOINT_PATHS)} checkpoints found")

    # ------------------------------------------------------------------
    # 3. Compute and cache valid mask
    # ------------------------------------------------------------------
    train_sic = np.load(os.path.join(ROOT, "data", "processed", "sic.npy"))
    valid_mask = np.any(~np.isnan(train_sic), axis=0)
    os.makedirs(CACHE_DIR, exist_ok=True)
    np.save(os.path.join(CACHE_DIR, "valid_mask.npy"), valid_mask)
    print(f"Valid mask: {valid_mask.sum()} cells")

    # ------------------------------------------------------------------
    # 4. Load conformal quantiles (frozen from 2025)
    # ------------------------------------------------------------------
    with open(os.path.join(CACHE_DIR, "metrics_2025.json")) as f:
        metrics_2025 = json.load(f)
    q90_miz = metrics_2025["conformal"]["q90_miz"]
    q90_open = metrics_2025["conformal"]["q90_open"]
    print(f"q90_miz={q90_miz:.5f}, q90_open={q90_open:.5f}")

    # ------------------------------------------------------------------
    # 5. Load models
    # ------------------------------------------------------------------
    models = []
    for seed_idx, ckpt_path in enumerate(CHECKPOINT_PATHS):
        model = ConvLSTMForecaster()
        state = torch.load(ckpt_path, map_location=device)
        model.load_state_dict(state)
        model.to(device)
        enable_dropout_only(model)
        models.append(model)
        print(f"Loaded seed {seed_idx}: {ckpt_path}")

    # ------------------------------------------------------------------
    # 6. Allocate output arrays
    # ------------------------------------------------------------------
    N_horizons = 3
    ensemble_2026 = np.zeros((N_samples, N_horizons, 3, H, W), dtype=np.float32)
    uncertainty_2026 = np.zeros((N_samples, N_horizons, H, W), dtype=np.float32)
    confidence_class_2026 = np.zeros((N_samples, N_horizons, H, W), dtype=np.uint8)
    dates_2026 = all_dates.copy()
    true_2026 = all_y.numpy().copy()

    # ------------------------------------------------------------------
    # 7. Inference loop — process all 3 seeds per batch together
    # ------------------------------------------------------------------
    sample_idx = 0
    t_start = time.time()
    n_batches = (N_samples + BATCH_SIZE - 1) // BATCH_SIZE

    with torch.no_grad():
        for batch_start in range(0, N_samples, BATCH_SIZE):
            batch_end = min(batch_start + BATCH_SIZE, N_samples)
            B = batch_end - batch_start
            x_dev = all_x[batch_start:batch_end].to(device)

            # Per-model MC predictions — accumulate as tensors
            per_model_mc = []  # list of [N_MC, B, 3, H, W] tensors

            for model in models:
                enable_dropout_only(model)
                mc_passes = []
                for _ in range(N_MC_PASSES):
                    pred = model(x_dev)  # [B, 3, H, W]
                    mc_passes.append(pred)
                # Stack: [N_MC, B, 3, H, W]
                mc_stack = torch.stack(mc_passes, dim=0)
                per_model_mc.append(mc_stack)

            # Stack across seeds: [3, N_MC, B, 3, H, W]
            all_mc = torch.stack(per_model_mc, dim=0)

            # Convert to numpy once
            all_mc_np = all_mc.cpu().numpy()  # [3, N_MC, B, 3, H, W]

            # Ensemble statistics
            model_means = all_mc_np.mean(axis=1)   # [3, B, 3, H, W]
            model_stds = all_mc_np.std(axis=1)     # [3, B, 3, H, W]
            ens_mean = model_means.mean(axis=0)    # [B, 3, H, W]
            ens_std = model_means.std(axis=0)      # [B, 3, H, W]
            mc_std_avg = model_stds.mean(axis=0)   # [B, 3, H, W]
            combined_std = np.sqrt(ens_std**2 + mc_std_avg**2)

            # Stratified conformal intervals (vectorized)
            q90_grid = np.where(ens_mean > 0.15, q90_miz, q90_open)
            lower_90 = np.clip(ens_mean - q90_grid, 0.0, 1.0)
            upper_90 = np.clip(ens_mean + q90_grid, 0.0, 1.0)

            # Confidence classes (vectorized)
            conf_class = np.full(combined_std.shape, CLASS_MASKED, dtype=np.uint8)
            valid_spatial = valid_mask[np.newaxis, np.newaxis, :, :]
            v = valid_spatial & (combined_std.shape == valid_spatial.shape)
            valid_3d = np.broadcast_to(valid_spatial, combined_std.shape)
            conf_class[valid_3d & (combined_std < 0.05)] = CLASS_HIGH
            conf_class[valid_3d & (combined_std >= 0.05) & (combined_std < 0.10)] = CLASS_MEDIUM
            conf_class[valid_3d & (combined_std >= 0.10)] = CLASS_LOW

            # Store
            s = sample_idx
            e = sample_idx + B
            ensemble_2026[s:e, :, 0, :, :] = lower_90
            ensemble_2026[s:e, :, 1, :, :] = ens_mean
            ensemble_2026[s:e, :, 2, :, :] = upper_90
            uncertainty_2026[s:e] = combined_std
            confidence_class_2026[s:e] = conf_class

            sample_idx += B
            elapsed = time.time() - t_start
            batch_num = (batch_start // BATCH_SIZE) + 1
            est_remaining = elapsed / batch_num * (n_batches - batch_num)
            print(f"  Batch {batch_num}/{n_batches}: {B} samples  "
                  f"({sample_idx}/{N_samples})  "
                  f"elapsed {elapsed:.0f}s  ETA {est_remaining:.0f}s")

    # ------------------------------------------------------------------
    # 8. Save outputs
    # ------------------------------------------------------------------
    os.makedirs(PLOT_DIR, exist_ok=True)

    np.save(os.path.join(CACHE_DIR, "ensemble_2026.npy"), ensemble_2026)
    np.save(os.path.join(CACHE_DIR, "uncertainty_2026.npy"), uncertainty_2026)
    np.save(os.path.join(CACHE_DIR, "confidence_class_2026.npy"), confidence_class_2026)
    np.save(os.path.join(CACHE_DIR, "dates_2026.npy"), dates_2026)
    np.save(os.path.join(CACHE_DIR, "true_2026.npy"), true_2026)
    np.save(os.path.join(PLOT_DIR, "true_2026.npy"), true_2026)

    # ------------------------------------------------------------------
    # 9. Validation
    # ------------------------------------------------------------------
    has_nan_ensemble = bool(np.isnan(ensemble_2026).any())
    has_nan_uncertainty = bool(np.isnan(uncertainty_2026).any())

    ens_mean_arr = ensemble_2026[:, :, 1, :, :]
    ens_min = float(ens_mean_arr.min())
    ens_max = float(ens_mean_arr.max())

    unc_min = float(uncertainty_2026.min())
    unc_max = float(uncertainty_2026.max())

    lower = ensemble_2026[:, :, 0, :, :]
    upper = ensemble_2026[:, :, 2, :, :]
    all_valid_intervals = bool((lower <= upper).all())
    all_in_bounds = bool(((lower >= 0) & (lower <= 1) & (upper >= 0) & (upper <= 1)).all())

    print(f"\nValidation:")
    print(f"  Any NaN in ensemble:     {has_nan_ensemble}")
    print(f"  Any NaN in uncertainty:  {has_nan_uncertainty}")
    print(f"  Ensemble mean range:     [{ens_min:.4f}, {ens_max:.4f}]")
    print(f"  Uncertainty range:       [{unc_min:.6f}, {unc_max:.6f}]")
    print(f"  Interval validity:       {all_valid_intervals}")
    print(f"  Bounds check [0,1]:      {all_in_bounds}")

    if has_nan_ensemble or has_nan_uncertainty:
        print("STOP: NaN detected.")
        sys.exit(1)
    if not all_valid_intervals:
        print("STOP: lower > upper detected.")
        sys.exit(1)
    if not all_in_bounds:
        print("STOP: bounds outside [0, 1].")
        sys.exit(1)

    # ------------------------------------------------------------------
    # 10. GATE 4 REPORT
    # ------------------------------------------------------------------
    total_time = time.time() - t_start
    print("\n" + "=" * 60)
    print("GATE 4 REPORT — INFERENCE COMPLETE")
    print("=" * 60)
    print(f"Inference samples:        {N_samples}")
    print(f"Test window:              2026-01-01 to 2026-06-23 (174 days)")
    print(f"MC passes per model:      {N_MC_PASSES}")
    print(f"Ensemble seeds:           {len(CHECKPOINT_PATHS)}")
    print(f"Total forward passes:     {N_samples * N_MC_PASSES * len(CHECKPOINT_PATHS)}")
    print(f"Wall time:                {total_time:.0f}s ({total_time/60:.1f} min)")
    print(f"\nOutput files:")
    for name in ["ensemble_2026.npy", "uncertainty_2026.npy",
                 "confidence_class_2026.npy", "dates_2026.npy", "true_2026.npy"]:
        path = os.path.join(CACHE_DIR, name)
        sz = os.path.getsize(path) / 1e6
        print(f"  cache/{name:<35s} {sz:8.2f} MB")
    for name in ["true_2026.npy"]:
        path = os.path.join(PLOT_DIR, name)
        sz = os.path.getsize(path) / 1e6
        print(f"  plots/{name:<35s} {sz:8.2f} MB")
    print(f"  cache/valid_mask.npy              "
          f"{os.path.getsize(os.path.join(CACHE_DIR, 'valid_mask.npy')) / 1e6:8.2f} MB")
    print(f"\nAny NaN in ensemble:      {has_nan_ensemble}")
    print(f"Any NaN in uncertainty:   {has_nan_uncertainty}")
    print(f"Ensemble mean range:      [{ens_min:.4f}, {ens_max:.4f}]")
    print(f"Uncertainty range:        [{unc_min:.6f}, {unc_max:.6f}]")
    print(f"Interval validity:        {all_valid_intervals}")
    print(f"Bounds check:             {all_in_bounds}")
    print("=" * 60)
    print("STATUS: READY FOR GATE 5")
    print("=" * 60)


if __name__ == "__main__":
    main()

"""
IIEE threshold sweep diagnostic for the 3-frame model.

Loads 3-frame checkpoints (head=3 outputs), runs MC Dropout (20 passes)
on the 2025 validation set, saves ensemble predictions, then sweeps
decision thresholds to find the optimal IIEE.
"""
import os
import sys
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))
from dataset import SICDataset
from model import ConvLSTMForecaster

TAU = 0.15
N_PASSES = 20
CHECKPOINTS = [
    os.path.join(ROOT, "runs", "final_10ch_3f_seed0", "best_model.pt"),
    os.path.join(ROOT, "runs", "final_10ch_3f_seed1", "best_model.pt"),
    os.path.join(ROOT, "runs", "final_10ch_3f_seed2", "best_model.pt"),
]


def make_3f_model():
    m = ConvLSTMForecaster()
    m.head = nn.Conv2d(64, 3, kernel_size=1)
    return m


def enable_dropout_only(model):
    model.eval()
    for m in model.modules():
        if isinstance(m, (nn.Dropout, nn.Dropout2d, nn.Dropout1d)):
            m.train()


def load_models():
    models = []
    for path in CHECKPOINTS:
        if not os.path.exists(path):
            print(f"  SKIP (missing): {path}")
            continue
        m = make_3f_model()
        sd = torch.load(path, map_location="cpu", weights_only=False)
        m.load_state_dict(sd)
        models.append(m)
        print(f"  loaded: {path}")
    return models


@torch.no_grad()
def predict_ensemble(models, x, n_passes=N_PASSES):
    """MC Dropout ensemble: returns ens_mean [B,3,H,W], combined_std [B,3,H,W]."""
    all_samples = []
    for model in models:
        enable_dropout_only(model)
        samples = []
        for _ in range(n_passes):
            samples.append(model(x))
        all_samples.append(torch.stack(samples, dim=0))  # [P, B, 3, H, W]
    all_samples = torch.cat(all_samples, dim=0)  # [P*n_models, B, 3, H, W]
    ens_mean = all_samples.mean(dim=0)
    ens_std = all_samples.std(dim=0)
    return ens_mean, ens_std


def main():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print("=== Loading 3-frame models ===")
    models = load_models()
    for m in models:
        m.to(device).eval()
    print(f"  {len(models)} models loaded\n")

    print("=== Running MC Dropout inference ===")
    ds = SICDataset(split="val")
    loader = DataLoader(ds, batch_size=4, shuffle=False)

    lat = np.load(os.path.join(ROOT, "data", "processed", "lat.npy"))
    sic_mean = float(np.load(os.path.join(ROOT, "data", "processed", "sic_mean.npy")))
    sic_std = float(np.load(os.path.join(ROOT, "data", "processed", "sic_std.npy")))

    ens_all, std_all, y_all, persist_all = [], [], [], []
    for bi, (x, y, mask) in enumerate(loader):
        if bi % 20 == 0:
            print(f"  batch {bi}/{len(loader)}")
        x = x.to(device)
        ens_mean, ens_std = predict_ensemble(models, x)
        ens_all.append(ens_mean.cpu().numpy())
        std_all.append(ens_std.cpu().numpy())
        y_all.append(y.numpy())
        sic_last = x[:, -1, 0].cpu().numpy() * sic_std + sic_mean
        persist_all.append(sic_last[:, None, :, :])

    N = sum(a.shape[0] for a in ens_all)
    ens_np = np.concatenate(ens_all, axis=0)[:N]   # [N, 3, H, W]
    std_np = np.concatenate(std_all, axis=0)[:N]
    y_np = np.concatenate(y_all, axis=0)[:N]       # [N, 1, H, W]
    persist_np = np.concatenate(persist_all, axis=0)[:N]

    print(f"\n  Ensemble shape: {ens_np.shape}")
    print(f"  y shape: {y_np.shape}")
    print(f"  std shape: {std_np.shape}")

    # Day-1 predictions and ground truth
    pred_day1 = ens_np[:, 0]   # [N, H, W]
    true_day1 = y_np[:, 0]     # [N, H, W]
    mask_day1 = ~np.isnan(true_day1)
    true_day1 = np.nan_to_num(true_day1, nan=0.0)

    lat_weights = np.cos(np.deg2rad(lat)).reshape(1, -1, 1)

    # Persistence day-1
    persist_day1 = persist_np[:, 0]

    # ---- MIZ RMSE for day-1 ----
    def miz_rmse(pred, target):
        valid = mask_day1 & (target > TAU) & (target < 0.85)
        if not valid.any():
            return float("nan")
        diff = pred - target
        return float(np.sqrt((diff ** 2 * valid).sum() / valid.sum()))

    ens_miz = miz_rmse(pred_day1, true_day1)
    persist_miz = miz_rmse(persist_day1, true_day1)
    ratio = ens_miz / persist_miz if persist_miz > 0 else float("nan")

    print(f"\n  Ensemble MIZ RMSE (day-1): {ens_miz:.5f}")
    print(f"  Persistence MIZ RMSE:      {persist_miz:.5f}")
    print(f"  Ratio vs persistence:      {ratio:.3f}")

    # ---- Save ensemble to cache for threshold sweep ----
    # Save in same format as eval.py: [N, 1, 3, H, W] quantiles
    # We only have the mean, so we'll save the mean as the "median"
    # For the threshold sweep we only need pred_day1 anyway
    np.save(os.path.join(ROOT, "cache", "ensemble_3frame_2025_day1.npy"), pred_day1.astype(np.float32))
    np.save(os.path.join(ROOT, "cache", "ensemble_3frame_2025_full.npy"), ens_np.astype(np.float32))

    # ---- Threshold sweep IIEE diagnostic ----
    print("\n=== IIEE THRESHOLD SWEEP ===")
    print(f"{'threshold':>10} | {'IIEE':>8} | {'over':>8} | {'under':>8}")
    print("-" * 46)

    best_iiee = float("inf")
    best_t = None
    true_area = (true_day1 > TAU).astype(float) * lat_weights
    true_area_sum = true_area.sum()
    true_bin_base = (true_day1 > TAU)

    for t in np.arange(0.02, 0.55, 0.01):
        pred_bin = (pred_day1 > t) & mask_day1
        true_bin = true_bin_base & mask_day1

        diff = np.abs(pred_bin.astype(float) - true_bin.astype(float)) * lat_weights
        over = ((pred_bin & ~true_bin).astype(float) * lat_weights).sum()
        under = ((~pred_bin & true_bin).astype(float) * lat_weights).sum()

        iiee = diff.sum() / max(true_area_sum, 1e-6)
        over_norm = over / max(true_area_sum, 1e-6)
        under_norm = under / max(true_area_sum, 1e-6)

        print(f"{t:>10.2f} | {iiee:>8.4f} | {over_norm:>8.4f} | {under_norm:>8.4f}")

        if iiee < best_iiee:
            best_iiee = iiee
            best_t = t

    print("-" * 46)
    print(f"\n  Best threshold: {best_t:.2f}")
    print(f"  Best IIEE:      {best_iiee:.4f}")
    print(f"  IIEE < 1.0?     {'YES — threshold artifact, model is usable' if best_iiee < 1.0 else 'NO — model cannot distinguish ice from ocean'}")

    # ---- Also run the exact user-provided sweep ----
    print("\n=== USER-PROVIDED SWEEP (TAU=0.15 fixed, vary pred threshold) ===")
    print(f"{'threshold':>10} | {'IIEE':>8} | {'over':>8} | {'under':>8}")
    print("-" * 46)
    for t in np.arange(0.05, 0.55, 0.05):
        pred_bin = (pred_day1 > t) & mask_day1
        true_bin = (true_day1 > 0.15) & mask_day1
        diff = np.abs(pred_bin.astype(float) - true_bin.astype(float)) * lat_weights
        over = ((pred_bin & ~true_bin).astype(float) * lat_weights).sum()
        under = ((~pred_bin & true_bin).astype(float) * lat_weights).sum()
        true_area = (true_bin * lat_weights).sum()
        iiee = diff.sum() / max(true_area, 1e-6)
        print(f"{t:>10.2f} | {iiee:>8.4f} | {over/max(true_area,1e-6):>8.4f} | {under/max(true_area,1e-6):>8.4f}")


if __name__ == "__main__":
    main()

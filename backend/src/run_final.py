"""
run_final.py — Clean training run for the final 10ch/3f ConvLSTM model.

Exact config:
    input_channels=10, output_frames=3, lookback=5, batch_size=4,
    AdamW(lr=1e-3, wd=1e-4), CosineAnnealingLR(T_max=100),
    dropout=0.1, EPOCHS=100, PATIENCE=10, early-stop on miz_mean,
    checkpoint lowest miz_mean.

Usage:
    python run_final.py --seed 0
    python run_final.py --seed 1 --out-dir runs/final_10ch_3f_seed1
"""

import argparse
import csv
import json
import os
import time

import numpy as np
import torch
import torch.nn as nn
from torch.optim import AdamW
from torch.optim.lr_scheduler import CosineAnnealingLR
from torch.utils.data import DataLoader

from dataset import SICDataset
from model import ConvLSTMForecaster

EPOCHS = 100
PATIENCE = 10
BATCH_SIZE = 4
LR = 1e-3
WEIGHT_DECAY = 1e-4
T_MAX = 100
TAU = 0.15

HORIZON_WEIGHTS = [3.0, 1.5, 0.5]
HORIZON_WEIGHT_SUM = sum(HORIZON_WEIGHTS)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIC_MEAN = float(np.load(os.path.join(ROOT, "data", "processed", "sic_mean.npy")))
SIC_STD = float(np.load(os.path.join(ROOT, "data", "processed", "sic_std.npy")))


def set_seed(seed: int):
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def masked_mse(pred, target, mask, miz_weight=3.0):
    weight = torch.where(
        (target > TAU) & (target < 0.85), miz_weight, 1.0
    ) * mask
    diff = (pred - target) ** 2 * weight
    return diff.sum() / weight.sum().clamp(min=1)


def total_loss(pred, target, mask):
    L = torch.tensor(0.0, device=pred.device, dtype=pred.dtype)
    for h, w in enumerate(HORIZON_WEIGHTS):
        L = L + w * masked_mse(pred[:, h], target[:, h], mask[:, h])
    return L / HORIZON_WEIGHT_SUM


def miz_rmse(pred, target, mask, threshold=TAU):
    valid = (mask > 0.5) & (target > threshold) & (target < 0.85)
    if valid.sum() == 0:
        return float("nan")
    diff = (pred - target).float()
    return torch.sqrt((diff ** 2 * valid).sum() / valid.sum()).item()


@torch.no_grad()
def evaluate(model, loader, device):
    model.eval()
    total_val_loss = 0.0
    n_batches = 0
    miz_day1, miz_day2, miz_day3 = [], [], []
    per_day1, per_day2, per_day3 = [], [], []

    for x, y, m in loader:
        x = x.to(device)
        pred = model(x)
        loss = total_loss(pred, y.to(device), m.to(device))
        total_val_loss += loss.item()
        n_batches += 1

        sic_last = x[:, -1, 0].cpu() * SIC_STD + SIC_MEAN
        persist_map = torch.stack([sic_last, y[:, 0], y[:, 1]], dim=1)

        miz_day1.append(miz_rmse(pred[:, 0].cpu(), y[:, 0], m[:, 0]))
        miz_day2.append(miz_rmse(pred[:, 1].cpu(), y[:, 1], m[:, 1]))
        miz_day3.append(miz_rmse(pred[:, 2].cpu(), y[:, 2], m[:, 2]))
        per_day1.append(miz_rmse(persist_map[:, 0], y[:, 0], m[:, 0]))
        per_day2.append(miz_rmse(persist_map[:, 1], y[:, 1], m[:, 1]))
        per_day3.append(miz_rmse(persist_map[:, 2], y[:, 2], m[:, 2]))

    d1 = float(np.nanmean(miz_day1))
    d2 = float(np.nanmean(miz_day2))
    d3 = float(np.nanmean(miz_day3))
    return {
        "val_loss": total_val_loss / max(n_batches, 1),
        "miz_day1": d1, "miz_day2": d2, "miz_day3": d3,
        "miz_mean": float(np.mean([d1, d2, d3])),
        "persist_day1": float(np.nanmean(per_day1)),
        "persist_day2": float(np.nanmean(per_day2)),
        "persist_day3": float(np.nanmean(per_day3)),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--out-dir", type=str, default=None)
    args = parser.parse_args()

    out_dir = args.out_dir or os.path.join(ROOT, "runs", f"final_10ch_3f_seed{args.seed}")
    os.makedirs(out_dir, exist_ok=True)

    log_csv = os.path.join(out_dir, "training_log.csv")
    ckpt_path = os.path.join(out_dir, "best_model.pt")
    metrics_path = os.path.join(out_dir, "metrics.json")

    set_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"device={device}  seed={args.seed}  batch={BATCH_SIZE}")
    print(f"out_dir={out_dir}")

    train_ds = SICDataset(split="train")
    val_ds = SICDataset(split="val")
    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=BATCH_SIZE, shuffle=False)

    model = ConvLSTMForecaster().to(device)
    print(f"Model params: {sum(p.numel() for p in model.parameters()):,}")

    optimizer = AdamW(model.parameters(), lr=LR, weight_decay=WEIGHT_DECAY)
    scheduler = CosineAnnealingLR(optimizer, T_max=T_MAX)

    fields = ["epoch", "train_loss", "val_loss",
              "miz_day1", "miz_day2", "miz_day3", "miz_mean",
              "persist_day1", "persist_day2", "persist_day3",
              "lr", "time_s"]
    with open(log_csv, "w", newline="") as f:
        csv.DictWriter(f, fieldnames=fields).writeheader()

    best_miz = float("inf")
    best_epoch = -1
    no_improve = 0
    best_metrics = {}
    t_start = time.time()

    print(f"starting: EPOCHS={EPOCHS} PATIENCE={PATIENCE}")
    for epoch in range(1, EPOCHS + 1):
        ep_start = time.time()
        model.train()
        train_loss = 0.0
        n_batches = 0
        for x, y, m in train_loader:
            x, y, m = x.to(device), y.to(device), m.to(device)
            optimizer.zero_grad()
            pred = model(x)
            loss = total_loss(pred, y, m)
            loss.backward()
            optimizer.step()
            train_loss += loss.item()
            n_batches += 1
        scheduler.step()

        vl = evaluate(model, val_loader, device)
        train_loss /= max(n_batches, 1)
        lr_now = scheduler.get_last_lr()[0]
        wall = time.time() - ep_start

        row = {
            "epoch": epoch,
            "train_loss": f"{train_loss:.6f}",
            "val_loss": f"{vl['val_loss']:.6f}",
            "miz_day1": f"{vl['miz_day1']:.6f}",
            "miz_day2": f"{vl['miz_day2']:.6f}",
            "miz_day3": f"{vl['miz_day3']:.6f}",
            "miz_mean": f"{vl['miz_mean']:.6f}",
            "persist_day1": f"{vl['persist_day1']:.6f}",
            "persist_day2": f"{vl['persist_day2']:.6f}",
            "persist_day3": f"{vl['persist_day3']:.6f}",
            "lr": f"{lr_now:.2e}",
            "time_s": f"{wall:.1f}",
        }
        with open(log_csv, "a", newline="") as f:
            csv.DictWriter(f, fieldnames=row.keys()).writerow(row)

        tag = ""
        if vl["miz_mean"] < best_miz:
            best_miz = vl["miz_mean"]
            best_epoch = epoch
            best_metrics = vl
            no_improve = 0
            torch.save(model.state_dict(), ckpt_path)
            tag = f"  * saved (best={best_miz:.5f})"

        print(
            f"ep {epoch:>3}  train {train_loss:.5f}  val {vl['val_loss']:.5f}"
            f"  MIZ {vl['miz_mean']:.5f}"
            f"  (d1 {vl['miz_day1']:.4f} d2 {vl['miz_day2']:.4f}"
            f" d3 {vl['miz_day3']:.4f})"
            f"  persist {np.mean([vl['persist_day1'], vl['persist_day2'], vl['persist_day3']]):.5f}"
            f"  lr {lr_now:.2e}  {wall:.0f}s{tag}"
        )

        if vl["miz_mean"] >= best_miz:
            no_improve += 1
        if no_improve >= PATIENCE:
            print(f"early stop: no improvement for {PATIENCE} epochs "
                  f"(best epoch {best_epoch}, best MIZ {best_miz:.5f})")
            break

    total_wall = time.time() - t_start
    print(f"\ndone. best miz_mean = {best_miz:.5f} at epoch {best_epoch}, "
          f"total wall {total_wall:.1f}s")

    metrics_out = {
        "best_epoch": best_epoch,
        "val_loss": best_metrics["val_loss"],
        "miz_day1": best_metrics["miz_day1"],
        "miz_day2": best_metrics["miz_day2"],
        "miz_day3": best_metrics["miz_day3"],
        "miz_mean": best_metrics["miz_mean"],
        "persist_day1": best_metrics["persist_day1"],
        "persist_day2": best_metrics["persist_day2"],
        "persist_day3": best_metrics["persist_day3"],
        "ratio_day1": best_metrics["miz_day1"] / best_metrics["persist_day1"],
        "ratio_day2": best_metrics["miz_day2"] / best_metrics["persist_day2"],
        "ratio_day3": best_metrics["miz_day3"] / best_metrics["persist_day3"],
        "total_wall_s": round(total_wall, 1),
    }
    with open(metrics_path, "w") as f:
        json.dump(metrics_out, f, indent=2)
    print(f"saved {metrics_path}")


if __name__ == "__main__":
    main()

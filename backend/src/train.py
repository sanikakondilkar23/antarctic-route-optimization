"""
train.py — Train the 2-layer ConvLSTM SIC forecaster (1-day output).

Loss (MSE + 0.5 * BCE):
    L_mse  = masked_mse(pred, target, mask, miz_weight=3.0)
    L_bce  = binary_cross_entropy(pred_clamped, target_bin, weight=mask)
    total  = L_mse + 0.5 * L_bce

Optimizer / schedule:
    AdamW (lr=1e-3, weight_decay=1e-4), CosineAnnealingLR(T_max=100),
    EPOCHS=100, PATIENCE=10 early stop on val miz_day1.
    Best checkpoint: best_model.pt.

Persistence baseline:
    persist = SIC at day D-1 (last INPUT day, unstandardised).

Usage:
    python train.py --seed 0
    python train.py --debug
"""

import argparse
import csv
import os
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
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
TAU = 0.15  # lower edge of the MIZ band used by masked_mse + metrics

LOG_CSV = "training_log.csv"
CKPT = "best_model.pt"


# ---------------------------------------------------------------------------
# Loss functions
# ---------------------------------------------------------------------------
def masked_mse(pred, target, mask, miz_weight=3.0):
    """Pred-weighted MSE with MIZ up-weight, masked to valid target cells."""
    weight = torch.where(
        (target > TAU) & (target < 0.85), miz_weight, 1.0
    ) * mask
    diff = (pred - target) ** 2 * weight
    return diff.sum() / weight.sum().clamp(min=1)


def combined_loss(pred, target, mask):
    """MSE + 0.5 * BCE for single-frame prediction."""
    L_mse = masked_mse(pred, target, mask, miz_weight=3.0)
    target_bin = (target > TAU).float()
    pred_clamped = pred.clamp(1e-6, 1 - 1e-6)
    bce = F.binary_cross_entropy(pred_clamped, target_bin, weight=mask, reduction='sum')
    bce = bce / mask.sum().clamp(min=1)
    return L_mse + 0.5 * bce


# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------
def miz_rmse(pred, target, mask, threshold=TAU):
    """Pooled RMSE over valid MIZ pixels (target in (tau, 0.85))."""
    valid = (mask > 0.5) & (target > threshold) & (target < 0.85)
    if valid.sum() == 0:
        return float("nan")
    diff = (pred - target).float()
    return torch.sqrt((diff ** 2 * valid).sum() / valid.sum()).item()


@torch.no_grad()
def evaluate(model, loader, device):
    """Full-validation metrics (feeds early-stop on miz_day1)."""
    model.eval()
    total_val_loss = 0.0
    n_batches = 0
    miz_vals = []
    persist_vals = []
    for x, y, m in loader:
        x = x.to(device)
        pred = model(x)  # [B, 1, H, W]
        loss = combined_loss(pred, y.to(pred.device), m.to(pred.device))
        total_val_loss += loss.item()
        n_batches += 1

        sic_last = x[:, -1, 0].cpu() * SIC_STD + SIC_MEAN  # [B, H, W]
        miz_vals.append(miz_rmse(pred[:, 0].cpu(), y[:, 0], m[:, 0]))
        persist_vals.append(miz_rmse(sic_last, y[:, 0], m[:, 0]))

    miz_d1 = float(np.nanmean(miz_vals))
    per_d1 = float(np.nanmean(persist_vals))
    return {
        "val_loss": total_val_loss / max(n_batches, 1),
        "miz_day1": miz_d1,
        "persist_day1": per_d1,
    }


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SIC_MEAN = float(np.load(os.path.join(ROOT, "data", "processed", "sic_mean.npy")))
SIC_STD = float(np.load(os.path.join(ROOT, "data", "processed", "sic_std.npy")))


def set_seed(seed: int):
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def debug_dry_run(model, loader, device):
    """CHECK 4 — one forward+backward on a single batch, then exit."""
    model.train()
    x, y, m = next(iter(loader))
    x, y, m = x.to(device), y.to(device), m.to(device)

    torch.cuda.reset_peak_memory_stats()
    pred = model(x)
    loss = combined_loss(pred, y, m)
    loss.backward()

    grads_ok = True
    max_grad = 0.0
    for name, p in model.named_parameters():
        if p.grad is None or torch.isnan(p.grad).any():
            grads_ok = False
            print(f"[debug] problem param: {name} grad None/NaN")
        if p.grad is not None:
            max_grad = max(max_grad, p.grad.abs().max().item())

    peak_gb = torch.cuda.max_memory_allocated() / 1e9

    print("=== CHECK 4 — train dry-run (1 batch, 1 step) ===")
    print(f"  batch:      {tuple(x.shape)}")
    print(f"  loss:       {loss.item():.6f}")
    print(f"  grads OK:   {grads_ok}   (max |grad| = {max_grad:.3e})")
    print(f"  peak VRAM:  {peak_gb:.3f} GB  (< 6 GB required)")
    print(f"  result:     {'PASS' if grads_ok and peak_gb < 6.0 else 'FAIL'}")


def main():
    parser = argparse.ArgumentParser(description="Train ConvLSTM SIC forecaster")
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE)
    parser.add_argument("--max-epochs", type=int, default=None,
                        help="cap the number of epochs (default: EPOCHS)")
    parser.add_argument("--debug", action="store_true",
                        help="run ONE forward+backward pass on a single "
                             "batch, report loss/grads/VRAM, then exit")
    args = parser.parse_args()

    set_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"device={device}  seed={args.seed}  batch={args.batch_size}")

    train_ds = SICDataset(split="train")
    val_ds = SICDataset(split="val")
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False)

    model = ConvLSTMForecaster().to(device)
    print(f"Model params: {sum(p.numel() for p in model.parameters()):,}")

    optimizer = AdamW(model.parameters(), lr=LR, weight_decay=WEIGHT_DECAY)
    scheduler = CosineAnnealingLR(optimizer, T_max=T_MAX)

    if args.debug:
        debug_dry_run(model, train_loader, device)
        return

    epochs = args.max_epochs if args.max_epochs else EPOCHS

    # fresh log for a new training run
    with open(LOG_CSV, "w", newline="") as f:
        w = csv.DictWriter(
            f,
            fieldnames=["epoch", "train_loss", "val_loss",
                        "miz_day1", "persist_day1",
                        "lr", "time_s"],
        )
        w.writeheader()

    best_miz = float("inf")
    best_epoch = -1
    no_improve = 0
    t_start = time.time()

    print(f"starting training: EPOCHS={epochs} PATIENCE={PATIENCE}")
    for epoch in range(1, epochs + 1):
        epoch_start = time.time()
        model.train()
        train_loss = 0.0
        n_batches = 0
        for x, y, m in train_loader:
            x, y, m = x.to(device), y.to(device), m.to(device)
            optimizer.zero_grad()
            pred = model(x)
            loss = combined_loss(pred, y, m)
            loss.backward()
            optimizer.step()
            train_loss += loss.item()
            n_batches += 1
        scheduler.step()

        vl = evaluate(model, val_loader, device)
        train_loss /= max(n_batches, 1)
        lr_now = scheduler.get_last_lr()[0]

        row = {
            "epoch": epoch,
            "train_loss": f"{train_loss:.6f}",
            "val_loss": f"{vl['val_loss']:.6f}",
            "miz_day1": f"{vl['miz_day1']:.6f}",
            "persist_day1": f"{vl['persist_day1']:.6f}",
            "lr": f"{lr_now:.2e}",
            "time_s": f"{time.time() - epoch_start:.1f}",
        }
        with open(LOG_CSV, "a", newline="") as f:
            csv.DictWriter(f, fieldnames=row.keys()).writerow(row)

        print(
            f"ep {epoch:>3}  train {train_loss:.5f}  val {vl['val_loss']:.5f}"
            f"  MIZ d1 {vl['miz_day1']:.4f}"
            f"  persist {vl['persist_day1']:.4f}"
            f"  lr {lr_now:.2e}"
            f"  {time.time() - epoch_start:.0f}s"
        )

        if vl["miz_day1"] < best_miz:
            best_miz = vl["miz_day1"]
            best_epoch = epoch
            no_improve = 0
            torch.save(model.state_dict(), CKPT)
            print(f"  * saved {CKPT} (MIZ d1={best_miz:.5f}, epoch {epoch})")
        else:
            no_improve += 1

        if no_improve >= PATIENCE:
            print(f"early stop: no improvement for {PATIENCE} epochs "
                  f"(best epoch {best_epoch}, best MIZ d1 {best_miz:.5f})")
            break

    print(f"\ndone. best val MIZ d1 = {best_miz:.5f} at epoch {best_epoch}, "
          f"total wall {time.time() - t_start:.1f}s; log: {LOG_CSV}")


if __name__ == "__main__":
    main()
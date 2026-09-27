#!/usr/bin/env python3
"""
checkpoint_smoke_test.py — prove the SIC model itself is runnable.

WHAT THIS IS
    A plumbing check on the real model code: it loads the three trained
    ConvLSTM checkpoints, runs the exact ensemble + MC-dropout + uncertainty
    math used by ``backend/scripts/inference_2026.py``, and reports the real
    parameter count, tensor shapes and output statistics.

WHAT THIS IS NOT
    It is NOT a forecast. The real 2026 inference inputs
    (``backend/data/test_2026/processed/{sic,forcing,time}.npy``) are absent
    from this checkout, so a forward pass needs a placeholder tensor. Every
    number printed below is therefore a property of the MODEL (shapes,
    parameter counts, sigmoid bounds, ensemble spread), never a statement
    about sea ice. Nothing is written to disk, and no artifact under
    ``backend/cache`` or ``backend/data`` is read or written.

    Use it to answer "does the model load and run?" — not "what is the ice?".
    For a real forecast, restore the raw inputs and run
    ``python backend/scripts/inference_2026.py``.

Run:
    python backend/scripts/checkpoint_smoke_test.py
"""

from __future__ import annotations

import os
import sys

import numpy as np
import torch
import torch.nn as nn

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "src"))
from model import ConvLSTMForecaster  # noqa: E402

CHECKPOINTS = [
    os.path.join(ROOT, "runs", f"final_10ch_3f_seed{s}", "best_model.pt")
    for s in (0, 1, 2)
]
LOOKBACK, N_CHANNELS, N_HORIZONS = 5, 10, 3
H, W = 101, 361
N_MC = 20
SEED = 20260106  # fixed, so repeated runs are identical


def enable_dropout_only(model: nn.Module) -> None:
    """MC Dropout: eval mode everywhere, dropout layers back on."""
    model.eval()
    for m in model.modules():
        if isinstance(m, (nn.Dropout, nn.Dropout2d, nn.Dropout1d)):
            m.train()


def main() -> int:
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    device = torch.device("cpu")

    missing = [p for p in CHECKPOINTS if not os.path.isfile(p)]
    if missing:
        print("FAIL  missing checkpoint(s):")
        for p in missing:
            print(f"        {p}")
        return 1

    print("=" * 68)
    print("SIC ConvLSTM — checkpoint / inference plumbing check")
    print("*** PLACEHOLDER INPUT: the numbers below are NOT a forecast ***")
    print("=" * 68)

    # A placeholder of the right shape. Deliberately not derived from, and not
    # a substitute for, the real 2026 channels.
    x = torch.zeros(1, LOOKBACK, N_CHANNELS, H, W, dtype=torch.float32)

    models = []
    for path in CHECKPOINTS:
        model = ConvLSTMForecaster()
        state = torch.load(path, map_location=device, weights_only=True)
        model.load_state_dict(state)  # strict=True: architecture must match
        model.to(device)
        n_params = sum(p.numel() for p in model.parameters())
        models.append(model)
        print(f"loaded  {os.path.relpath(path, ROOT)}")
        print(f"        params={n_params:,}  state_tensors={len(state)}")

    reference = sum(p.numel() for p in models[0].parameters())
    if any(sum(p.numel() for p in m.parameters()) != reference for m in models):
        print("FAIL  checkpoints disagree on parameter count")
        return 1
    print(f"\narchitecture   ConvLSTMCell(10->32) k3p1 -> ConvLSTMCell(32->64) "
          f"k3p1\n               -> Dropout2d(0.1) -> Conv2d(64->3,k1) + sigmoid")
    print(f"parameters     {reference:,} (README asserts 270,147)")
    if reference != 270147:
        print("FAIL  parameter count does not match the documented 270,147")
        return 1
    print("parameters     OK — matches the documented model")

    # ---- real inference path: 3 seeds x N_MC dropout passes -------------
    with torch.no_grad():
        x_dev = x.to(device)
        per_model_mc = []
        for model in models:
            enable_dropout_only(model)
            passes = [model(x_dev) for _ in range(N_MC)]
            per_model_mc.append(torch.stack(passes, dim=0))
        all_mc = torch.stack(per_model_mc, dim=0).cpu().numpy()

    model_means = all_mc.mean(axis=1)      # [3, B, 3, H, W]
    model_stds = all_mc.std(axis=1)       # [3, B, 3, H, W]
    ens_mean = model_means.mean(axis=0)   # [B, 3, H, W]
    ens_std = model_means.std(axis=0)
    mc_std_avg = model_stds.mean(axis=0)
    combined_std = np.sqrt(ens_std ** 2 + mc_std_avg ** 2)

    print(f"\ninput          {tuple(x.shape)}  (5 days x 10 channels x 101 x 361)")
    print(f"ensemble stack {tuple(all_mc.shape)}  "
          f"(3 seeds x {N_MC} MC passes x B x 3 horizons x 101 x 361)")
    print(f"output         {tuple(ens_mean.shape)}  (B, 3 horizons, H, W)")
    print(f"forward passes {N_MC * len(CHECKPOINTS)}")

    print("\noutput statistics (shape/plumbing only — NOT sea-ice values)")
    print(f"  ensemble mean   min={ens_mean.min():.6f}  max={ens_mean.max():.6f}")
    print(f"  ensemble spread min={combined_std.min():.6f}  max={combined_std.max():.6f}")
    print(f"  mean combined_std (whole tensor) {combined_std.mean():.6f}")
    print(f"  NaNs in output     {bool(np.isnan(ens_mean).any())}")
    print(f"  NaNs in uncertainty{bool(np.isnan(combined_std).any())}")

    in_range = bool(ens_mean.min() >= 0.0 and ens_mean.max() <= 1.0)
    print(f"  sigmoid bound [0,1] {in_range}")
    print(f"  per-horizon mean   "
          f"{[round(float(ens_mean[0, k].mean()), 6) for k in range(N_HORIZONS)]}")
    print(f"  per-seed disagreement (ens_std) mean="
          f"{float(ens_std.mean()):.6f}  -> the 3 seeds are independent models")
    print(f"  MC dropout active  (mc_std_avg) mean="
          f"{float(mc_std_avg.mean()):.6f}  -> dropout is live at inference")

    # ---- what a real run still needs ----------------------------------
    real_inputs = [
        os.path.join(ROOT, "data", "test_2026", "processed", "sic.npy"),
        os.path.join(ROOT, "data", "test_2026", "processed", "forcing.npy"),
        os.path.join(ROOT, "data", "test_2026", "processed", "time.npy"),
        os.path.join(ROOT, "data", "processed", "sic_mean.npy"),
        os.path.join(ROOT, "data", "processed", "sic_std.npy"),
    ]
    print("\n" + "-" * 68)
    print("real forecast requires (all currently ABSENT):")
    for p in real_inputs:
        rel = os.path.relpath(p, ROOT)
        print(f"  [{'x' if os.path.isfile(p) else ' '}] {rel}")
    absent = [p for p in real_inputs if not os.path.isfile(p)]
    if absent:
        print(f"\nVERDICT: model loads and runs; a real forecast is BLOCKED — "
              f"{len(absent)}/{len(real_inputs)} input arrays missing.")
        print("         Restore them, then run: "
              "python backend/scripts/inference_2026.py")
    else:
        print("\nVERDICT: all inputs present — run inference_2026.py for a "
              "real forecast.")
    print("-" * 68)
    return 0 if in_range and not np.isnan(ens_mean).any() else 1


if __name__ == "__main__":
    raise SystemExit(main())

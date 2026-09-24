"""
test_dataset.py — Test dataloader for 2026 unseen evaluation.

Input:  x [5, 10, H, W]  (5 lookback days × 10 channels)
Target: y [3, H, W]       (3 target days, RAW SIC 0..1)
Mask:   [3, H, W]         (1 where valid, 0 where NaN)

Formula: n_samples = T - lookback - n_targets + 1 = T - 8 + 1 = T - 7
With T = 174: 167 samples.
"""

import os

import numpy as np
import torch
from torch.utils.data import Dataset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOOKBACK = 5
N_TARGETS = 3


class TestDataset(Dataset):
    """Sliding-window 3-day-target dataset for 2026 test data."""

    def __init__(self, data_dir: str = "",
                 lookback: int = LOOKBACK):
        super().__init__()
        self.lookback = lookback
        if not data_dir:
            data_dir = os.path.join(ROOT, "data", "test_2026", "processed")

        sic_path = f"{data_dir}/sic.npy"
        forcing_path = f"{data_dir}/forcing.npy"
        time_path = f"{data_dir}/time.npy"

        self.sic = np.load(sic_path)          # [T, H, W]  RAW 0..1
        self.forcing = np.load(forcing_path)  # [T, 9, H, W]  standardized
        self.times = np.load(time_path)       # [T]

        # Load training stats for SIC standardization (TRAINING ONLY)
        self.sic_mean = float(np.load(os.path.join(ROOT, "data", "processed", "sic_mean.npy")))
        self.sic_std = float(np.load(os.path.join(ROOT, "data", "processed", "sic_std.npy")))

        assert self.sic.shape[0] == self.forcing.shape[0] == self.times.shape[0], \
            "Time-dimension mismatch in test processed arrays"
        assert self.forcing.shape[1] == 9, \
            f"Expected 9 forcing channels, found {self.forcing.shape[1]}"

        # ---- CONTIGUITY CHECK (must run BEFORE any window construction) ----
        diffs = np.diff(self.times)
        diffs_days = diffs / np.timedelta64(1, "D")
        is_contiguous = bool(np.all(diffs_days == 1.0))

        print(f"Contiguity check:")
        print(f"  T (total days):        {len(self.times)}")
        print(f"  First date:            {self.times[0]}")
        print(f"  Last date:             {self.times[-1]}")
        print(f"  Unique diff values:    {sorted(set(diffs_days))}")
        print(f"  Contiguous:            {is_contiguous}")

        if not is_contiguous:
            gap_indices = np.where(diffs_days != 1.0)[0]
            print(f"  Gaps found at indices: {gap_indices.tolist()}")
            for i in gap_indices[:5]:
                print(f"    {self.times[i]} -> {self.times[i+1]}  "
                      f"(gap: {diffs_days[i]} days)")
            raise ValueError(
                f"time.npy is not contiguous. Cannot build sliding windows. "
                f"See gaps above."
            )

        self.T = len(self.times)
        self.H, self.W = self.sic.shape[1], self.sic.shape[2]

        expected_samples = self.T - lookback - N_TARGETS + 1
        print(f"  Expected samples:      {expected_samples}  "
              f"(T - {lookback} - {N_TARGETS} + 1 = T - {lookback + N_TARGETS - 1})")
        print(f"  Actual samples:        {len(self)}")
        assert len(self) == expected_samples, \
            f"Sample count mismatch: {len(self)} != {expected_samples}"

    def __len__(self) -> int:
        return max(0, self.T - self.lookback - N_TARGETS + 1)

    def __getitem__(self, idx: int):
        """
        Returns
        -------
        x    : torch.Tensor [5, 10, H, W]
        y    : torch.Tensor [3, H, W]   target SIC raw 0..1 (NaN -> 0)
        mask : torch.Tensor [3, H, W]   (1 = valid, 0 = NaN in target)
        """
        t0 = idx + self.lookback
        assert t0 + N_TARGETS <= self.T

        sic_win = self.sic[idx: idx + self.lookback]          # [5, H, W]
        frc_win = self.forcing[idx: idx + self.lookback]      # [5, 9, H, W]

        # Input SIC standardized with train-period scalars; target stays raw.
        sic_win_std = np.nan_to_num(
            (sic_win - self.sic_mean) / self.sic_std, nan=0.0
        )
        x = np.concatenate(
            [sic_win_std[:, None, :, :], frc_win], axis=1
        ).astype(np.float32)                                   # [5, 10, H, W]
        assert x.shape[1] == 10, f"expected 10 input channels, got {x.shape[1]}"

        y = self.sic[t0: t0 + N_TARGETS].astype(np.float32)    # [3, H, W] raw
        mask = (~np.isnan(y)).astype(np.float32)               # [3, H, W]
        y = np.nan_to_num(y, nan=0.0)

        return (
            torch.from_numpy(x),
            torch.from_numpy(y),
            torch.from_numpy(mask),
        )

    def date_of(self, idx: int) -> np.datetime64:
        """datetime64 of the FIRST target day for dataset sample idx."""
        return self.times[idx + self.lookback]


if __name__ == "__main__":
    ds = TestDataset()
    print(f"\nTestDataset: {len(ds)} samples, "
          f"first target={ds.date_of(0)}, last target={ds.date_of(len(ds)-1)}")
    x, y, m = ds[0]
    print(f"  x: {tuple(x.shape)}  y: {tuple(y.shape)}  mask: {tuple(m.shape)}")
    assert x.shape == (5, 10, ds.H, ds.W)
    assert y.shape == (3, ds.H, ds.W) and m.shape == y.shape
    x2, y2, m2 = ds[len(ds) - 1]
    print(f"  Last sample: x={tuple(x2.shape)}  y={tuple(y2.shape)}")
    print("Dataset check: PASS")

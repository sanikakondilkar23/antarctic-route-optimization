"""
dataset.py — SICDataset for the ConvLSTM SIC forecaster.

Each sample: (x, y, mask)
  x    = [5, 10, H, W]   (5 lookback days x 10 channels:
           0=SIC standardized on the fly with train scalars,
           1..9 = forcing.npy channels)
  y    = [1, H, W]       (1 target day, RAW SIC 0..1, NaN -> 0)
  mask = [1, H, W]       (1 where target SIC is valid, 0 where NaN)

Channel order (identical in preprocess, dataset, model_v2):
    0: SIC                1: u10      2: v10   3: t2m
    4: uo                 5: vo       6: thetao 7: so
    8: zos                9: SIC_prev_year

Timing convention: inputs are days [i, i+lookback); the three targets are
days i+lookback, i+lookback+1, i+lookback+2 (D+1..D+3). No day at-or-after
the first target is ever used as input, so there is NO future leakage.

Split: train = time <= 2024-12-31, val = 2025. Train/val are contiguous and
disjoint by construction (asserted on load).

NaN policy for the INPUT tensor x:
    Every input channel is finite. SIC NaN cells (land / pole hole /
    no-data) are filled with 0 AFTER standardization — the same "no-data ->
    0 (= channel mean post-standardization)" convention used for the CMEMS
    channels. A conv sums its receptive field, so raw NaN would poison the
    output map. The target y keeps its own 3-day mask (NaN -> 0, mask=0),
    which is what excludes no-data locations from the loss and metrics.
"""
import os

import numpy as np
import torch
from torch.utils.data import Dataset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOOKBACK = 5
N_TARGETS = 1


class SICDataset(Dataset):
    """Sliding-window 3-day-target dataset over aligned SIC + forcing."""

    TRAIN_END = "2024-12-31"  # date-based split (no magic index)

    def __init__(self, split: str = "train", lookback: int = LOOKBACK,
                 train_end: str = TRAIN_END):
        super().__init__()
        assert split in ("train", "val")
        self.lookback = lookback
        assert lookback + N_TARGETS > 0

        sic = np.load(os.path.join(ROOT, "data", "processed", "sic.npy"))          # [T, H, W]  RAW 0..1
        forcing = np.load(os.path.join(ROOT, "data", "processed", "forcing.npy"))  # [T, 9, H, W]  standardized
        times = np.load(os.path.join(ROOT, "data", "processed", "time.npy"))       # [T]
        self.sic_mean = float(np.load(os.path.join(ROOT, "data", "processed", "sic_mean.npy")))
        self.sic_std = float(np.load(os.path.join(ROOT, "data", "processed", "sic_std.npy")))
        assert sic.shape[0] == forcing.shape[0] == times.shape[0], \
            "Time-dimension mismatch in data/processed/sic.npy, forcing.npy, time.npy"
        assert forcing.shape[1] == 9, \
            f"Expected 9 forcing channels (GATE 3 spec), found " \
            f"{forcing.shape[1]} — re-run preprocess"

        train_end_ts = np.datetime64(train_end, "ns")
        train_mask = times <= train_end_ts

        if split == "train":
            idx = np.where(train_mask)[0]
        else:  # val
            idx = np.where(~train_mask)[0]

        if idx.size == 0:
            raise ValueError(
                f"[SICDataset] split={split} has no dates for this slice."
            )

        # Disjoint partitions: train is exactly (<= train_end), val is
        # exactly (> train_end) — no overlap by construction, asserted.
        if split == "train":
            assert times[idx].max() <= train_end_ts
        else:
            assert times[idx].min() > train_end_ts

        # Contiguity AND disjoint-partition (no gaps, no overlap):
        # both halves of the timeline must be gapless and adjacent.
        all_idx = np.arange(times.size)
        other = np.setdiff1d(all_idx, idx)
        assert np.array_equal(idx, np.arange(idx[0], idx[-1] + 1)), \
            f"{split} dates not contiguous — check missing days"
        assert np.array_equal(other, np.arange(other[0], other[-1] + 1)), \
            "other split not contiguous (gaps in the timeline)"

        self.sic = sic[idx]
        self.forcing = forcing[idx]
        self.times = times[idx]
        self.T = len(self.times)
        self.H, self.W = self.sic.shape[1], self.sic.shape[2]

        print(
            f"[SICDataset] split={split} samples={len(self)} "
            f"shape=({self.T}, {self.H}, {self.W}) "
            f"dates {self.times[0]} .. {self.times[-1]} "
            f"sic_norm=({self.sic_mean:.4f}, {self.sic_std:.4f})"
        )

    def __len__(self) -> int:
        # targets start at i+lookback and need N_TARGETS days in-bounds
        return max(0, self.T - self.lookback - N_TARGETS + 1)

    def __getitem__(self, idx: int):
        """
        Returns
        -------
        x    : torch.Tensor [5, 10, H, W]
        y    : torch.Tensor [1, H, W]   target SIC raw 0..1 (NaN -> 0)
        mask : torch.Tensor [1, H, W]   (1 = valid, 0 = NaN in target)
        """
        t0 = idx + self.lookback
        assert t0 + N_TARGETS <= self.T

        sic_win = self.sic[idx: idx + self.lookback]          # [5, H, W]
        frc_win = self.forcing[idx: idx + self.lookback]      # [5, 9, H, W]

        # Input SIC standardized with train-period scalars; target stays raw.
        # SIC input NaN -> 0 post-standardization (uniform no-data convention).
        sic_win_std = np.nan_to_num(
            (sic_win - self.sic_mean) / self.sic_std, nan=0.0
        )
        x = np.concatenate(
            [sic_win_std[:, None, :, :], frc_win], axis=1
        ).astype(np.float32)                                   # [5, 10, H, W]
        assert x.shape[1] == 10, f"expected 10 input channels, got {x.shape[1]}"

        y = self.sic[t0: t0 + N_TARGETS].astype(np.float32)    # [1, H, W] raw
        mask = (~np.isnan(y)).astype(np.float32)               # [1, H, W]
        y = np.nan_to_num(y, nan=0.0)
        assert y.shape[0] == 1, f"expected 1 target day, got {y.shape[0]}"
        assert mask.shape[0] == 1, f"expected 1-day mask, got {mask.shape[0]}"

        return (
            torch.from_numpy(x),
            torch.from_numpy(y),
            torch.from_numpy(mask),
        )

    def date_of(self, idx: int) -> np.datetime64:
        """datetime64 of the FIRST target day for dataset sample idx."""
        return self.times[idx + self.lookback]


if __name__ == "__main__":
    tr = SICDataset(split="train")
    va = SICDataset(split="val")
    print("train", len(tr), "val", len(va))
    x, y, m = tr[0]
    print("x", tuple(x.shape), "y", tuple(y.shape), "mask", tuple(m.shape))
    assert x.shape == (5, 10, tr.H, tr.W)
    assert y.shape == (1, tr.H, tr.W) and m.shape == y.shape
    print("date_of(0) =", tr.date_of(0))
    print("Dataset check: PASS")
import os

import numpy as np
import torch

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
pred = np.load(os.path.join(ROOT, 'cache', 'ensemble_3frame_2025_day1.npy'))
true_raw = np.load(os.path.join(ROOT, 'plots', 'true.npy'))
lat = np.load(os.path.join(ROOT, 'data', 'processed', 'lat.npy'))

true_day1 = true_raw[:, 0] if true_raw.ndim == 4 else true_raw
mask = ~np.isnan(true_day1)
true_day1 = np.nan_to_num(true_day1, nan=0.0)

lat_t = torch.from_numpy(lat).float()
lat_weights = torch.cos(torch.deg2rad(lat_t)).view(1, -1, 1)

pred_t = torch.from_numpy(pred)
true_t = torch.from_numpy(true_day1)

print("Per-sample IIEE (eval.py format): varying pred threshold, true fixed at 0.15")
hdr = f"{'threshold':>10} | {'IIEE':>8} | {'over':>8} | {'under':>8}"
print(hdr)
print("-" * 46)

best_iiee = float("inf")
best_t = None

for t_np in np.arange(0.02, 0.56, 0.02):
    t = float(t_np)
    pred_bin = (pred_t > t).float()
    true_bin = (true_t > 0.15).float()

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

    print(f"{t:>10.2f} | {iiee:>8.4f} | {iiee_o:>8.4f} | {iiee_u:>8.4f}")

    if iiee < best_iiee:
        best_iiee = iiee
        best_t = t

print("-" * 46)
print(f"\nBest threshold: {best_t:.2f}")
print(f"Best IIEE:      {best_iiee:.4f}")
print(f"IIEE < 1.0?     {'YES' if best_iiee < 1.0 else 'NO'}")

# Also compute per-sample IIEE at TAU=0.15 for both pred and true (standard eval)
pred_bin_15 = (pred_t > 0.15).float()
true_bin_15 = (true_t > 0.15).float()
diff = (pred_bin_15 - true_bin_15).abs() * lat_weights
over = ((pred_bin_15 > true_bin_15).float()) * lat_weights
under = ((pred_bin_15 < true_bin_15).float()) * lat_weights
true_area = (true_bin_15 * lat_weights).sum(dim=[-2, -1]).clamp(min=1e-6)
total_per = diff.sum(dim=[-2, -1])
over_per = over.sum(dim=[-2, -1])
under_per = under.sum(dim=[-2, -1])
iiee_15 = (total_per / true_area).mean().item()
iiee_o_15 = (over_per / true_area).mean().item()
iiee_u_15 = (under_per / true_area).mean().item()
print(f"\nStandard IIEE (tau=0.15): total={iiee_15:.4f} over={iiee_o_15:.4f} under={iiee_u_15:.4f}")

# Global IIEE at tau=0.15
true_area_global = (true_bin_15 * lat_weights).sum()
diff_global = (pred_bin_15 - true_bin_15).abs() * lat_weights
over_global = ((pred_bin_15 > true_bin_15).float() * lat_weights).sum()
under_global = ((pred_bin_15 < true_bin_15).float() * lat_weights).sum()
iiee_g = (diff_global / true_area_global).item()
print(f"Global IIEE (tau=0.15):   total={iiee_g:.4f}")

# Per-sample IIEE at optimal threshold
pred_bin_opt = (pred_t > best_t).float()
true_bin_opt = (true_t > best_t).float()
diff = (pred_bin_opt - true_bin_opt).abs() * lat_weights
over = ((pred_bin_opt > true_bin_opt).float()) * lat_weights
under = ((pred_bin_opt < true_bin_opt).float()) * lat_weights
true_area = (true_bin_opt * lat_weights).sum(dim=[-2, -1]).clamp(min=1e-6)
total_per = diff.sum(dim=[-2, -1])
over_per = over.sum(dim=[-2, -1])
under_per = under.sum(dim=[-2, -1])
iiee_opt = (total_per / true_area).mean().item()
print(f"Per-sample IIEE at t={best_t:.2f} (same threshold for both): {iiee_opt:.4f}")

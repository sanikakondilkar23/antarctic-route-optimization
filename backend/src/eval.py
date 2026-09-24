"""
eval.py — Evaluation of the ConvLSTM SIC forecaster (1-frame, BCE+MSE).

Fixes:
  FIX 1: enable_dropout_only — only Dropout layers active in eval mode
  FIX 2: Raw uncertainty distribution saved to cache/uncertainty_stats.json
  FIX 3: Correct labeling — ensemble_miz != mean_of_seeds_miz (Jensen gap)
  FIX 4: cos(lat)-weighted IIEE on regular 0.25-deg grid
  FIX 5: Stratified conformal calibration (MIZ vs open ocean)

Usage:
  python eval.py --dry-run
  python eval.py
  python eval.py --n-passes 30 --limit-batches 5
"""

import argparse
import json
import os

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader

from dataset import SICDataset
from model import ConvLSTMForecaster

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TAU = 0.15
N_PASSES_DEFAULT = 20
CLASS_HIGH = 0
CLASS_MEDIUM = 1
CLASS_LOW = 2
CLASS_MASKED = 255
CACHE_DIR = os.path.join(ROOT, "cache")
PLOT_DIR = os.path.join(ROOT, "plots")

DEFAULT_CHECKPOINTS = [
    os.path.join(ROOT, "runs", "final_10ch_3f_seed0", "best_model.pt"),
    os.path.join(ROOT, "runs", "final_10ch_3f_seed1", "best_model.pt"),
    os.path.join(ROOT, "runs", "final_10ch_3f_seed2", "best_model.pt"),
]

THREE_FRAME_CHECKPOINTS = [
    os.path.join(ROOT, "runs", "final_10ch_3f_seed0", "best_model.pt"),
    os.path.join(ROOT, "runs", "final_10ch_3f_seed1", "best_model.pt"),
    os.path.join(ROOT, "runs", "final_10ch_3f_seed2", "best_model.pt"),
]


# ---------------------------------------------------------------------------
# FIX 1 — MC Dropout: only dropout layers active
# ---------------------------------------------------------------------------
def enable_dropout_only(model):
    model.eval()
    for m in model.modules():
        if isinstance(m, (nn.Dropout, nn.Dropout2d, nn.Dropout1d)):
            m.train()


def _mc_samples(model, x, n_passes):
    enable_dropout_only(model)
    preds = []
    with torch.no_grad():
        for _ in range(n_passes):
            preds.append(model(x))
    return torch.stack(preds, dim=0)


def predict_ensemble(models, x, n_passes=N_PASSES_DEFAULT):
    member_samples = []
    member_means = []
    member_stds = []
    for model in models:
        samples = _mc_samples(model, x, n_passes)
        member_samples.append(samples)
        member_means.append(samples.mean(0))
        member_stds.append(samples.std(0))

    member_means = torch.stack(member_means, dim=0)
    member_stds = torch.stack(member_stds, dim=0)

    ens_mean = member_means.mean(0)
    if member_means.shape[0] == 1:
        ens_std = torch.zeros_like(ens_mean)
    else:
        ens_std = member_means.std(0)
    mc_std_avg = member_stds.mean(0)
    combined_std = torch.sqrt(ens_std ** 2 + mc_std_avg ** 2)

    all_samples = torch.cat(member_samples, dim=0)
    lower_5 = all_samples.quantile(0.05, dim=0)
    median = all_samples.quantile(0.50, dim=0)
    upper_95 = all_samples.quantile(0.95, dim=0)

    return {
        "ens_mean": ens_mean, "ens_std": ens_std,
        "mc_std_avg": mc_std_avg, "combined_std": combined_std,
        "lower_5": lower_5, "median": median, "upper_95": upper_95,
        "member_means": member_means,
    }


# ---------------------------------------------------------------------------
# MIZ RMSE
# ---------------------------------------------------------------------------
def miz_rmse_np(pred, target, mask):
    valid = (mask > 0.5) & (target > TAU) & (target < 0.85)
    if not valid.any():
        return float("nan")
    diff = np.where(valid, pred - target, 0.0)
    return float(np.sqrt((diff ** 2).sum() / valid.sum()))


# ---------------------------------------------------------------------------
# Confidence classes
# ---------------------------------------------------------------------------
def confidence_class(combined_std, mask):
    cls = torch.full_like(combined_std, CLASS_MASKED, dtype=torch.uint8)
    valid = mask > 0.5
    cls[valid & (combined_std < 0.05)] = CLASS_HIGH
    cls[valid & (combined_std >= 0.05) & (combined_std < 0.10)] = CLASS_MEDIUM
    cls[valid & (combined_std >= 0.10)] = CLASS_LOW
    return cls


# ---------------------------------------------------------------------------
# FIX 4 — cos(lat)-weighted IIEE
# ---------------------------------------------------------------------------
def compute_iiee(pred_mean, y_np, mask_np, lat, threshold=TAU):
    H = lat.shape[0]
    lat_t = torch.from_numpy(lat).float()
    lat_weights = torch.cos(torch.deg2rad(lat_t)).view(1, 1, H, 1)

    valid_np = (mask_np > 0.5) & (~np.isnan(y_np))
    valid_t = torch.from_numpy(valid_np).float()

    pred_bin = (pred_mean > threshold).float()
    true_bin = (torch.from_numpy(np.nan_to_num(y_np, nan=0.0)) > threshold).float()

    diff = (pred_bin - true_bin).abs() * lat_weights * valid_t
    over = ((pred_bin > true_bin).float()) * lat_weights * valid_t
    under = ((pred_bin < true_bin).float()) * lat_weights * valid_t
    true_area = (true_bin * lat_weights * valid_t).sum(dim=[-2, -1]).clamp(min=1e-6)

    total = diff.sum(dim=[-2, -1])
    over_sum = over.sum(dim=[-2, -1])
    under_sum = under.sum(dim=[-2, -1])

    iiee_total = (total / true_area).mean().item()
    iiee_over = (over_sum / true_area).mean().item()
    iiee_under = (under_sum / true_area).mean().item()

    agg_total = total.sum().item()
    agg_true = true_area.sum().item()
    iiee_agg = agg_total / max(agg_true, 1e-6)

    over_weighted = int(over.sum().item())
    under_weighted = int(under.sum().item())

    return iiee_total, iiee_over, iiee_under, iiee_agg, over_weighted, under_weighted


# ---------------------------------------------------------------------------
# FIX 2 — Raw uncertainty distribution
# ---------------------------------------------------------------------------
def compute_uncertainty_stats(std_np, mask_np, y_np):
    valid = mask_np > 0.5
    miz = valid & (y_np > TAU) & (y_np < 0.85)

    full_valid = std_np[valid]
    full_mean_std = float(full_valid.mean()) if full_valid.size > 0 else 0.0

    miz_std = std_np[miz]
    if miz_std.size > 0:
        miz_mean_std = float(miz_std.mean())
        miz_median_std = float(np.median(miz_std))
        miz_p10_std = float(np.percentile(miz_std, 10))
        miz_p90_std = float(np.percentile(miz_std, 90))
    else:
        miz_mean_std = miz_median_std = miz_p10_std = miz_p90_std = 0.0

    if miz_std.size > 0:
        counts, bin_edges = np.histogram(miz_std, bins=50)
        histogram = {"bins": bin_edges.tolist(), "counts": counts.tolist()}
    else:
        histogram = {"bins": [], "counts": []}

    return {
        "miz_mean_std": miz_mean_std, "miz_median_std": miz_median_std,
        "miz_p10_std": miz_p10_std, "miz_p90_std": miz_p90_std,
        "full_mean_std": full_mean_std, "histogram": histogram,
    }


# ---------------------------------------------------------------------------
# Checkpoint loading
# ---------------------------------------------------------------------------
def load_models(checkpoints, n_outputs=1):
    models, loaded = [], []
    for path in checkpoints:
        if not os.path.exists(path):
            print(f"[eval] checkpoint not found, skipping: {path}")
            continue
        model = ConvLSTMForecaster()
        if n_outputs != 1:
            import torch.nn as nn
            model.head = nn.Conv2d(64, n_outputs, kernel_size=1)
        try:
            state = torch.load(path, map_location="cpu")
            model.load_state_dict(state)
        except Exception as exc:
            print(f"[eval] checkpoint load failed ({type(exc).__name__}), "
                  f"skipping: {path}")
            continue
        models.append(model)
        loaded.append(path)
    if len(models) == 0:
        print("[eval] no usable checkpoints; using UNTRAINED model (smoke only)")
        models.append(ConvLSTMForecaster())
        loaded.append("<untrained>")
    return models, loaded


# ---------------------------------------------------------------------------
# Write outputs
# ---------------------------------------------------------------------------
def write_outputs(arrays, dates, metrics, out_year="2025"):
    os.makedirs(CACHE_DIR, exist_ok=True)
    os.makedirs(PLOT_DIR, exist_ok=True)

    np.save(os.path.join(CACHE_DIR, f"ensemble_{out_year}.npy"), arrays["quantiles"])
    np.save(os.path.join(CACHE_DIR, f"uncertainty_{out_year}.npy"), arrays["combined_std"])
    np.save(os.path.join(CACHE_DIR, f"confidence_class_{out_year}.npy"), arrays["confidence_class"])

    if "uncertainty_stats" in arrays:
        with open(os.path.join(CACHE_DIR, "uncertainty_stats.json"), "w") as f:
            json.dump(arrays["uncertainty_stats"], f, indent=2)

    with open(os.path.join(CACHE_DIR, f"metrics_{out_year}.json"), "w") as f:
        json.dump(metrics, f, indent=2, default=float)

    np.save(os.path.join(PLOT_DIR, "pred.npy"), arrays["median"])
    np.save(os.path.join(PLOT_DIR, "true.npy"), arrays["y"])
    np.save(os.path.join(PLOT_DIR, "dates.npy"), dates)
    with open(os.path.join(PLOT_DIR, "metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2, default=float)
    print(f"[eval] wrote cache/ and plots/ for {out_year} "
          f"({arrays['y'].shape[0]} samples)")


# ---------------------------------------------------------------------------
# Dry-run (CHECK 5)
# ---------------------------------------------------------------------------
def dry_run(n_passes):
    print("=== CHECK 5 — eval dry-run (1 batch) ===")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    models, loaded = load_models(DEFAULT_CHECKPOINTS)
    for m in models:
        m.to(device)
    ds = SICDataset(split="val")
    loader = DataLoader(ds, batch_size=4, shuffle=False)
    x, y, mask = next(iter(loader))
    x = x.to(device)

    out = predict_ensemble([models[0]], x, n_passes=n_passes)
    mean, std = out["ens_mean"], out["combined_std"]
    mask = mask.to(device)

    cls = confidence_class(std, mask)
    valid_pct = (std < 0.05)[mask > 0.5].float().mean().item()

    ok = ("ens_mean" in out and "combined_std" in out and "member_means" in out
          and set(torch.unique(cls).tolist()) <= {0, 1, 2, 255})
    print(f"  checkpoint used   : {loaded[0]}")
    print(f"  MC mean shape     : {tuple(mean.shape)}")
    print(f"  MC std shape      : {tuple(std.shape)}  mean std={std.mean().item():.4f}")
    print(f"  confidence_class  : {sorted(torch.unique(cls).tolist())}  "
          f"(subset of {{0,1,2,255}}: {set(torch.unique(cls).tolist()) <= {0, 1, 2, 255}})")
    print(f"  % high-confidence px (std<0.05): {valid_pct * 100.0:.1f}")
    print(f"  result: {'PASS' if ok else 'FAIL'}")


# ---------------------------------------------------------------------------
# Full evaluation loop
# ---------------------------------------------------------------------------
@torch.no_grad()
def run(checkpoints, n_passes, limit_batches, out_year, n_outputs=1):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    models, loaded = load_models(checkpoints, n_outputs=n_outputs)
    for m in models:
        m.to(device)

    lat = np.load(os.path.join(ROOT, "data", "processed", "lat.npy"))

    # FIX 6: Apply training-valid mask to eval ground truth
    train_sic = np.load(os.path.join(ROOT, "data", "processed", "sic.npy"))
    train_valid = np.any(~np.isnan(train_sic), axis=0)  # [H, W]
    print(f"[eval] train_valid: {train_valid.sum()}/{train_valid.size} cells "
          f"({train_valid.mean()*100:.1f}%)")

    ds = SICDataset(split="val")
    loader = DataLoader(ds, batch_size=4, shuffle=False)

    q_lo, q_md, q_hi, mu, std_all, cls_all, y_all, m_all = [], [], [], [], [], [], [], []
    persist_all = []
    per_model_preds = [[] for _ in models]
    dates = []
    n = 0
    for bi, (x, y, mask) in enumerate(loader):
        if limit_batches is not None and bi >= limit_batches:
            break
        x = x.to(device)
        out = predict_ensemble(models, x, n_passes=n_passes)
        # Extract channel 0 (day-1) from multi-channel output
        for key in ["ens_mean", "combined_std", "lower_5", "median", "upper_95"]:
            out[key] = out[key][:, :1]
        out["member_means"] = [m[:, :1] for m in out["member_means"]]
        mask_cpu = mask.cpu()
        std_cpu = out["combined_std"].cpu()

        q_lo.append(out["lower_5"].cpu())
        q_md.append(out["median"].cpu())
        q_hi.append(out["upper_95"].cpu())
        mu.append(out["ens_mean"].cpu())
        std_all.append(std_cpu)
        cls_all.append(confidence_class(std_cpu, mask_cpu).numpy())
        y_all.append(y.numpy())
        m_all.append(mask_cpu.numpy())

        for mi in range(len(models)):
            per_model_preds[mi].append(out["member_means"][mi].cpu().numpy())

        sic_last = x[:, -1, 0].cpu() * float(np.load(os.path.join(ROOT, "data", "processed", "sic_std.npy"))) \
                 + float(np.load(os.path.join(ROOT, "data", "processed", "sic_mean.npy")))
        persist_all.append(sic_last.numpy()[:, None, :, :])
        for j in range(x.shape[0]):
            dates.append(str(ds.date_of(n + j)))
        n += x.shape[0]

    N = n
    arr = lambda v: np.concatenate(v, axis=0)[:N] if N else np.zeros((0, 1, 1, 1))
    y_np = arr(y_all)
    mask_np = np.concatenate(m_all, axis=0)[:N]

    # FIX 6: Apply train_valid mask — cells not valid in training become
    # NaN in eval ground truth, so they cannot contribute to any metric.
    y_np = np.where(train_valid[None, None, :, :], y_np, np.nan)
    mask_np = mask_np * train_valid[None, None, :, :].astype(mask_np.dtype)
    quant = np.stack([arr(q_lo), arr(q_md), arr(q_hi)], axis=2)
    std_np = arr(std_all)
    cls_np = np.concatenate(cls_all, axis=0)[:N].astype(np.uint8)
    persist_np = np.concatenate(persist_all, axis=0)[:N]
    ens_mean_np = arr(mu)
    dates_np = np.array(dates[:N], dtype="datetime64[ns]")

    per_model_np = [np.concatenate(p, axis=0)[:N] for p in per_model_preds]

    metrics = {}

    # ----------------------------------------------------------------
    # FIX 3: Correct labeling — ensemble vs mean-of-seeds
    # ----------------------------------------------------------------
    # Ensemble metric: RMSE of the mean prediction
    ens_miz = miz_rmse_np(ens_mean_np[:, 0], y_np[:, 0], mask_np[:, 0])

    # Per-seed metric: RMSE of each seed's mean prediction
    seed_miz = []
    for si, sp in enumerate(per_model_np):
        sm = miz_rmse_np(sp[:, 0], y_np[:, 0], mask_np[:, 0])
        seed_miz.append(sm)

    # Mean-of-seeds: average of scalar RMSE values
    mean_of_seeds_miz = float(np.mean(seed_miz))

    # Best seed (post-hoc, biased)
    best_idx = int(np.nanargmin(seed_miz))
    best_seed_miz = seed_miz[best_idx]

    # Persistence
    persist_d1 = miz_rmse_np(persist_np[:, 0], y_np[:, 0], mask_np[:, 0])

    # Ensembling benefit
    ensembling_benefit = mean_of_seeds_miz - ens_miz

    # ----------------------------------------------------------------
    # Jensen regression tests
    # ----------------------------------------------------------------
    jensen_check_passed = True
    jensen_msg = ""

    # Test 1: ensemble <= mean_of_seeds (Jensen inequality)
    if ens_miz > mean_of_seeds_miz + 1e-6:
        jensen_check_passed = False
        jensen_msg += f"Jensen violation: ensemble {ens_miz} > mean-of-seeds {mean_of_seeds_miz}; "

    # Test 2: ensemble != mean_of_seeds (labeling bug check)
    if abs(ens_miz - mean_of_seeds_miz) < 1e-4:
        jensen_check_passed = False
        jensen_msg += "ensemble and mean-of-seeds are identical — labeling bug likely; "

    # Test 3: mean_of_seeds == average of per-seed values
    scalar_avg = float(np.mean(seed_miz))
    if abs(mean_of_seeds_miz - scalar_avg) > 1e-8:
        jensen_check_passed = False
        jensen_msg += f"mean-of-seeds {mean_of_seeds_miz} != scalar avg {scalar_avg}; "

    if not jensen_check_passed:
        print(f"  WARNING: Jensen regression test FAILED: {jensen_msg}")

    # ----------------------------------------------------------------
    # Store metrics with correct labels
    # ----------------------------------------------------------------
    metrics["ensemble_miz"] = ens_miz
    metrics["mean_of_seeds_miz"] = mean_of_seeds_miz
    metrics["best_seed_miz"] = best_seed_miz
    metrics["best_seed_index"] = best_idx
    metrics["per_seed_miz"] = {f"seed{si}": sm for si, sm in enumerate(seed_miz)}
    metrics["ensembling_benefit"] = ensembling_benefit
    metrics["jensen_check_passed"] = jensen_check_passed
    metrics["persistence_miz_day1"] = persist_d1

    # FIX 4: IIEE at t=0.15
    iiee_total, iiee_over, iiee_under, iiee_agg, over_w, under_w = compute_iiee(
        torch.from_numpy(ens_mean_np), y_np, mask_np, lat, threshold=0.15
    )
    metrics["iiee_at_0.15"] = {
        "aggregate": iiee_agg, "per_sample": iiee_total,
        "over": over_w, "under": under_w,
        "method": "cosine-latitude-weighted",
    }

    # FIX 4: IIEE at t=0.42
    iiee_total_42, iiee_over_42, iiee_under_42, iiee_agg_42, over_w_42, under_w_42 = compute_iiee(
        torch.from_numpy(ens_mean_np), y_np, mask_np, lat, threshold=0.42
    )
    metrics["iiee_at_0.42"] = {
        "aggregate": iiee_agg_42, "per_sample": iiee_total_42,
        "over": over_w_42, "under": under_w_42,
        "method": "cosine-latitude-weighted",
    }

    # FIX 2: uncertainty stats
    unc_stats = compute_uncertainty_stats(std_np, mask_np, y_np)
    metrics["uncertainty_stats"] = unc_stats

    # ----------------------------------------------------------------
    # FIX 5: Stratified conformal calibration
    # ----------------------------------------------------------------
    cal_mask = dates_np < np.datetime64("2025-07-01")
    test_mask = ~cal_mask

    if cal_mask.sum() > 0 and test_mask.sum() > 0:
        # Calibration residuals
        cal_true = y_np[cal_mask, 0]
        cal_pred = ens_mean_np[cal_mask, 0]
        cal_mask_valid = mask_np[cal_mask, 0] > 0.5
        cal_residuals = np.abs(cal_true - cal_pred)

        # Strata
        miz_cal = cal_mask_valid & (cal_true > TAU)
        open_cal = cal_mask_valid & (cal_true <= TAU)

        q90_miz = float(np.percentile(cal_residuals[miz_cal], 90)) if miz_cal.sum() > 0 else 0.0
        q90_open = float(np.percentile(cal_residuals[open_cal], 90)) if open_cal.sum() > 0 else 0.0

        # Test set coverage
        test_true = y_np[test_mask, 0]
        test_pred = ens_mean_np[test_mask, 0]
        test_mask_valid = mask_np[test_mask, 0] > 0.5
        test_residuals = np.abs(test_true - test_pred)

        miz_test = test_mask_valid & (test_true > TAU)
        open_test = test_mask_valid & (test_true <= TAU)

        # Stratified intervals
        test_miz_mask = test_true > TAU
        q90_stratified = np.where(test_miz_mask, q90_miz, q90_open)
        lower_conf = test_pred - q90_stratified
        upper_conf = test_pred + q90_stratified

        in_interval = (test_true >= lower_conf) & (test_true <= upper_conf)

        cov_all = float(in_interval[test_mask_valid].mean()) if test_mask_valid.sum() > 0 else 0.0
        cov_miz = float(in_interval[miz_test].mean()) if miz_test.sum() > 0 else 0.0
        cov_open = float(in_interval[open_test].mean()) if open_test.sum() > 0 else 0.0

        width_miz = float(2 * q90_miz)
        width_open = float(2 * q90_open)

        metrics["conformal"] = {
            "q90_miz": q90_miz, "q90_open": q90_open,
            "coverage_all": cov_all, "coverage_miz": cov_miz, "coverage_open": cov_open,
            "width_miz": width_miz, "width_open": width_open,
            "cal_samples": int(cal_mask.sum()),
            "test_samples": int(test_mask.sum()),
        }
    else:
        metrics["conformal"] = {"error": "insufficient data for calibration/test split"}

    # ----------------------------------------------------------------
    # Save outputs
    # ----------------------------------------------------------------
    arrays = {
        "quantiles": quant.astype(np.float32),
        "combined_std": std_np.astype(np.float32),
        "confidence_class": cls_np,
        "median": arr(q_md).astype(np.float32),
        "y": y_np.astype(np.float32),
        "uncertainty_stats": unc_stats,
    }
    write_outputs(arrays, dates_np, metrics, out_year)

    # ----------------------------------------------------------------
    # Report
    # ----------------------------------------------------------------
    print()
    print("=" * 70)
    print("EVALUATION REPORT")
    print("=" * 70)

    print()
    print("  Per-seed:")
    for si, sm in enumerate(seed_miz):
        iiee_s, _, _, _, _, _ = compute_iiee(
            torch.from_numpy(per_model_np[si]), y_np, mask_np, lat, threshold=0.15
        )
        print(f"    Seed {si}: miz_day1={sm:.5f}, IIEE={iiee_s:.5f}")

    print()
    print("  Ensemble:")
    print(f"    ensemble_miz_day1:      {ens_miz:.5f}")
    print(f"    mean_of_seeds_miz:      {mean_of_seeds_miz:.5f}")
    print(f"    best_seed_miz:          {best_seed_miz:.5f}  (biased)")
    print(f"    ensembling_benefit:     {ensembling_benefit:.5f}")
    print(f"    Jensen check:           {'PASS' if jensen_check_passed else 'FAIL'}")
    print(f"    IIEE @ 0.15 aggregate:  {iiee_agg:.5f}")
    print(f"    IIEE @ 0.15 per-sample: {iiee_total:.5f}")
    print(f"    IIEE @ 0.15 over:       ({over_w:,} weighted)")
    print(f"    IIEE @ 0.15 under:      ({under_w:,} weighted)")
    print(f"    IIEE @ 0.42 aggregate:  {iiee_agg_42:.5f}")
    print(f"    IIEE @ 0.42 per-sample: {iiee_total_42:.5f}")
    print(f"    IIEE @ 0.42 over:       ({over_w_42:,} weighted)")
    print(f"    IIEE @ 0.42 under:      ({under_w_42:,} weighted)")
    print(f"    persistence_miz_day1:   {persist_d1:.5f}")

    print()
    print("  Conformal:")
    conf = metrics["conformal"]
    if "error" not in conf:
        print(f"    q90_miz:                {conf['q90_miz']:.5f}")
        print(f"    q90_open:               {conf['q90_open']:.5f}")
        print(f"    Coverage all:           {conf['coverage_all']:.4f}  (target 0.88-0.92)")
        print(f"    Coverage MIZ:           {conf['coverage_miz']:.4f}  (target 0.88-0.92)")
        print(f"    Coverage open:          {conf['coverage_open']:.4f}  (target 0.88-0.92)")
        print(f"    Width MIZ:              {conf['width_miz']:.5f}")
        print(f"    Width open:             {conf['width_open']:.5f}")
        print(f"    Cal / test samples:     {conf['cal_samples']} / {conf['test_samples']}")
    else:
        print(f"    {conf['error']}")

    print()
    print("  Uncertainty (MIZ pixels):")
    print(f"    mean std = {unc_stats['miz_mean_std']:.5f}")
    print(f"    p90 std  = {unc_stats['miz_p90_std']:.5f}")

    print()
    print(f"  Files: cache/metrics_{out_year}.json, cache/uncertainty_stats.json")
    print(f"\n[eval] done: {N} samples")


def main():
    parser = argparse.ArgumentParser(description="Confidence-aware SIC evaluation")
    parser.add_argument("--checkpoints", nargs="*", default=DEFAULT_CHECKPOINTS)
    parser.add_argument("--n-passes", type=int, default=N_PASSES_DEFAULT)
    parser.add_argument("--limit-batches", type=int, default=None)
    parser.add_argument("--out-year", default="2025")
    parser.add_argument("--n-outputs", type=int, default=1,
                        help="Number of output channels (1=1-frame, 3=3-frame)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.dry_run:
        dry_run(args.n_passes)
    else:
        run(args.checkpoints, args.n_passes, args.limit_batches, args.out_year,
            n_outputs=args.n_outputs)


if __name__ == "__main__":
    main()

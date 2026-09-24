"""
One-time data preparation script for PolarPath SIC viewer.
Reads model prediction/truth arrays and generates frontend data files.

Usage:
    python scripts/prep_frontend_data.py
"""

import json
import os
import sys
import argparse
import urllib.request
import ssl

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DATA = os.path.join(ROOT, "..", "frontend", "data")
FRAMES_DIR = os.path.join(FRONTEND_DATA, "frames")
VALUES_DIR = os.path.join(FRONTEND_DATA, "values")
N_DATES = 30


def ensure_dirs():
    os.makedirs(FRAMES_DIR, exist_ok=True)
    os.makedirs(VALUES_DIR, exist_ok=True)


def load_arrays():
    print("Loading arrays...")
    lat = np.load(os.path.join(ROOT, "data", "processed", "lat.npy"))
    lon = np.load(os.path.join(ROOT, "data", "processed", "lon.npy"))
    true_sic = np.load(os.path.join(ROOT, "plots", "true.npy"))
    pred_sic = np.load(os.path.join(ROOT, "plots", "pred.npy"))
    uncertainty = np.load(os.path.join(ROOT, "cache", "uncertainty_2025.npy"))
    dates = np.load(os.path.join(ROOT, "plots", "dates.npy"))
    # eval-compatible train_valid mask: cells observed at least once in training ([H, W]).
    # This is the same definition eval.py uses (src/eval.py:298) and excludes
    # land / ice shelf, so preview panels show transparent (base map) there.
    train_valid = np.any(
        ~np.isnan(np.load(os.path.join(ROOT, "data", "processed", "sic.npy"))),
        axis=0,
    )
    print(f"  lat: {lat.shape}, lon: {lon.shape}")
    print(f"  true_sic: {true_sic.shape}, pred_sic: {pred_sic.shape}")
    print(f"  uncertainty: {uncertainty.shape}")
    print(f"  dates: {dates.shape}, range: {dates[0]} to {dates[-1]}")
    print(f"  train_valid: {int(train_valid.sum())}/{train_valid.size} cells "
          f"({train_valid.mean()*100:.1f}%)")
    return lat, lon, true_sic, pred_sic, uncertainty, dates, train_valid


def select_dates(dates):
    N = len(dates)
    indices = np.round(np.linspace(0, N - 1, N_DATES)).astype(int)
    selected = [str(dates[i])[:10] for i in indices]
    print(f"Selected {N_DATES} dates: {selected[0]} ... {selected[-1]}")
    return indices, selected


def save_lat_lon(lat, lon):
    lat_path = os.path.join(FRONTEND_DATA, "lat.json")
    lon_path = os.path.join(FRONTEND_DATA, "lon.json")
    with open(lat_path, "w") as f:
        json.dump(lat.tolist(), f)
    with open(lon_path, "w") as f:
        json.dump(lon.tolist(), f)
    print(f"Wrote {lat_path}, {lon_path}")


def define_colormaps():
    # Actual SIC: green family (open water transparent so the navy base shows).
    actual_cmap = LinearSegmentedColormap.from_list("actual_sic", [
        (0.00, (0.000, 0.000, 0.000, 0.0)),
        (0.05, (0x1B / 255, 0x5E / 255, 0x20 / 255, 1.0)),
        (0.20, (0x38 / 255, 0x8E / 255, 0x3C / 255, 1.0)),
        (0.35, (0x4C / 255, 0xAF / 255, 0x50 / 255, 1.0)),
        (0.55, (0x81 / 255, 0xC7 / 255, 0x84 / 255, 1.0)),
        (0.75, (0xA5 / 255, 0xD6 / 255, 0xA7 / 255, 1.0)),
        (1.00, (0xE8 / 255, 0xF5 / 255, 0xE9 / 255, 1.0)),
    ])
    # Predicted SIC: orange family (open water transparent).
    predicted_cmap = LinearSegmentedColormap.from_list("predicted_sic", [
        (0.00, (0.000, 0.000, 0.000, 0.0)),
        (0.05, (0xBF / 255, 0x36 / 255, 0x0C / 255, 1.0)),
        (0.20, (0xE6 / 255, 0x4A / 255, 0x19 / 255, 1.0)),
        (0.35, (0xFF / 255, 0x57 / 255, 0x22 / 255, 1.0)),
        (0.55, (0xFF / 255, 0xB7 / 255, 0x4D / 255, 1.0)),
        (0.75, (0xFF / 255, 0xE0 / 255, 0xB2 / 255, 1.0)),
        (1.00, (0xFF / 255, 0xFD / 255, 0xE7 / 255, 1.0)),
    ])
    diff_cmap = LinearSegmentedColormap.from_list(
        "diff", ["#2166ac", "#f7f7f7", "#b2182b"]
    )
    conf_cmap = LinearSegmentedColormap.from_list(
        "confidence", ["#1a1a2e", "#ff8c00"]
    )
    return actual_cmap, predicted_cmap, diff_cmap, conf_cmap


def render_png(data, cmap, filepath, vmin=0.0, vmax=1.0):
    normed = np.clip((data - vmin) / (vmax - vmin + 1e-9), 0.0, 1.0)
    rgba = cmap(normed)
    rgb = (rgba[:, :, :3] * 255).astype(np.uint8)
    img = Image.fromarray(rgb, mode="RGB")
    img = img.transpose(Image.FLIP_TOP_BOTTOM)
    img.save(filepath)


def render_png_with_alpha(data, cmap, filepath, vmin=0.0, vmax=1.0, nan_mask=None):
    normed = np.clip((data - vmin) / (vmax - vmin + 1e-9), 0.0, 1.0)
    rgba = cmap(normed)
    if nan_mask is not None:
        rgba[nan_mask, 3] = 0.0
    img_array = (rgba * 255).astype(np.uint8)
    img = Image.fromarray(img_array, mode="RGBA")
    # Array row 0 = lat -75 (south); flip so the image is north-up for the
    # frontend (image pixel top maps to ROI.lb = -50).
    img = img.transpose(Image.FLIP_TOP_BOTTOM)
    img.save(filepath)


def nan_to_none(arr):
    result = []
    for row in arr:
        result.append([None if np.isnan(v) else round(float(v), 6) for v in row])
    return result


def frame_prefix(date_str):
    return os.path.join(FRAMES_DIR, date_str)


def render_frames(lat, lon, true_sic, pred_sic, uncertainty, dates, indices, selected,
                  train_valid, only=None):
    actual_cmap, predicted_cmap, diff_cmap, conf_cmap = define_colormaps()

    print(f"Rendering {N_DATES} dates...")
    work = [
        (date_idx, date_str)
        for date_idx, date_str in zip(indices, selected)
        if only is None or date_str == only
    ]
    for frame_idx, (date_idx, date_str) in enumerate(work):
        print(f"  [{frame_idx + 1}/{len(work)}] {date_str}")

        actual = true_sic[date_idx, 0]
        predicted = pred_sic[date_idx, 0]
        diff = actual - predicted
        # Raw combined_std (MC-dropout + ensemble) per cell; relabeled as
        # "uncertainty (std)" per project decision. No scalar confidence formula.
        uncertainty_map = uncertainty[date_idx, 0]

        # Static training-valid mask (land / ice shelf excluded in BOTH panels).
        actual_masked = np.where(train_valid, actual, np.nan)
        predicted_masked = np.where(train_valid, predicted, np.nan)
        diff_masked = np.where(train_valid, diff, np.nan)
        uncertainty_masked = np.where(train_valid, uncertainty_map, np.nan)

        band_mask = ~train_valid

        render_png_with_alpha(actual_masked, actual_cmap, f"{frame_prefix(date_str)}_actual.png", 0.0, 1.0, nan_mask=band_mask)
        render_png_with_alpha(predicted_masked, predicted_cmap, f"{frame_prefix(date_str)}_predicted.png", 0.0, 1.0, nan_mask=band_mask)
        render_png_with_alpha(diff_masked, diff_cmap, f"{frame_prefix(date_str)}_diff.png", -1.0, 1.0, nan_mask=band_mask)
        render_png_with_alpha(uncertainty_masked, conf_cmap, f"{frame_prefix(date_str)}_uncertainty.png", 0.0, 0.12, nan_mask=band_mask)

        values = {
            "actual": nan_to_none(actual_masked),
            "predicted": nan_to_none(predicted_masked),
            "diff": nan_to_none(diff_masked),
            "uncertainty": nan_to_none(uncertainty_masked),
        }
        with open(os.path.join(VALUES_DIR, f"{date_str}.json"), "w") as f:
            json.dump(values, f)

    print("Done rendering frames and values.")


def download_coastline():
    coastline_path = os.path.join(FRONTEND_DATA, "coastline.json")
    if os.path.exists(coastline_path):
        print(f"Coastline already exists: {coastline_path}")
        return

    urls = [
        "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson",
        "https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json",
    ]

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    for url in urls:
        try:
            print(f"Downloading coastline from {url}...")
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
                raw = resp.read()
            data = json.loads(raw)

            if "features" not in data:
                print(f"  Unexpected format from {url}, skipping")
                continue

            bbox = [-10, -75, 80, -50]
            clipped_features = []
            for feat in data["features"]:
                geom = feat.get("geometry", {})
                coords_list = (
                    [geom.get("coordinates", [])]
                    if geom.get("type") == "Polygon"
                    else geom.get("coordinates", [])
                )
                overlaps = False
                for poly_coords in coords_list:
                    for ring in poly_coords:
                        for c in ring:
                            lon_c = c[0]
                            lat_c = c[1] if len(c) > 1 else 0
                            if bbox[0] - 5 <= lon_c <= bbox[2] + 5 and bbox[1] - 5 <= lat_c <= bbox[3] + 5:
                                overlaps = True
                                break
                        if overlaps:
                            break
                    if overlaps:
                        break
                if overlaps:
                    clipped_features.append(feat)

            clipped = {"type": "FeatureCollection", "features": clipped_features}
            with open(coastline_path, "w") as f:
                json.dump(clipped, f)
            print(f"  Wrote coastline: {len(clipped_features)} features -> {coastline_path}")
            return
        except Exception as e:
            print(f"  Failed: {e}")
            continue

    print("  WARNING: Could not download coastline. Using fallback grid outline.")
    fallback = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "ROI outline"},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[
                        [-10, -50], [80, -50], [80, -75], [-10, -75], [-10, -50]
                    ]],
                },
            }
        ],
    }
    with open(coastline_path, "w") as f:
        json.dump(fallback, f)


def save_stations():
    stations = [
        {"name": "Maitri", "country": "India", "lat": -70.767, "lon": 11.733, "highlight": True},
        {"name": "Bharati", "country": "India", "lat": -69.397, "lon": 76.247, "highlight": True},
        {"name": "Neumayer III", "country": "Germany", "lat": -70.667, "lon": 8.267, "highlight": False},
        {"name": "SANAE IV", "country": "South Africa", "lat": -71.692, "lon": -2.850, "highlight": False},
        {"name": "Syowa", "country": "Japan", "lat": -69.000, "lon": 39.583, "highlight": False},
        {"name": "Princess Elisabeth", "country": "Belgium", "lat": -71.950, "lon": 23.350, "highlight": False},
        {"name": "Troll", "country": "Norway", "lat": -72.012, "lon": 2.533, "highlight": False},
        {"name": "Kohnen", "country": "Germany", "lat": -75.000, "lon": 0.000, "highlight": False},
        {"name": "Aboa", "country": "Finland", "lat": -73.050, "lon": 13.417, "highlight": False},
    ]
    path = os.path.join(FRONTEND_DATA, "stations.json")
    with open(path, "w") as f:
        json.dump(stations, f, indent=2)
    print(f"Wrote {path}")


def save_date_index(selected):
    path = os.path.join(FRONTEND_DATA, "values", "date_index.json")
    with open(path, "w") as f:
        json.dump(selected, f)
    print(f"Wrote {path}")


def run_test2026(only=None):
    """Render 30 evenly-spaced 2026 test samples across all 3 forecast horizons
    (day-1/2/3), with the exact same colormaps / mask / north-up flip / PNG
    style as the 2025 validation set. Each sample renders 3 horizon dates:
    D (day-1 target), D+1, D+2."""
    print("Loading 2026 test arrays...")
    lat = np.load(os.path.join(ROOT, "data", "processed", "lat.npy"))
    lon = np.load(os.path.join(ROOT, "data", "processed", "lon.npy"))
    ensemble = np.load(os.path.join(ROOT, "cache", "ensemble_2026.npy"))   # [167,3,3,H,W]
    true_sic = np.load(os.path.join(ROOT, "cache", "true_2026.npy"))       # [167,3,H,W]
    uncertainty = np.load(os.path.join(ROOT, "cache", "uncertainty_2026.npy"))
    dates = np.load(os.path.join(ROOT, "cache", "dates_2026.npy"))
    valid_mask = np.load(os.path.join(ROOT, "cache", "valid_mask.npy"))    # [H,W] bool

    print(f"  ensemble: {ensemble.shape}, true: {true_sic.shape}")
    print(f"  uncertainty: {uncertainty.shape}")
    print(f"  dates: {dates.shape}")
    print(f"  valid_mask: {int(valid_mask.sum())}/{valid_mask.size} cells "
          f"({valid_mask.mean()*100:.1f}%)")

    indices = np.linspace(0, len(dates) - 1, N_DATES).astype(int)
    selected = [str(dates[i])[:10] for i in indices]
    print(f"Selected {N_DATES} test dates:")
    for i in indices:
        print(f"{i:3d}  {str(dates[i])[:10]}")

    save_lat_lon(lat, lon)

    HORIZONS = [(0, "day1"), (1, "day2"), (2, "day3")]
    actual_cmap, predicted_cmap, diff_cmap, conf_cmap = define_colormaps()
    band_mask = ~valid_mask

    # Confidence bins are quantiles of combined_std over ICE cells only
    # (valid AND predicted SIC > 0.15). Quantiles over all valid cells are
    # dominated by the open-ocean majority (~70% of cells, tiny std), so ice
    # cells always landed MEDIUM/LOW and the label encoded "has ice" rather
    # than forecast confidence. Restricting to the ice domain makes the bins
    # discriminate ice-interior cells (HIGH) from MIZ cells (MEDIUM/LOW),
    # while open ocean (tiny std) also falls in HIGH.
    valid_3d = np.broadcast_to(valid_mask[None, None, :, :], uncertainty.shape)
    ice_cells = valid_3d & (ensemble[:, :, 1, :, :] > 0.15)
    ice_stds = uncertainty[ice_cells]

    print(f"Ice-cell std distribution:")
    print(f"  n cells: {ice_stds.size:,}")
    print(f"  p10: {np.percentile(ice_stds, 10):.5f}")
    print(f"  p33: {np.percentile(ice_stds, 33):.5f}")
    print(f"  p50: {np.percentile(ice_stds, 50):.5f}")
    print(f"  p66: {np.percentile(ice_stds, 66):.5f}")
    print(f"  p90: {np.percentile(ice_stds, 90):.5f}")

    CONF_P33 = float(np.percentile(ice_stds, 33))   # HIGH:  std <  p33
    CONF_P66 = float(np.percentile(ice_stds, 66))   # LOW:   std >= p66
    UNC_VMAX = 0.0197   # uncertainty layer normalizer (p95 over valid cells) for visible spread

    def classify(std_arr, valid_arr):
        """uint8 class per cell: 0=HIGH (std < p33), 1=MEDIUM, 2=LOW (>= p66),
        255 = land / invalid. Bin definitions shared with the frontend."""
        out = np.full(std_arr.shape, 255, dtype=np.uint8)
        out[std_arr < CONF_P33] = 0
        out[(std_arr >= CONF_P33) & (std_arr < CONF_P66)] = 1
        out[std_arr >= CONF_P66] = 2
        out[~valid_arr] = 255
        return out

    work = [
        (date_idx, date_str)
        for date_idx, date_str in zip(indices, selected)
        if only is None or date_str == only
    ]
    print(f"Rendering {len(work)} dates x 3 horizons x 4 layers...")
    total_png = 0
    for frame_idx, (date_idx, date_str) in enumerate(work):
        print(f"  [{frame_idx + 1}/{len(work)}] {date_str}")
        base_dt = np.datetime64(dates[date_idx], "D")
        values = {
            "date": date_str,
            "lat": lat.tolist(),
            "lon": lon.tolist(),
            "horizons": {},
        }
        for h, h_label in HORIZONS:
            target_dt = base_dt + np.timedelta64(h, "D")
            target_str = str(target_dt)

            actual = true_sic[date_idx, h]
            predicted = ensemble[date_idx, h, 1]
            pred_lo = ensemble[date_idx, h, 0]
            pred_hi = ensemble[date_idx, h, 2]
            uncertainty_map = uncertainty[date_idx, h]

            actual_masked = np.where(valid_mask, actual, np.nan)
            predicted_masked = np.where(valid_mask, predicted, np.nan)
            pred_lo_masked = np.where(valid_mask, pred_lo, np.nan)
            pred_hi_masked = np.where(valid_mask, pred_hi, np.nan)
            diff_masked = np.where(valid_mask, actual - predicted, np.nan)
            uncertainty_masked = np.where(valid_mask, uncertainty_map, np.nan)
            conf_masked = classify(uncertainty_map, valid_mask)

            prefix = frame_prefix(date_str) + f"_{h_label}"
            render_png_with_alpha(actual_masked, actual_cmap, f"{prefix}_actual.png", 0.0, 1.0, nan_mask=band_mask)
            render_png_with_alpha(predicted_masked, predicted_cmap, f"{prefix}_predicted.png", 0.0, 1.0, nan_mask=band_mask)
            render_png_with_alpha(diff_masked, diff_cmap, f"{prefix}_diff.png", -1.0, 1.0, nan_mask=band_mask)
            render_png_with_alpha(uncertainty_masked, conf_cmap, f"{prefix}_uncertainty.png", 0.0, UNC_VMAX, nan_mask=band_mask)
            total_png += 4

            values["horizons"][h_label] = {
                "target_date": target_str,
                "actual": nan_to_none(actual_masked),
                "predicted": nan_to_none(predicted_masked),
                "lower": nan_to_none(pred_lo_masked),
                "upper": nan_to_none(pred_hi_masked),
                "uncertainty": nan_to_none(uncertainty_masked),
                "confidence": [[255 if v == 255 else int(v) for v in row] for row in conf_masked],
                "diff": nan_to_none(diff_masked),
            }
        with open(os.path.join(VALUES_DIR, f"{date_str}.json"), "w") as f:
            json.dump(values, f)

    thresholds = {
        "p33": CONF_P33,
        "p66": CONF_P66,
        "source": "quantiles of combined_std over cells where predicted SIC > 0.15 and valid",
        "n_ice_cells": int(ice_stds.size),
    }
    with open(os.path.join(FRONTEND_DATA, "confidence_thresholds.json"), "w") as f:
        json.dump(thresholds, f)
    print(f"Wrote frontend/data/confidence_thresholds.json: p33={CONF_P33:.5f}, "
          f"p66={CONF_P66:.5f}, n_ice_cells={ice_stds.size:,}")

    save_date_index(selected)
    print(f"Done rendering {total_png} PNGs and {len(work)} values files.")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", default=None,
                        help="Restrict rendering to a single date (YYYY-MM-DD).")
    parser.add_argument("--test2026", action="store_true",
                        help="Render the 2026 test set (30 evenly-spaced samples) "
                             "instead of the 2025 validation set.")
    args = parser.parse_args()

    os.chdir(ROOT)
    ensure_dirs()
    if args.test2026:
        run_test2026(only=args.only)
        download_coastline()
        save_stations()
        print("\nAll 2026 test frontend data prepared successfully!")
        return
    lat, lon, true_sic, pred_sic, uncertainty, dates, train_valid = load_arrays()
    indices, selected = select_dates(dates)
    save_lat_lon(lat, lon)
    render_frames(lat, lon, true_sic, pred_sic, uncertainty, dates, indices, selected,
                  train_valid, only=args.only)
    save_date_index(selected)
    download_coastline()
    save_stations()
    print("\nAll frontend data prepared successfully!")


if __name__ == "__main__":
    main()

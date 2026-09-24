#!/usr/bin/env python3
"""
Build the routing cost grid for the PolarPath system.

Produces the static grids a future A* routing engine will consume, from
the frozen 2026 model output only. Builds the (downstream-of-the-model)
routing inputs; it does NOT implement routing, iceberg terms, or a
station standoff buffer.

Grid: lat -75..-32 deg, lon -10..82 deg, 0.25 deg -> 173 x 369.
The model band (lat -75..-50) is pasted at the SOUTH end; the northward
extension band (lat -50..-32) is assumed all open ocean (see metadata).

Run from backend/ so cache/, data/, plots/ resolve:
    python scripts/build_routing_grid.py
"""
import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "cache"
DATA = ROOT / "data" / "processed"
PLOTS = ROOT / "plots"

RES = 0.25
R = 6371.0  # km


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    PLOTS.mkdir(parents=True, exist_ok=True)

    # ==================================================================
    # STEP 1 - routing grid axes
    # ==================================================================
    model_lat = np.load(DATA / "lat.npy")   # [101], ascending -75..-50
    model_lon = np.load(DATA / "lon.npy")   # [361], ascending -10..80

    assert abs(model_lat[0] - (-75.0)) < 1e-6
    assert abs(model_lat[-1] - (-50.0)) < 1e-6
    assert abs(model_lon[0] - (-10.0)) < 1e-6
    assert abs(model_lon[-1] - (80.0)) < 1e-6

    H_model = len(model_lat)   # 101

    # Extension band: -49.75 to -32.00
    extension_lat = np.round(
        np.arange(model_lat[-1] + RES, -32.0 + RES / 2, RES), 2
    )

    # Extended longitude: -10 to 82
    routing_lon = np.round(
        np.arange(-10.0, 82.0 + RES / 2, RES), 2
    ).astype(np.float32)

    routing_lat = np.concatenate([model_lat, extension_lat]).astype(np.float32)

    H_route = len(routing_lat)
    print(f"Grid shape: {H_route} x {len(routing_lon)}")
    print(f"routing_lat range: [{routing_lat[0]}, {routing_lat[-1]}]")
    print(f"routing_lon range: [{routing_lon[0]}, {routing_lon[-1]}]")
    print(f"model band occupies routing_lat[0:{H_model}] = "
          f"[{routing_lat[0]} .. {routing_lat[H_model-1]}]")
    print(f"extension band occupies routing_lat[{H_model}:{H_route}] = "
          f"[{routing_lat[H_model]} .. {routing_lat[-1]}]")

    assert abs(routing_lat[0] - (-75.0)) < 1e-6
    assert abs(routing_lat[-1] - (-32.0)) < 1e-6

    np.save(CACHE / "routing_lat.npy", routing_lat)
    np.save(CACHE / "routing_lon.npy", routing_lon)

    # ==================================================================
    # STEP 2 - distance grid
    # ==================================================================
    dlat_rad = np.deg2rad(RES)
    dy = R * dlat_rad                          # constant ~27.8 km

    dlon_rad = np.deg2rad(RES)
    dx_per_lat = R * dlon_rad * np.cos(np.deg2rad(routing_lat))  # [H_route]

    np.save(CACHE / "routing_dy.npy",
            np.full((H_route, len(routing_lon)), dy, dtype=np.float32))
    np.save(CACHE / "routing_dx.npy",
            np.broadcast_to(dx_per_lat[:, None],
                            (H_route, len(routing_lon))).astype(np.float32))

    print(f"dy (constant): {dy:.2f} km")
    print(f"dx at -75 deg S: {dx_per_lat[0]:.2f} km")
    print(f"dx at -32 deg S: {dx_per_lat[-1]:.2f} km")

    # ==================================================================
    # STEP 3 - SIC grid per date (+ axis verification)
    # ==================================================================
    ensemble_2026 = np.load(CACHE / "ensemble_2026.npy")   # [N,3,3,101,361]
    true_2026 = np.load(CACHE / "true_2026.npy")           # [N,3,101,361]
    valid_mask = np.load(CACHE / "valid_mask.npy")         # [101,361]
    dates_2026 = np.load(CACHE / "dates_2026.npy")

    assert ensemble_2026.shape[-2:] == (H_model, len(model_lon))
    assert true_2026.shape[-2:] == (H_model, len(model_lon))

    EXPECTED_MIZ_RMSE = 0.0958

    def masked_miz_rmse(pred, true, valid):
        # MIZ mask matching the project's canonical definition
        # (eval.py miz_rmse_np / README): 0.15 < true SIC < 0.85.
        miz = valid & (true > 0.15) & (true < 0.85) & ~np.isnan(true)
        diff2 = (pred[miz] - true[miz]) ** 2
        return np.sqrt(diff2.mean())

    candidates = [
        ((0, 1), "day-1 median"),
        ((0, 0), "day-1 lower"),
        ((0, 2), "day-1 upper"),
        ((1, 1), "day-2 median"),
    ]

    print("Index verification (target 0.0958):")
    for (a, b), desc in candidates:
        rmse = masked_miz_rmse(ensemble_2026[:, a, b],
                               true_2026[:, 0],
                               valid_mask)
        marker = "  <- matches" if abs(rmse - EXPECTED_MIZ_RMSE) < 0.005 else ""
        print(f"  {a},{b} ({desc}): MIZ RMSE = {rmse:.4f}{marker}")

    DAY1_STAT_IDX = (0, 1)
    computed = masked_miz_rmse(ensemble_2026[:, DAY1_STAT_IDX[0],
                                              DAY1_STAT_IDX[1]],
                                true_2026[:, 0], valid_mask)
    assert abs(computed - EXPECTED_MIZ_RMSE) < 0.005, (
        f"DAY1_STAT_IDX {DAY1_STAT_IDX} gives MIZ RMSE {computed:.4f}, "
        f"expected {EXPECTED_MIZ_RMSE}."
    )
    print(f"DAY1_STAT_IDX verified: {DAY1_STAT_IDX} -> {computed:.4f}")

    N = ensemble_2026.shape[0]
    W_model = len(model_lon)                   # 361 (model covers -10..80)
    H_lon = len(routing_lon)                   # 369 (routing covers -10..82)

    routing_sic = np.zeros((N, H_route, H_lon), dtype=np.float32)
    valid_extended = np.zeros((H_route, H_lon), dtype=bool)

    # Model band at the SOUTH end (rows 0:H_model); routing_lat ascending.
    # Lon coverage: the model only spans -10..80 (cols 0:W_model); the 8
    # extra columns (80.25..82.0) are outside the model domain and stay NaN.
    valid_extended[:H_model, :W_model] = valid_mask
    valid_extended[:H_model, W_model:] = False

    # Extension band (-50 to -32): all ocean, no ice expected, full lon span.
    # NOTE: treats the entire band as traversable, including any South
    # African coastline near Cape Town. See metadata flag.
    valid_extended[H_model:, :] = True

    a, b = DAY1_STAT_IDX
    routing_sic[:, :H_model, :W_model] = ensemble_2026[:, a, b]
    # routing_sic[:, H_model:, :] stays 0.0 (open ocean)

    routing_sic[:, ~valid_extended] = np.nan

    np.save(CACHE / "routing_sic_2026.npy", routing_sic)

    # ==================================================================
    # STEP 4 - ice risk multiplier
    # ==================================================================
    def sic_to_multiplier(sic):
        m = np.ones_like(sic, dtype=np.float32)
        m[(sic >= 0.15) & (sic < 0.40)] = 2.0
        m[(sic >= 0.40) & (sic < 0.70)] = 8.0
        m[(sic >= 0.70) & (sic < 0.85)] = 50.0
        m[sic >= 0.85] = np.inf
        m[np.isnan(sic)] = np.inf
        return m

    routing_multiplier = sic_to_multiplier(routing_sic)
    np.save(CACHE / "routing_multiplier_2026.npy", routing_multiplier)

    # ==================================================================
    # STEP 5 - directional cost grids
    # ==================================================================
    dx_b = np.broadcast_to(dx_per_lat[:, None], (H_route, H_lon))
    cost_x = dx_b[None, :, :] * routing_multiplier
    cost_y = dy * routing_multiplier

    np.save(CACHE / "routing_cost_x_2026.npy", cost_x.astype(np.float32))
    np.save(CACHE / "routing_cost_y_2026.npy", cost_y.astype(np.float32))

    # ==================================================================
    # STEP 6 - metadata
    # ==================================================================
    metadata = {
        "grid_shape": [H_route, H_lon],
        "resolution_deg": 0.25,
        "lat_range": [-75.0, -32.0],
        "lon_range": [-10.0, 82.0],
        "model_band_rows": [0, H_model],
        "extension_band_rows": [H_model, H_route],
        "model_band_cols": [0, W_model],
        "lon_extension_cols": [W_model, H_lon],
        "notes_lon_domain": (
            "Model outputs cover lon -10..80 only. In the model band "
            "(rows 0:101) the columns 80.25..82.0 (lon_extension_cols) "
            "are outside the model domain and are NaN/impassable; the "
            "extension band (rows 101:173) covers the full lon span."
        ),
        "cost_terms": {
            "distance": "implemented",
            "sic_risk": "implemented",
            "iceberg_standoff": "deferred - no trajectory predictor yet",
            "station_standoff_buffer": "deferred - N-nm approach buffer not implemented",
            "land_mask_extension_band": (
                "deferred - the model ROI valid_mask (from NSIDC CDR v6 "
                "NaN cells) is a land mask, but only covers -75 to -50. "
                "The extension band (-50 to -32) has no equivalent land "
                "mask and is currently assumed all open water. Source a "
                "GEBCO-based land mask for that band before trusting "
                "routes near Cape Town."
            ),
        },
        "polaris_multipliers": {
            "open_water": 1.0,
            "marginal_ice": 2.0,
            "moderate_pack": 8.0,
            "hard_pack": 50.0,
            "impassable": "inf",
        },
        "reference_vessel": "Vasiliy Golovnin class (FESCO ice-class cargo)",
        "notes": (
            "Multipliers are v1 heuristics informed by Lindqvist "
            "ice-resistance curves and FESCO voyage reports. Not a "
            "validated POLARIS implementation. DAY1_STAT_IDX verified "
            "against known 2026 test MIZ RMSE before trusting output."
        ),
    }
    with open(CACHE / "routing_metadata.json", "w") as f:
        json.dump(metadata, f, indent=2)

    # ==================================================================
    # STEP 7 - preview plot
    # ==================================================================
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt

    i = 0   # first test date
    date_label = str(dates_2026[i])[:10]

    fig, axes = plt.subplots(1, 3, figsize=(18, 6))

    extent = [-10, 82, -75, -32]

    im0 = axes[0].imshow(routing_sic[i], cmap='Blues_r', vmin=0, vmax=1,
                          origin='lower', aspect='auto', extent=extent)
    axes[0].set_title(f"SIC  {date_label}  (day-1 median)")
    plt.colorbar(im0, ax=axes[0])

    im1 = axes[1].imshow(np.log10(routing_multiplier[i] + 1),
                          cmap='YlOrRd', origin='lower', aspect='auto',
                          extent=extent)
    axes[1].set_title("log10(ice multiplier + 1)")
    plt.colorbar(im1, ax=axes[1])

    im2 = axes[2].imshow(np.log10(cost_x[i] + 1),
                          cmap='YlOrRd', origin='lower', aspect='auto',
                          extent=extent)
    axes[2].set_title("log10(cost_x + 1)")
    plt.colorbar(im2, ax=axes[2])

    for ax in axes:
        ax.plot(18.42, -33.92, 'rs', markersize=12, label='Cape Town')
        ax.plot(11.73, -70.77, 'g^', markersize=12, label='Maitri')
        ax.plot(76.19, -69.41, 'g^', markersize=12, label='Bharati')
        ax.set_xlabel("Longitude")
        ax.set_ylabel("Latitude")

    axes[0].legend(loc='upper right')
    plt.tight_layout()
    plt.savefig(PLOTS / "routing_cost_preview.png", dpi=120)
    print("Saved plots/routing_cost_preview.png")


if __name__ == "__main__":
    main()
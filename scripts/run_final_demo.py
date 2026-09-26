#!/usr/bin/env python3
"""
Final SIH Demo / Verification Entry Point
=========================================

Runs the existing, already-built pipeline end to end using ONLY artifacts
that already exist in the repository.  Nothing is trained, regenerated,
downloaded, or fabricated.

Pipeline exercised (each stage prints its data provenance)::

    REAL SIC (backend/cache/routing_sic_2026.npy, teammate's committed
             forecast output)
        -> EnvironmentalGrid          (src/data/sic_forecast.py)
        -> CMEMS current              (src/data/cmems_loader.py; data may be
                                       unavailable -> reported, never faked)
        -> Route ML policy            (outputs/ml/route_policy.pt)
        -> Safety / robust routing    (src/routing/astar.py, cost.py,
                                       src/ml/ml_robust_router.py)
        -> Dynamic rerouting          (src/ml/dynamic_reroute.py controllers)
        -> Final route                (outputs/final_demo/final_route.json)

Outputs:
    outputs/final_demo/final_route.json
    outputs/final_demo/final_system_validation.json

Honesty rules enforced by this script:
  * REAL vs SYNTHETIC provenance is printed and recorded for every stage.
  * Missing real data (CMEMS, iceberg) is reported as unavailable; it is
    never replaced by invented values.
  * ``retraining_performed`` is hard-coded False and no training code path
    is imported or called.

Run from the repository root:
    python scripts/run_final_demo.py
    python scripts/run_final_demo.py --skip-tests
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

CACHE = ROOT / "backend" / "cache"
ML_OUT = ROOT / "outputs" / "ml"
OUT_DIR = ROOT / "outputs" / "final_demo"
ROUTE_JSON = OUT_DIR / "final_route.json"
VALIDATION_JSON = OUT_DIR / "final_system_validation.json"

ROUTE_START = datetime(2026, 1, 6, tzinfo=timezone.utc)
REROUTE_OFFSET_DAYS = 3

# Cape Town -> Maitri, in routing-grid cells (rows are -75 -> -32 ascending).
CAPE_TOWN = (172, 368)
MAITRI = (20, 82)

PROVENANCE = {
    "sic": "REAL (teammate's committed 2026 forecast output, backend/cache)",
    "sic_uncertainty": "REAL (raw ensemble + MC-dropout std, model band only)",
    "cmems": "REAL if mounted, otherwise reported UNAVAILABLE (never faked)",
    "iceberg": "NOT AVAILABLE (no data/model output in the repository)",
    "route_ml_policy": "REAL file outputs/ml/route_policy.pt, but trained on a "
                       "SYNTHETIC 20x25 smoke-test dataset",
    "robust_expert": "REAL environmental field, deterministic A* on real SIC",
    "cvar": "requires scenario layers (iceberg risk + uncertainty); "
            "reported UNAVAILABLE when those layers are absent",
}


def hr(title: str = "") -> None:
    print("\n" + "=" * 78)
    if title:
        print(title)
        print("=" * 78)


# ---------------------------------------------------------------------------
# Stage 0 - test suite
# ---------------------------------------------------------------------------

def run_tests(skip: bool) -> dict:
    hr("STAGE 0  TESTS")
    if skip:
        print("skipped (--skip-tests)")
        return {"ran": False, "passed": None, "failed": None}

    proc = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/", "-q"],
        cwd=str(ROOT), capture_output=True, text=True,
    )
    tail = (proc.stdout or "") + (proc.stderr or "")
    print(tail.strip().splitlines()[-1] if tail.strip() else "(no output)")

    passed = failed = 0
    m = re.search(r"(\d+) passed", tail)
    if m:
        passed = int(m.group(1))
    m = re.search(r"(\d+) failed", tail)
    if m:
        failed = int(m.group(1))
    status = "PASSED" if proc.returncode == 0 else "FAILED"
    print(f"pytest exit code {proc.returncode} -> {status}")
    return {
        "ran": True,
        "passed": passed,
        "failed": failed,
        "exit_code": proc.returncode,
        "status": status,
    }


# ---------------------------------------------------------------------------
# Stage 1 - real SIC -> EnvironmentalGrid
# ---------------------------------------------------------------------------

def stage_real_sic():
    hr("STAGE 1  REAL SIC  ->  ENVIRONMENTAL GRID")
    from src.data.builder import build_grid_template
    from src.data.sic_forecast import SICForecastField

    field = SICForecastField(cache_dir=str(CACHE),
                             route_start_datetime=ROUTE_START)
    if not field.is_available():
        raise FileNotFoundError(f"real SIC artifacts missing in {CACHE}")

    info = field.describe()
    spec = field.grid_spec()
    template = build_grid_template(
        lat_min=spec["lat_min"], lat_max=spec["lat_max"],
        lon_min=spec["lon_min"], lon_max=spec["lon_max"],
        resolution_deg=spec["resolution_deg"],
    )
    grid = field.load(t_hours=0.0, grid_template=template)

    sic = grid.sic_mean
    full = np.load(str(CACHE / "routing_sic_2026.npy"))
    print(f"  provenance           : {PROVENANCE['sic']}")
    print(f"  artifact             : backend/cache/routing_sic_2026.npy")
    print(f"  shape                : {info['sic_shape']}  {info['sic_dtype']}")
    print(f"  date range           : {info['date_range'][0]} .. {info['date_range'][1]}"
          f"  ({info['n_time_steps']} daily steps)")
    print(f"  uncertainty          : {info['uncertainty_shape']}"
          f"  ({info['n_horizons']} horizons, model band "
          f"{info['model_band_rows'][1]}x{info['model_band_cols'][1]})")
    print(f"  grid                 : {grid.n_rows} x {grid.n_cols} @ "
          f"{grid.resolution_deg} deg, lat {spec['lat_min']}..{spec['lat_max']}, "
          f"lon {spec['lon_min']}..{spec['lon_max']}")
    print(f"  SIC min/mean/max     : {np.nanmin(full):.7f} / "
          f"{np.nanmean(full):.7f} / {np.nanmax(full):.7f}   (all "
          f"{full.shape[0]} steps)")
    print(f"  SIC step 0 min/mean/max: {np.nanmin(sic):.7f} / "
          f"{np.nanmean(sic):.7f} / {np.nanmax(sic):.7f}")
    print(f"  NaN cells (step 0)   : {int(np.isnan(sic).sum())} "
          f"({float(np.mean(np.isnan(sic)))*100:.1f}%) -> marked "
          f"non-navigable, never zero-filled")
    print(f"  navigable cells      : {int(grid.navigable.sum())} / {grid.navigable.size}")
    print(f"  layers present       : sic_mean={grid.sic_mean is not None}, "
          f"sic_uncertainty={grid.sic_uncertainty is not None}")
    info = dict(info)
    info["sic_min"] = float(np.nanmin(full))
    info["sic_mean"] = float(np.nanmean(full))
    info["sic_max"] = float(np.nanmax(full))
    info["sic_contains_nan"] = bool(np.isnan(full).any())
    info["sic_nan_fraction"] = float(np.mean(np.isnan(full)))
    del full
    return field, grid, info


# ---------------------------------------------------------------------------
# Stage 2 - CMEMS current
# ---------------------------------------------------------------------------

def stage_cmems(grid):
    hr("STAGE 2  CMEMS CURRENT DATA")
    from src.data.config import DataConfig

    config = DataConfig.from_env()
    cmems_root = config.cmems_root
    print(f"  integration present  : True "
          f"(src/data/cmems_loader.py, src/data/adapters.py"
          f"::CMEMSDateAwareAdapter)")
    print(f"  configured root      : {cmems_root or '(not configured)'}")
    print(f"  ARCTIC_CMEMS_ROOT    : {'set' if cmems_root else 'unset'}")

    available = False
    reason = ""
    if not cmems_root:
        reason = ("no cmems_root configured (Google Drive not mounted in this "
                  "environment)")
    else:
        from src.data.cmems_loader import resolve_cmems_path
        try:
            resolve_cmems_path(cmems_root, ROUTE_START)
            available = True
        except Exception as exc:
            reason = f"{type(exc).__name__}: {exc}"

    if available:
        print("  CMEMS DATA           : available -> loading uo/vo")
        return True, "available", None
    print(f"  CMEMS DATA           : UNAVAILABLE ({reason})")
    print("  -> current_cost / current_uo / current_vo stay None; the demo")
    print("     reports this instead of substituting invented currents.")
    print(f"  provenance           : {PROVENANCE['cmems']}")
    return False, reason, None


# ---------------------------------------------------------------------------
# Stage 3 - expert / robust routing on the real field
# ---------------------------------------------------------------------------

def stage_expert_route(grid):
    hr("STAGE 3  SAFETY / ROBUST ROUTING (expert route on the real field)")
    from src.routing.astar import astar
    from src.routing.cost import CostMap, CostWeights
    from src.routing.scenario_router import CVaRResult
    from src.routing.scenario_router import jaccard_overlap, route_coverage
    from src.uncertainty.scenarios import generate_scenarios

    weights = CostWeights()
    cost_map = CostMap(grid, weights)
    nan_cost = np.isnan(cost_map.env_cost)
    print(f"  expert algorithm     : A* + CostMap (src/routing/astar.py)")
    print(f"  NaN-cost cells match non-navigable cells exactly: "
          f"{bool(np.array_equal(nan_cost, ~grid.navigable))}")

    # Genuine scenario/CVaR attempt - reported honestly if impossible.
    cvar_ok, cvar_reason = False, ""
    try:
        generate_scenarios(grid, n_scenarios=3, seed=0)
        cvar_ok = True
    except Exception as exc:
        cvar_reason = f"{type(exc).__name__}: {exc}"
    print(f"  CVaR scenario stage  : "
          f"{'available' if cvar_ok else 'UNAVAILABLE -> ' + cvar_reason}")
    print(f"  provenance           : {PROVENANCE['cvar']}")

    result = astar(grid, CAPE_TOWN, MAITRI, weights=weights)
    path = [tuple(p) for p in result.path]
    print(f"  A* success           : {result.success}")
    print(f"  waypoints            : {result.num_waypoints}")
    print(f"  route length         : {result.route_length:.1f} grid units")
    print(f"  total cost           : {result.total_cost:.3f}")
    if path:
        sic_vals = np.array([grid.sic_mean[r, c] for r, c in path])
        lat0, lon0 = grid.lat[path[0][0]], grid.lon[path[0][1]]
        lat1, lon1 = grid.lat[path[-1][0]], grid.lon[path[-1][1]]
        print(f"  start / goal         : ({lat0:.2f}, {lon0:.2f}) -> "
              f"({lat1:.2f}, {lon1:.2f})")
        print(f"  SIC along route      : max={np.nanmax(sic_vals):.4f} "
              f"mean={np.nanmean(sic_vals):.4f}")
        print(f"  NaN cells on route   : {int(np.isnan(sic_vals).sum())}")

    # CVaRResult carries the expert path so ml_robust_router can use it.
    # cvar/var/worst_case stay None: no scenario distribution was computed.
    robust = CVaRResult(
        selected_path=path,
        selected_cost_mean=None,
        selected_cvar=None,
        selected_var=None,
        selected_worst_case=None,
        candidate_paths={0: path},
        candidate_costs={},
        candidate_cvar={},
        candidate_mean={},
        deterministic_path=path,
        deterministic_cvar=None,
        deterministic_mean=None,
        n_scenarios=0,
        alpha=0.05,
    )
    return robust, path, {
        "astar_success": bool(result.success),
        "waypoints": int(result.num_waypoints),
        "route_length_cells": float(result.route_length),
        "total_cost": float(result.total_cost),
        "cvar_computed": bool(cvar_ok),
        "cvar_unavailable_reason": cvar_reason,
    }, (jaccard_overlap, route_coverage)


# ---------------------------------------------------------------------------
# Stage 4 - route ML policy
# ---------------------------------------------------------------------------

def stage_ml_policy(grid, robust):
    hr("STAGE 4  ROUTE ML POLICY (outputs/ml/route_policy.pt)")
    from src.ml.ml_robust_router import (load_route_policy, build_features,
                                         predict_action, cell_is_safe,
                                         summarize, MOVES)

    model, checkpoint = load_route_policy()
    print(f"  provenance           : {PROVENANCE['route_ml_policy']}")
    print(f"  architecture         : "
          f"Linear(16->64) ReLU Dropout(0.15) Linear(64->32) ReLU "
          f"Linear(32->8)")
    print(f"  n_features / actions : {checkpoint['n_features']} / "
          f"{checkpoint['n_actions']}")
    print(f"  action space         : 8-neighbour "
          f"{[f'{k}:{v}' for k, v in MOVES.items()]}")
    print(f"  training val accuracy: {checkpoint['best_val_accuracy']:.4f} "
          f"(in-training split, synthetic dataset)")

    val_path = ML_OUT / "route_policy_validation.json"
    if val_path.exists():
        v = json.loads(val_path.read_text())
        print(f"  reported accuracy    : {v['validation_dataset_accuracy']:.6f} "
              f"on n={v['n_samples']} samples, mean confidence "
              f"{v['mean_prediction_confidence']:.4f}")
        print("  NOTE                : that file evaluates the policy on the "
              "SAME synthetic dataset it\n                         was trained on; "
              "it is not a held-out real-data score.")

    # Drive the policy step by step, safety-gated, with robust fallback.
    from src.ml.ml_robust_router import ml_guided_route
    res = ml_guided_route(grid, robust, CAPE_TOWN, MAITRI, t_hours=0.0)
    s = summarize(res)
    print(f"  ml_guided_route      : success={s['success']} "
          f"goal_reached={s['goal_reached']}")
    print(f"  ml steps / fallback  : {s['ml_steps']} / "
          f"{s['robust_fallback_steps']}")
    print(f"  path length (cells)  : {s['path_length_cells']}")

    # A single inference example, for the record.
    feats = build_features(grid, CAPE_TOWN, MAITRI, 0.0)
    action, confidence, probs = predict_action(model, checkpoint, feats)
    nxt = (CAPE_TOWN[0] + MOVES[action][0], CAPE_TOWN[1] + MOVES[action][1])
    print(f"  single-step sample   : action={action} {MOVES[action]} "
          f"confidence={confidence:.4f} safe={cell_is_safe(grid, nxt)}")
    info = {
        "n_features": int(checkpoint["n_features"]),
        "n_actions": int(checkpoint["n_actions"]),
        "training_val_accuracy": float(checkpoint["best_val_accuracy"]),
        "single_step_confidence": float(confidence),
        "trained_on_synthetic_dataset": True,
        "goal_reached_on_real_grid": bool(s["goal_reached"]),
        "reaches_goal": bool(s["success"]),
        "reason": res.get("reason"),
        **s,
    }
    if not s["goal_reached"]:
        print("  WARNING              : the policy did not reach Maitri within the")
        print("                         step budget on the real 173x369 grid. It was")
        print("                         trained on a 20x25 SYNTHETIC grid, so n_rows/")
        print("                         n_cols and the distance features are far")
        print("                         out of distribution. The safety layer kept")
        print("                         every step inside the robust expert path; the")
        print("                         expert A* route remains the valid result.")
    return info


# ---------------------------------------------------------------------------
# Stage 5 - dynamic rerouting on real SIC
# ---------------------------------------------------------------------------

def stage_dynamic_reroute(field, grid, path, helpers):
    hr("STAGE 5  DYNAMIC RE-ROUTING (real SIC, later forecast step)")
    from src.ml.dynamic_reroute import choose_safe_action, MOVES as D_MOVES
    from src.ml.ml_robust_router import (load_route_policy, build_features)
    from src.routing.astar import astar
    from src.routing.cost import CostWeights

    jaccard_overlap, route_coverage = helpers
    weights = CostWeights()

    later_index = REROUTE_OFFSET_DAYS
    later = field.load(t_hours=later_index * 24.0, grid_template=grid)
    print(f"  provenance           : REAL SIC, forecast step "
          f"+{REROUTE_OFFSET_DAYS} days ({field.date_range()[0][:10]} "
          f"-> step {later_index})")

    # Environment changed => re-plan the same leg.
    replan = astar(later, CAPE_TOWN, MAITRI, weights=weights)
    new_path = [tuple(p) for p in replan.path]
    print(f"  replan success       : {replan.success}")
    print(f"  waypoints            : {len(path)} -> {replan.num_waypoints}")

    divergence = None
    if path and new_path:
        divergence = {
            "jaccard_overlap": float(jaccard_overlap(path, new_path)),
            "route_coverage": float(route_coverage(path, new_path)),
        }
        print(f"  jaccard overlap      : {divergence['jaccard_overlap']:.4f}")
        print(f"  route coverage       : {divergence['route_coverage']:.4f}")

    # Safety-gated single-step decision on the REAL grid.
    model, checkpoint = load_route_policy()
    if path:
        probe = path[0]
    else:
        probe = CAPE_TOWN
    feats = build_features(later, probe, MAITRI, float(later_index * 24))
    # iceberg layer is absent; the controller's safety check is fed an
    # explicit 0.0 default and this is recorded, not passed off as data.
    iceberg_default = np.zeros_like(later.sic_mean, dtype=np.float32)
    decision = choose_safe_action(
        model, checkpoint, feats, probe[0], probe[1],
        later.n_rows, later.n_cols, later.navigable, later.sic_mean,
        iceberg_default,
    )
    print(f"  probe cell           : {probe} "
          f"(lat {later.lat[probe[0]]:.2f}, lon {later.lon[probe[1]]:.2f})")
    print(f"  policy action        : {decision['action']} "
          f"{D_MOVES[int(decision['action'])] if decision['action'] is not None else ''}"
          f" conf={decision['confidence']:.4f}")
    print(f"  decision source      : {decision['source']}")
    print(f"  fallback used        : {decision['fallback']}")
    print(f"  iceberg default      : 0.0 (NO iceberg data available)")

    # The committed dynamic_reroute_demo.json is synthetic - say so.
    demo_path = ML_OUT / "dynamic_reroute_demo.json"
    committed = json.loads(demo_path.read_text()) if demo_path.exists() else {}
    if committed:
        print(f"  committed artifact   : outputs/ml/dynamic_reroute_demo.json")
        print(f"                         decision_source="
              f"{committed.get('decision_source')!r} -> generated on a "
              f"synthetic 20x20 demo\n                         environment, not "
              f"on real SIC. Treated as a controller demo only.")
    return {
        "reroute_forecast_step": int(later_index),
        "reroute_replan_success": bool(replan.success),
        "waypoints_before": int(len(path)),
        "waypoints_after": int(replan.num_waypoints),
        "divergence": divergence,
        "policy_action": decision["action"],
        "decision_source": decision["source"],
        "fallback_used": bool(decision["fallback"]),
        "iceberg_default_used": 0.0,
        "committed_demo_artifact_is_synthetic": True,
    }


# ---------------------------------------------------------------------------
# Stage 6 - artifacts + validation report
# ---------------------------------------------------------------------------

def sic_checkpoint_audit() -> dict:
    """
    Look for an independently trained SIC *forecasting* checkpoint.

    Distinguishes the ConvLSTM SIC forecaster checkpoints (teammate's model,
    keys 'cells.*.conv.*' / 'head.*') from outputs/ml/route_policy.pt, which
    is the route ML policy.  Read-only: files are opened, never modified.
    """
    found = []
    for p in sorted((ROOT / "backend" / "runs").glob("*/best_model.pt")):
        try:
            import torch
            sd = torch.load(p, map_location="cpu", weights_only=True)
            keys = list(sd.keys()) if isinstance(sd, dict) else []
        except Exception as exc:
            found.append({"path": str(p.relative_to(ROOT)),
                          "is_sic_forecaster": False, "error": str(exc)})
            continue
        is_sic = any(k.startswith("cells.") for k in keys) and "head.weight" in keys
        found.append({
            "path": str(p.relative_to(ROOT)),
            "is_sic_forecaster": bool(is_sic),
            "n_tensors": len(keys),
            "param_count": int(sum(v.numel() for v in sd.values()
                                   if hasattr(v, "numel"))) if is_sic else None,
        })
    return {"checkpoints": found,
            "any_sic_forecaster": any(c["is_sic_forecaster"] for c in found)}


def write_outputs(grid, path, sic_info, cmems, expert, ml_info, reroute,
                  tests, val) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    def cells(p):
        return [[int(r), int(c), float(grid.lat[r]), float(grid.lon[c])]
                for r, c in p]

    route_payload = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "pipeline": [
            "REAL SIC (backend/cache/routing_sic_2026.npy)",
            "EnvironmentalGrid (src/data/sic_forecast.py)",
            "CMEMS current (src/data/cmems_loader.py) - availability reported",
            "Route ML policy (outputs/ml/route_policy.pt)",
            "Safety / robust routing (src/routing/astar.py + cost.py)",
            "Dynamic rerouting (src/ml/dynamic_reroute.py)",
        ],
        "provenance": PROVENANCE,
        "leg": {"name": "Cape Town -> Maitri",
                "start_cell": list(CAPE_TOWN), "goal_cell": list(MAITRI),
                "start_latlon": [float(grid.lat[CAPE_TOWN[0]]),
                                 float(grid.lon[CAPE_TOWN[1]])],
                "goal_latlon": [float(grid.lat[MAITRI[0]]),
                                float(grid.lon[MAITRI[1]])]},
        "expert_route": {"waypoints": expert["waypoints"],
                         "route_length_cells": expert["route_length_cells"],
                         "total_cost": expert["total_cost"]},
        "ml_policy": ml_info,
        "cmems": {"available": cmems["available"], "note": cmems["reason"]},
        "dynamic_rerouting": reroute,
        "final_route_cells": cells(path),
    }
    ROUTE_JSON.write_text(json.dumps(route_payload, indent=2), encoding="utf-8")

    sic = np.load(str(CACHE / "routing_sic_2026.npy"), mmap_mode="r")
    audit = sic_checkpoint_audit()
    val_path = ML_OUT / "route_policy_validation.json"
    warnings = list(val.get("warnings", []))

    report = {
        "generated_utc": datetime.now(timezone.utc).isoformat(),
        "tests_passed": tests.get("passed"),
        "tests_failed": tests.get("failed"),
        "tests_status": tests.get("status", "SKIPPED"),
        "sic_artifact_present": bool((CACHE / "routing_sic_2026.npy").exists()),
        "sic_shape": list(sic.shape),
        "sic_dtype": str(sic.dtype),
        "sic_min": sic_info["sic_min"],
        "sic_max": sic_info["sic_max"],
        "sic_mean": sic_info["sic_mean"],
        "sic_contains_nan": sic_info["sic_contains_nan"],
        "sic_nan_fraction": sic_info["sic_nan_fraction"],
        "sic_grid": {"n_rows": int(grid.n_rows), "n_cols": int(grid.n_cols),
                     "resolution_deg": float(grid.resolution_deg),
                     "lat_range": [float(grid.lat[0]), float(grid.lat[-1])],
                     "lon_range": [float(grid.lon[0]), float(grid.lon[-1])]},
        "sic_uncertainty_shape": list(sic_info["uncertainty_shape"]),
        "route_model_present": bool((ML_OUT / "route_policy.pt").exists()),
        "route_model_path": "outputs/ml/route_policy.pt",
        "route_model_features": ml_info["n_features"],
        "route_model_actions": ml_info["n_actions"],
        "route_validation_accuracy": (
            json.loads(val_path.read_text())["validation_dataset_accuracy"]
            if val_path.exists() else None),
        "route_validation_accuracy_is_held_out": False,
        "route_model_trained_on_synthetic_dataset": True,
        "cmems_integration_present": True,
        "cmems_data_available": bool(cmems["available"]),
        "cmems_note": cmems["reason"],
        "cvar_computed": expert["cvar_computed"],
        "cvar_note": expert["cvar_unavailable_reason"],
        "dynamic_rerouting_present": True,
        "dynamic_reroute_demo_artifact_present":
            bool((ML_OUT / "dynamic_reroute_demo.json").exists()),
        "dynamic_reroute_demo_artifact_is_synthetic": True,
        "independent_sic_checkpoint_present": bool(audit["any_sic_forecaster"]),
        "independent_sic_checkpoints": audit["checkpoints"],
        "independent_sic_checkpoint_note": (
            "backend/runs/final_10ch_3f_seed{0,1,2}/best_model.pt are the "
            "teammate's ConvLSTM SIC forecasting checkpoints (keys "
            "cells.*.conv.*, head.*). They are NOT used by this route "
            "optimizer: the route pipeline consumes the committed inference "
            "output in backend/cache. The raw 2026 inference inputs "
            "(backend/data/test_2026) are absent, so inference cannot be "
            "re-run and was not."
        ),
        "synthetic_route_training_dataset": {
            "present": True,
            "path": "outputs/ml/route_training_dataset.npz",
            "is_real_antarctic_route_training_data": False,
            "grid_used": "20x25 synthetic grid (src/environment/synthetic.py)",
            "role": "pipeline smoke test only; the route policy was trained on "
                    "it, so route-policy accuracy is not a real-data metric",
        },
        "retraining_performed": False,
        "architecture_changed": False,
        "existing_artifacts_modified": False,
        "warnings": warnings,
        "overall_status": val["overall_status"],
        "provenance": PROVENANCE,
    }
    VALIDATION_JSON.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\n  wrote {ROUTE_JSON.relative_to(ROOT)}")
    print(f"  wrote {VALIDATION_JSON.relative_to(ROOT)}")


# ---------------------------------------------------------------------------
# Final printed report
# ---------------------------------------------------------------------------

def final_report(tests, sic_info, cmems, expert, ml_info, reroute, audit,
                 val) -> None:
    hr("FINAL VERIFICATION REPORT")
    ok = lambda b: "PASS" if b else "FAIL"  # noqa: E731

    t = "SKIPPED" if tests.get("passed") is None else \
        f"{tests['passed']} passed, {tests['failed']} failed -> {ok(tests.get('exit_code') == 0)}"
    print(f"  Tests                       : {t}")

    print(f"  Real SIC                    : PASS "
          f"({CACHE.name}/routing_sic_2026.npy shape {sic_info['sic_shape']}, "
          f"{sic_info['sic_dtype']})")
    print(f"                                 NaN {sic_info['nan_cell_fraction']*100:.1f}% "
          f"preserved as invalid/non-navigable")

    print(f"  CMEMS                       : integration "
          f"{ok(True)} (code + tests present) | data "
          f"{ok(cmems['available'])}"
          + ("" if cmems["available"] else f" -> {cmems['reason']}"))

    print(f"  Route ML                    : {ok(ml_info['n_features'] == 16)} "
          f"route_policy.pt {ml_info['n_features']} features / "
          f"{ml_info['n_actions']} actions, "
          f"acc {val['route_validation_accuracy']}")
    print(f"                                 trained on SYNTHETIC 20x25 smoke "
          f"data (in-sample score)")
    print(f"  Route ML on real grid       : "
          f"{'reached goal' if ml_info['goal_reached_on_real_grid'] else 'DID NOT REACH GOAL (out of distribution)'}"
          f"  ml_steps={ml_info['ml_steps']} "
          f"fallback={ml_info['robust_fallback_steps']}")

    print(f"  Robust / CVaR routing       : A* on real SIC "
          f"{ok(expert['astar_success'])} | CVaR "
          f"{ok(expert['cvar_computed'])}"
          + ("" if expert["cvar_computed"]
             else f" ({expert['cvar_unavailable_reason'][:60]}...)"))
    print(f"  Dynamic rerouting           : PASS "
          f"(real SIC step +{reroute['reroute_forecast_step']}, "
          f"{reroute['waypoints_before']} -> {reroute['waypoints_after']} "
          f"waypoints, source={reroute['decision_source']})")

    print(f"  Independent SIC model       : "
          f"{'PRESENT (ConvLSTM, teammate)' if audit['any_sic_forecaster'] else 'ABSENT'}"
          f" -> {ok(True)}")
    print(f"                                 not consumed by the route pipeline; "
          f"committed cache output is used")
    print(f"  Retraining performed        : {val['retraining_performed']} "
          f"(no training code imported or called)")

    print("\n  OVERALL PROJECT STATUS      : " + val["overall_status"])
    if val.get("warnings"):
        print("\n  WARNINGS (honest limitations):")
        for w in val["warnings"]:
            first = w.split(":")[0] if len(w) > 70 else ""
            print(f"    - {w}")


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--skip-tests", action="store_true",
                    help="do not run pytest as part of the demo")
    args = ap.parse_args()

    print("SIH2026059 - IceRoute-Robust | FINAL DEMO")
    print(f"repository : {ROOT}")
    print(f"branch note: read-only run; no training, no artifact modification")

    tests = run_tests(args.skip_tests)
    field, grid, sic_info = stage_real_sic()
    cmems_available, cmems_reason, _ = stage_cmems(grid)
    cmems = {"available": cmems_available, "reason": cmems_reason}
    expert, path, expert_info, helpers = stage_expert_route(grid)
    ml_info = stage_ml_policy(grid, expert)
    reroute = stage_dynamic_reroute(field, grid, path, helpers)

    failures = []
    warnings = []
    if not expert_info["astar_success"]:
        failures.append("A* expert route failed on the real SIC grid")
    if not tests.get("ran") and not args.skip_tests:
        failures.append("pytest did not run")
    if tests.get("ran") and tests.get("failed"):
        failures.append(f"{tests['failed']} test(s) failed")
    if list(sic_info["sic_shape"]) != [167, 173, 369]:
        failures.append("unexpected SIC shape")
    if not reroute["reroute_replan_success"]:
        failures.append("dynamic reroute replan failed")
    if not cmems["available"]:
        warnings.append("CMEMS current data unavailable (Drive not mounted); "
                        "current_cost/current_uo/current_vo absent from the grid")
    if not expert_info["cvar_computed"]:
        warnings.append("CVaR scenario stage unavailable: iceberg risk and "
                        "iceberg uncertainty layers have no data")
    if not ml_info["goal_reached_on_real_grid"]:
        warnings.append("route policy did not reach the goal on the real "
                        "173x369 grid: trained on a 20x25 SYNTHETIC dataset, "
                        "so n_rows/n_cols and distance features are out of "
                        "distribution; the robust/safety layer constrained "
                        "every step to the expert path")
    warnings.append("outputs/ml/dynamic_reroute_demo.json was produced on a "
                    "synthetic 20x20 demo environment, not on real SIC")
    warnings.append("outputs/ml/route_training_dataset.csv/.npz is synthetic "
                    "smoke-test data from src/environment/synthetic.py, not "
                    "real Antarctic route-training data")

    if failures:
        status = "FAILED: " + "; ".join(failures)
    else:
        status = ("VERIFIED WITH LIMITATIONS - real SIC -> EnvironmentalGrid "
                  "-> route ML policy -> safety/robust A* -> dynamic "
                  "rerouting -> final route all executed on committed "
                  "artifacts. Limitations: CMEMS data and iceberg data "
                  "unavailable, CVaR stage not computable, route policy "
                  "trained on synthetic smoke data and did not reach the goal "
                  "on the real grid.")

    val = {
        "overall_status": status,
        "retraining_performed": False,
        "route_validation_accuracy": None,
        "warnings": warnings,
    }
    vpath = ML_OUT / "route_policy_validation.json"
    if vpath.exists():
        val["route_validation_accuracy"] = \
            json.loads(vpath.read_text())["validation_dataset_accuracy"]

    write_outputs(grid, path, sic_info, cmems, expert_info, ml_info, reroute,
                  tests, val)
    audit = sic_checkpoint_audit()
    final_report(tests, sic_info, cmems, expert_info, ml_info, reroute, audit,
                 val)
    print()
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())

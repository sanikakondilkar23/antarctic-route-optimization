from pathlib import Path
from typing import List, Tuple, Optional

import numpy as np
import torch
from torch import nn

from src.environment.grid import EnvironmentalGrid
from src.routing.cost import CostWeights
from src.routing.scenario_router import CVaRResult


MODEL_PATH = Path("outputs/ml/route_policy.pt")

# 8-neighbour action mapping
MOVES = {
    0: (-1, -1),   # NW
    1: (-1, 0),    # N
    2: (-1, 1),    # NE
    3: (0, -1),    # W
    4: (0, 1),     # E
    5: (1, -1),    # SW
    6: (1, 0),     # S
    7: (1, 1),     # SE
}


class RoutePolicy(nn.Module):
    def __init__(self, n_features, n_actions):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(n_features, 64),
            nn.ReLU(),
            nn.Dropout(0.15),
            nn.Linear(64, 32),
            nn.ReLU(),
            nn.Linear(32, n_actions),
        )

    def forward(self, x):
        return self.net(x)


def load_route_policy():
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Route policy checkpoint not found: {MODEL_PATH}"
        )

    checkpoint = torch.load(
        MODEL_PATH,
        map_location="cpu",
        weights_only=False,
    )

    model = RoutePolicy(
        checkpoint["n_features"],
        checkpoint["n_actions"],
    )

    model.load_state_dict(checkpoint["model_state_dict"])
    model.eval()

    return model, checkpoint


def build_features(
    grid: EnvironmentalGrid,
    position: Tuple[int, int],
    goal: Tuple[int, int],
    t_hours: float,
) -> np.ndarray:

    r, c = position
    gr, gc = goal

    n_rows = grid.n_rows
    n_cols = grid.n_cols

    def value(arr, default=0.0):
        if arr is None:
            return default

        v = float(arr[r, c])

        if not np.isfinite(v):
            return default

        return v

    dist = np.sqrt(
        float((gr - r) ** 2 + (gc - c) ** 2)
    )

    max_dist = np.sqrt(
        float((n_rows - 1) ** 2 + (n_cols - 1) ** 2)
    )

    normalized_dist = (
        dist / max_dist if max_dist > 0 else 0.0
    )

    return np.array(
        [
            value(grid.sic_mean),
            value(grid.sic_uncertainty),
            value(grid.iceberg_risk),
            value(grid.iceberg_risk_uncertainty),
            value(grid.iceberg_uncertainty),
            value(grid.wind_cost),
            value(grid.current_cost),
            value(grid.current_uo),
            value(grid.current_vo),
            value(grid.depth) if hasattr(grid, "depth") else 0.0,
            normalized_dist,
            float(gr - r),
            float(gc - c),
            float(t_hours),
            float(n_rows),
            float(n_cols),
        ],
        dtype=np.float32,
    )


def predict_action(
    model,
    checkpoint,
    features: np.ndarray,
):
    mean = np.asarray(
        checkpoint["feature_mean"],
        dtype=np.float32,
    )

    std = np.asarray(
        checkpoint["feature_std"],
        dtype=np.float32,
    )

    std = np.where(std < 1e-6, 1.0, std)

    x = (features - mean) / std

    with torch.no_grad():
        logits = model(
            torch.from_numpy(x).unsqueeze(0)
        )

        probabilities = torch.softmax(
            logits,
            dim=1,
        )[0].numpy()

    action = int(np.argmax(probabilities))

    return action, float(probabilities[action]), probabilities


def cell_is_safe(
    grid: EnvironmentalGrid,
    position: Tuple[int, int],
) -> bool:

    r, c = position

    if r < 0 or r >= grid.n_rows:
        return False

    if c < 0 or c >= grid.n_cols:
        return False

    if not bool(grid.navigable[r, c]):
        return False

    if grid.sic_mean is not None:
        sic = grid.sic_mean[r, c]

        if not np.isfinite(sic):
            return False

        if sic >= 0.95:
            return False

    if grid.iceberg_risk is not None:
        risk = grid.iceberg_risk[r, c]

        if np.isfinite(risk) and risk >= 0.95:
            return False

    return True


def is_adjacent(a: Tuple[int, int], b: Tuple[int, int]) -> bool:
    return max(abs(a[0] - b[0]), abs(a[1] - b[1])) == 1


def next_position(
    position: Tuple[int, int],
    action: int,
):
    dr, dc = MOVES[action]

    return (
        position[0] + dr,
        position[1] + dc,
    )


def ml_guided_route(
    grid: EnvironmentalGrid,
    robust_result: CVaRResult,
    start: Tuple[int, int],
    goal: Tuple[int, int],
    t_hours: float = 0.0,
) -> dict:

    robust_path = robust_result.selected_path

    if not robust_path:
        return {
            "success": False,
            "reason": "CVaR robust route is empty",
            "path": [],
        }

    model, checkpoint = load_route_policy()

    current = start
    final_path = [current]

    ml_steps = 0
    robust_fallback_steps = 0

    robust_index = 0

    max_steps = max(
        len(robust_path) * 2,
        10,
    )

    for step in range(max_steps):

        if current == goal:
            break

        features = build_features(
            grid,
            current,
            goal,
            t_hours + float(step),
        )

        ml_action, confidence, probabilities = predict_action(
            model,
            checkpoint,
            features,
        )

        ml_next = next_position(
            current,
            ml_action,
        )

        # ML is allowed to move only to a safe cell
        # AND preferably toward the robust route.
        robust_set = set(robust_path)

        if (
            cell_is_safe(grid, ml_next)
            and ml_next in robust_set
        ):
            selected = ml_next
            source = "ml_policy"
            ml_steps += 1

        else:
            # Safety authority: follow the robust/CVaR route.
            source = "robust_cvar"

            robust_candidates = [
                p
                for p in robust_path
                if p not in final_path
            ]

            selected = None

            for candidate in robust_candidates:
                if cell_is_safe(grid, candidate):
                    selected = candidate
                    break

            if selected is None:
                return {
                    "success": False,
                    "reason": "No safe robust fallback cell available",
                    "path": final_path,
                }

            robust_fallback_steps += 1

        final_path.append(selected)
        current = selected

        if current == goal:
            break

    success = current == goal

    return {
        "success": success,
        "path": final_path,
        "ml_steps": ml_steps,
        "robust_fallback_steps": robust_fallback_steps,
        "path_length_cells": len(final_path),
        "goal_reached": current == goal,
    }


def summarize(
    result: dict,
):
    return {
        "success": bool(result.get("success", False)),
        "goal_reached": bool(result.get("goal_reached", False)),
        "path_length_cells": int(
            result.get("path_length_cells", 0)
        ),
        "ml_steps": int(
            result.get("ml_steps", 0)
        ),
        "robust_fallback_steps": int(
            result.get("robust_fallback_steps", 0)
        ),
    }

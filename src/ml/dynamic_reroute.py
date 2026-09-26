from pathlib import Path
import json
import numpy as np
import torch
from torch import nn


MODEL_PATH = Path("outputs/ml/route_policy.pt")
OUT_PATH = Path("outputs/ml/dynamic_reroute_demo.json")


# 8-neighbor movement:
# 0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW
MOVES = np.array([
    [-1,  0],
    [-1,  1],
    [ 0,  1],
    [ 1,  1],
    [ 1,  0],
    [ 1, -1],
    [ 0, -1],
    [-1, -1],
], dtype=np.int32)


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


def load_policy():
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


def predict_action(model, checkpoint, feature_vector):
    mean = np.asarray(
        checkpoint["feature_mean"],
        dtype=np.float32,
    )

    std = np.asarray(
        checkpoint["feature_std"],
        dtype=np.float32,
    )

    x = np.asarray(
        feature_vector,
        dtype=np.float32,
    )

    x = (x - mean) / std

    with torch.no_grad():
        logits = model(torch.from_numpy(x).unsqueeze(0))
        probabilities = torch.softmax(logits, dim=1)[0]
        action = int(probabilities.argmax().item())
        confidence = float(probabilities[action].item())

    return action, confidence, probabilities.numpy()


def is_safe_move(
    current_row,
    current_col,
    action,
    n_rows,
    n_cols,
    navigable,
    sic_mean,
    iceberg_risk,
):
    dr, dc = MOVES[action]

    nr = current_row + int(dr)
    nc = current_col + int(dc)

    if nr < 0 or nr >= n_rows:
        return False

    if nc < 0 or nc >= n_cols:
        return False

    if not navigable[nr, nc]:
        return False

    # Conservative safety thresholds.
    # These are routing safeguards, not claimed scientific limits.
    if np.isfinite(sic_mean[nr, nc]) and sic_mean[nr, nc] >= 0.95:
        return False

    if np.isfinite(iceberg_risk[nr, nc]) and iceberg_risk[nr, nc] >= 0.95:
        return False

    return True


def choose_safe_action(
    model,
    checkpoint,
    feature_vector,
    current_row,
    current_col,
    n_rows,
    n_cols,
    navigable,
    sic_mean,
    iceberg_risk,
):
    action, confidence, probabilities = predict_action(
        model,
        checkpoint,
        feature_vector,
    )

    if is_safe_move(
        current_row,
        current_col,
        action,
        n_rows,
        n_cols,
        navigable,
        sic_mean,
        iceberg_risk,
    ):
        return {
            "action": action,
            "confidence": confidence,
            "source": "ml_policy",
            "fallback": False,
        }

    # ML suggestion is unsafe.
    # Select the highest-probability safe alternative.
    ranked = np.argsort(probabilities)[::-1]

    for candidate in ranked:
        candidate = int(candidate)

        if is_safe_move(
            current_row,
            current_col,
            candidate,
            n_rows,
            n_cols,
            navigable,
            sic_mean,
            iceberg_risk,
        ):
            return {
                "action": candidate,
                "confidence": float(probabilities[candidate]),
                "source": "safe_fallback",
                "fallback": True,
            }

    return {
        "action": None,
        "confidence": 0.0,
        "source": "robust_optimizer_required",
        "fallback": True,
    }


def main():
    if not MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Missing model: {MODEL_PATH}"
        )

    model, checkpoint = load_policy()

    n_rows = 20
    n_cols = 20

    navigable = np.ones(
        (n_rows, n_cols),
        dtype=bool,
    )

    sic_mean = np.full(
        (n_rows, n_cols),
        0.20,
        dtype=np.float32,
    )

    iceberg_risk = np.zeros(
        (n_rows, n_cols),
        dtype=np.float32,
    )

    # Artificial unsafe area for the demo.
    sic_mean[9:12, 10:13] = 0.99
    iceberg_risk[5:8, 14:17] = 0.99

    feature_vector = np.array([
        0.20,   # sic_mean
        0.05,   # sic_uncertainty
        0.10,   # iceberg_risk
        0.03,   # iceberg_risk_uncertainty
        0.04,   # iceberg_uncertainty
        0.10,   # wind_cost
        0.10,   # current_cost
        0.20,   # current_uo
        0.05,   # current_vo
        500.0,  # depth
        0.50,   # normalized_dist_to_goal
        0.10,   # rel_row_to_goal
        0.10,   # rel_col_to_goal
        12.0,   # t_hours
        float(n_rows),
        float(n_cols),
    ], dtype=np.float32)

    current_row = 10
    current_col = 10

    result = choose_safe_action(
        model,
        checkpoint,
        feature_vector,
        current_row,
        current_col,
        n_rows,
        n_cols,
        navigable,
        sic_mean,
        iceberg_risk,
    )

    output = {
        "current_position": [
            current_row,
            current_col,
        ],
        "selected_action": result["action"],
        "confidence": result["confidence"],
        "decision_source": result["source"],
        "ml_fallback_used": result["fallback"],
        "environment_updated": True,
        "safety_validation": True,
        "note": (
            "Demo dynamic re-routing controller. "
            "Real deployment must replace demo arrays with "
            "the actual SIC, iceberg and CMEMS environment."
        ),
    }

    OUT_PATH.parent.mkdir(
        parents=True,
        exist_ok=True,
    )

    with open(
        OUT_PATH,
        "w",
        encoding="utf-8",
    ) as f:
        json.dump(output, f, indent=2)

    print()
    print("DYNAMIC RE-ROUTING DEMO COMPLETE")
    print(f"Current position : {output['current_position']}")
    print(f"Selected action  : {output['selected_action']}")
    print(f"Confidence       : {output['confidence']:.4f}")
    print(f"Decision source  : {output['decision_source']}")
    print(f"Fallback used    : {output['ml_fallback_used']}")
    print(f"Output           : {OUT_PATH}")


if __name__ == "__main__":
    main()

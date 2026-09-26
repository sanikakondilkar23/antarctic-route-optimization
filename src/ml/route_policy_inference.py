from pathlib import Path
import json
import numpy as np
import torch
from torch import nn


MODEL_PATH = Path("outputs/ml/route_policy.pt")
DATA_PATH = Path("outputs/ml/route_training_dataset.npz")
OUT_PATH = Path("outputs/ml/route_policy_validation.json")


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


def load_model():
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


def predict_actions(model, checkpoint, X):
    mean = np.asarray(checkpoint["feature_mean"], dtype=np.float32)
    std = np.asarray(checkpoint["feature_std"], dtype=np.float32)

    Xn = (X.astype(np.float32) - mean) / std

    with torch.no_grad():
        logits = model(torch.from_numpy(Xn))
        probabilities = torch.softmax(logits, dim=1)
        actions = probabilities.argmax(dim=1)

    return (
        actions.numpy(),
        probabilities.numpy(),
    )


def main():
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Model not found: {MODEL_PATH}")

    if not DATA_PATH.exists():
        raise FileNotFoundError(f"Dataset not found: {DATA_PATH}")

    model, checkpoint = load_model()

    data = np.load(DATA_PATH, allow_pickle=True)

    X = data["features"].astype(np.float32)
    y = data["actions"].astype(np.int64)

    predicted, probabilities = predict_actions(
        model,
        checkpoint,
        X,
    )

    accuracy = float(np.mean(predicted == y))

    confidence = probabilities.max(axis=1)

    result = {
        "model": str(MODEL_PATH),
        "dataset": str(DATA_PATH),
        "n_samples": int(len(X)),
        "n_features": int(X.shape[1]),
        "n_actions": int(checkpoint["n_actions"]),
        "validation_dataset_accuracy": accuracy,
        "mean_prediction_confidence": float(confidence.mean()),
        "min_prediction_confidence": float(confidence.min()),
        "max_prediction_confidence": float(confidence.max()),
        "feature_names": data["feature_names"].tolist(),
        "action_distribution_true": {
            str(int(k)): int(v)
            for k, v in zip(*np.unique(y, return_counts=True))
        },
        "action_distribution_predicted": {
            str(int(k)): int(v)
            for k, v in zip(*np.unique(predicted, return_counts=True))
        },
        "safety_note": (
            "ML policy is an expert-policy predictor. "
            "It must be validated against navigability, SIC, iceberg risk, "
            "current effects and robust/CVaR routing before deployment."
        ),
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2)

    print()
    print("ML INFERENCE + VALIDATION COMPLETE")
    print(f"Samples tested       : {len(X)}")
    print(f"Features             : {X.shape[1]}")
    print(f"Actions              : {checkpoint['n_actions']}")
    print(f"Dataset accuracy     : {accuracy:.4f}")
    print(f"Mean confidence      : {confidence.mean():.4f}")
    print(f"Output               : {OUT_PATH}")


if __name__ == "__main__":
    main()

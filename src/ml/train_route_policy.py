from pathlib import Path
import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

DATA = Path("outputs/ml/route_training_dataset.npz")
OUT = Path("outputs/ml/route_policy.pt")

SEED = 42
BATCH_SIZE = 32
EPOCHS = 80
LR = 1e-3


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


def main():
    if not DATA.exists():
        raise FileNotFoundError(f"Dataset not found: {DATA}")

    torch.manual_seed(SEED)
    np.random.seed(SEED)

    data = np.load(DATA, allow_pickle=True)

    X = data["features"].astype(np.float32)
    y = data["actions"].astype(np.int64)
    feature_names = data["feature_names"].tolist()

    n = len(X)
    n_features = X.shape[1]
    n_actions = int(y.max()) + 1

    print(f"Dataset: {DATA}")
    print(f"Samples: {n}")
    print(f"Features: {n_features}")
    print(f"Actions: {n_actions}")
    print(f"Feature names: {feature_names}")

    rng = np.random.default_rng(SEED)
    idx = rng.permutation(n)

    split = int(0.8 * n)
    train_idx = idx[:split]
    val_idx = idx[split:]

    X_train = X[train_idx]
    y_train = y[train_idx]
    X_val = X[val_idx]
    y_val = y[val_idx]

    mean = X_train.mean(axis=0)
    std = X_train.std(axis=0)
    std[std < 1e-6] = 1.0

    X_train = (X_train - mean) / std
    X_val = (X_val - mean) / std

    train_ds = TensorDataset(
        torch.from_numpy(X_train),
        torch.from_numpy(y_train),
    )
    val_ds = TensorDataset(
        torch.from_numpy(X_val),
        torch.from_numpy(y_val),
    )

    train_loader = DataLoader(
        train_ds,
        batch_size=BATCH_SIZE,
        shuffle=True,
    )

    model = RoutePolicy(n_features, n_actions)

    counts = np.bincount(y_train, minlength=n_actions).astype(np.float32)
    counts[counts == 0] = 1.0
    weights = counts.sum() / (n_actions * counts)

    criterion = nn.CrossEntropyLoss(
        weight=torch.tensor(weights, dtype=torch.float32)
    )

    optimizer = torch.optim.Adam(
        model.parameters(),
        lr=LR,
        weight_decay=1e-4,
    )

    best_acc = -1.0
    best_state = None

    for epoch in range(1, EPOCHS + 1):
        model.train()

        for xb, yb in train_loader:
            optimizer.zero_grad()
            logits = model(xb)
            loss = criterion(logits, yb)
            loss.backward()
            optimizer.step()

        model.eval()
        with torch.no_grad():
            val_logits = model(torch.from_numpy(X_val))
            val_pred = val_logits.argmax(dim=1).numpy()
            val_acc = float((val_pred == y_val).mean())

        if val_acc > best_acc:
            best_acc = val_acc
            best_state = {
                k: v.cpu().clone()
                for k, v in model.state_dict().items()
            }

        if epoch == 1 or epoch % 10 == 0:
            print(f"Epoch {epoch:03d}/{EPOCHS} | val_acc={val_acc:.4f}")

    model.load_state_dict(best_state)

    OUT.parent.mkdir(parents=True, exist_ok=True)

    torch.save(
        {
            "model_state_dict": model.state_dict(),
            "feature_names": feature_names,
            "feature_mean": mean,
            "feature_std": std,
            "n_features": n_features,
            "n_actions": n_actions,
            "best_val_accuracy": best_acc,
            "seed": SEED,
        },
        OUT,
    )

    print()
    print("TRAINING COMPLETE")
    print(f"Best validation accuracy: {best_acc:.4f}")
    print(f"Saved model: {OUT}")


if __name__ == "__main__":
    main()

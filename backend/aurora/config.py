"""
config.py — AURORA service configuration.

Every path is resolved from an environment variable with a repository-relative
default. Nothing is hardcoded to an absolute path, so the service runs
unchanged on Windows, Linux, macOS, Colab or a container.

Environment variables
---------------------
AURORA_CORS_ORIGINS     Comma-separated allowed origins. Defaults to the Vite
                        dev/preview origins plus the deployed site.
AURORA_RASTER_MAX_WIDTH Maximum width for rasterized grid responses;
                        0 = full resolution. The routing grid is only 173x369,
                        so the default keeps every value intact.
AURORA_SIC_MODEL_DIR    Directory holding the three ConvLSTM run folders.
                        Defaults to backend/runs.
AURORA_REROUTE_STEP     Default forecast-day step used by the reroute
                        convenience endpoint when no step is given.
"""

from __future__ import annotations

import os
from pathlib import Path

PRODUCT_NAME = "AURORA"
PRODUCT_LONG_NAME = "Antarctic Unified Routing & Operational Risk Analytics"
PRODUCT_VERSION = "1.0.0"

# backend/aurora/config.py -> backend/aurora -> backend -> repo root
BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent

#: The trained ConvLSTMForecaster architecture lives in backend/src/model.py.
SIC_SRC_DIR = BACKEND_DIR / "src"
SIC_MODEL_CLASS = "ConvLSTMForecaster"

#: Frozen 2026 model-output arrays, produced by backend/scripts/inference_2026.py.
ARTIFACT_DIR = BACKEND_DIR / "cache"

#: Verified route artifact from outputs/final_demo/final_route.json.
OUTPUTS_DIR = REPO_ROOT / "outputs"

#: Real Antarctic coastline geometry (Natural Earth), map context only.
COASTLINE_JSON = REPO_ROOT / "frontend" / "data" / "coastline.json"

# --- SIC ensemble identity, verified against backend/src/model.py -------------
#: ConvLSTM band = lat -75..-50, lon -10..80 at 0.25 deg.
SIC_MODEL_LAT_RANGE = (-75.0, -50.0)
SIC_MODEL_LON_RANGE = (-10.0, 80.0)
SIC_IN_CHANNELS = 10
SIC_LOOKBACK = 5
SIC_HORIZONS = 3
SIC_SEEDS = 3
SIC_MC_PASSES = 20
SIC_MC_DROPOUT_P = 0.1
SIC_PARAM_COUNT = 270_147
SIC_CHECKPOINT_RUNS = (
    "final_10ch_3f_seed0",
    "final_10ch_3f_seed1",
    "final_10ch_3f_seed2",
)
SIC_CHECKPOINT_FILENAME = "best_model.pt"

#: 10-channel input stack, in the order backend/scripts/preprocess_2026.py builds
#: it. Sourced from backend/scripts/preprocess.py channel construction.
SIC_INPUT_CHANNELS = (
    "sic",
    "u10",
    "v10",
    "t2m",
    "uo",
    "vo",
    "thetao",
    "so",
    "zos",
    "sic_prev_year",
)

#: Confidence class codes, from backend/scripts/inference_2026.py.
CLASS_HIGH = 0
CLASS_MEDIUM = 1
CLASS_LOW = 2
CLASS_MASKED = 255
CLASS_LABELS = {
    CLASS_HIGH: "high",
    CLASS_MEDIUM: "medium",
    CLASS_LOW: "low",
    CLASS_MASKED: "masked",
}

#: Station approach goals, read at runtime from the committed
#: backend/cache/routing_station_goals.json. Those are the only station
#: coordinates this repository has verified; nothing here is invented.
STATION_GOALS_JSON = ARTIFACT_DIR / "routing_station_goals.json"

#: Cape Town's own 0.25 deg cell on the routing grid, identified in
#: backend/api/main.py. The real GEBCO land mask marks (164, 114) as land, so
#: A* cannot start there and the route planner snaps to the neighbouring ocean
#: cell. Both facts are reported back to the caller rather than hidden.
CAPETOWN_CELL = (164, 114)
CAPETOWN_OCEAN_CELL = (163, 114)

#: The project's one verified end-to-end baseline leg, from
#: outputs/final_demo/final_route.json.
VERIFIED_LEG_JSON = OUTPUTS_DIR / "final_demo" / "final_route.json"


def _env_path(name: str, default: Path) -> Path:
    raw = os.environ.get(name, "").strip()
    return Path(raw).expanduser().resolve() if raw else default.resolve()


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def sic_model_dir() -> Path:
    """Directory containing the three ConvLSTM run folders."""
    return _env_path("AURORA_SIC_MODEL_DIR", BACKEND_DIR / "runs")


def sic_checkpoint_paths() -> list[Path]:
    return [
        sic_model_dir() / run / SIC_CHECKPOINT_FILENAME
        for run in SIC_CHECKPOINT_RUNS
    ]


def cors_origins() -> list[str]:
    raw = os.environ.get("AURORA_CORS_ORIGINS", "").strip()
    if raw:
        return [o.strip() for o in raw.split(",") if o.strip()]
    return [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
        "https://frontend-pearl-nine-74.vercel.app",
    ]


def raster_max_width() -> int:
    """Maximum raster width; 0 or negative means full resolution."""
    try:
        return int(os.environ.get("AURORA_RASTER_MAX_WIDTH", "0"))
    except ValueError:
        return 0


def default_reroute_step() -> int:
    """Forecast-day step for the reroute convenience endpoint."""
    try:
        return int(os.environ.get("AURORA_REROUTE_STEP", "14"))
    except ValueError:
        return 14

"""
Canonical data-root resolution for every environmental layer.

This module is the ONLY place in the project that decides where external
datasets live.  Loaders must not build paths themselves and must never
hardcode a Colab mount point.

Resolution order
----------------
1. ``SIH_DATA_ROOT``                     -- the dataset root (Colab:
   ``/content/drive/MyDrive/SIH_26_Sanika/dataset``; any synced/mounted
   equivalent elsewhere).
2. A per-layer override environment variable (see ``LAYER_ENV_OVERRIDES``),
   which points directly at one dataset.
3. Nothing.

If none of those resolve, the layer is reported ``NOT_AVAILABLE`` together
with every path that was searched.  A missing dataset is NEVER replaced by a
synthetic, local or demo substitute -- see ``src/data/layer_status.py``.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Dict, List, Optional

#: Repository root (the directory that contains ``src/`` and ``backend/``).
REPO_ROOT = Path(__file__).resolve().parents[2]

#: Primary environment variable holding the dataset root.
DATA_ROOT_ENVVAR = "SIH_DATA_ROOT"

#: Canonical sub-directory of each dataset root, keyed by logical layer.
#: These are the directory names under ``SIH_DATA_ROOT``.
DATASET_DIRS: Dict[str, str] = {
    "sic": "SIC",
    "cmems_future": "CMEMS_Future_Forecast",
    "cmems_phy": "CMEMS_PHY",
    "copernicus_ocean": "Copernicus_Ocean",
    "era5": "ERA5",
    "ecmwf_ens": "ECMWF_ENS",
    "gebco": "GEBCO",
    "icebergs": "ICEBERGS",
    "osi_saf": "OSI_SAF",
    "ais": "AIS",
    "amsr2": "AMSR2",
    "vessel": "Vessel",
}

#: Direct-path override per layer, checked before ``SIH_DATA_ROOT``.
LAYER_ENV_OVERRIDES: Dict[str, str] = {
    "cmems_future": "SIH_CMEMS_FUTURE_ROOT",
    "copernicus_ocean": "ARCTIC_CMEMS_ROOT",
    "cmems_phy": "SIH_CMEMS_PHY_ROOT",
    "icebergs": "SIH_ICEBERG_PATH",
    "era5": "SIH_ERA5_ROOT",
    "ecmwf_ens": "SIH_ECMWF_ROOT",
    "gebco": "SIH_GEBCO_PATH",
    "sic": "SIH_SIC_ROOT",
}


def data_root() -> Optional[Path]:
    """Return the configured dataset root, or ``None`` when unset."""
    raw = os.environ.get(DATA_ROOT_ENVVAR)
    if not raw:
        return None
    return Path(raw).expanduser()


def layer_path(layer: str) -> Optional[Path]:
    """
    Best candidate path for one logical layer.

    Returns the per-layer override if set, else ``<data_root>/<dir>``, else
    ``None``.  Existence is NOT checked here; callers use :func:`describe`.
    """
    override = LAYER_ENV_OVERRIDES.get(layer)
    if override:
        raw = os.environ.get(override)
        if raw:
            return Path(raw).expanduser()

    sub = DATASET_DIRS.get(layer)
    if sub is None:
        return None

    root = data_root()
    if root is None:
        return None
    return root / sub


def searched_paths(layer: str) -> List[str]:
    """Every location that was inspected for ``layer``, for error messages."""
    out: List[str] = []
    override = LAYER_ENV_OVERRIDES.get(layer)
    if override:
        out.append(f"${override}")
    if data_root() is not None and DATASET_DIRS.get(layer):
        out.append(str(data_root() / DATASET_DIRS[layer]))
    if not out:
        out.append(f"${DATA_ROOT_ENVVAR} (unset)")
    return out


def describe(layer: str) -> Dict[str, object]:
    """
    Availability record for one layer.

    Keys: ``layer``, ``configured``, ``path``, ``exists``, ``searched``,
    ``data_root``.
    """
    path = layer_path(layer)
    root = data_root()
    record: Dict[str, object] = {
        "layer": layer,
        "data_root": str(root) if root else None,
        "configured": path is not None,
        "path": str(path) if path else None,
        "exists": bool(path.is_dir()) if path is not None else False,
        "searched": searched_paths(layer),
    }
    return record


def describe_all() -> Dict[str, Dict[str, object]]:
    """Availability record for every logical layer."""
    return {name: describe(name) for name in sorted(DATASET_DIRS)}

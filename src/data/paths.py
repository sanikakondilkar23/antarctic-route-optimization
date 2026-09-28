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

#: Where the project's dataset actually lives on Google Drive. This is a
#: genuine Google-Colab mount point, not a placeholder: Colab mounts Drive at
#: /content/drive, so this path is correct whenever the code runs in Colab with
#: Drive attached. It is only ever used when that mount actually exists — a
#: non-Colab runtime never resolves it and therefore never invents a root.
DRIVE_ROOT = Path("/content/drive")
DRIVE_DATASET_ROOT = DRIVE_ROOT / "MyDrive" / "SIH_26_Sanika" / "dataset"

#: Human-readable statement of where the data is expected. Surfaced by the
#: validation report so a missing root is never mistaken for missing data.
DATASET_LOCATION_HINT = (
    "My Drive/SIH_26_Sanika/dataset  "
    "(Google Colab mount: /content/drive/MyDrive/SIH_26_Sanika/dataset)"
)

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
    # The Drive tree ships this as AIS_GFW (Global Fishing Watch), not AIS.
    "ais": "AIS_GFW",
    "amsr2": "AMSR2",
    "vessel": "Vessel",
}

#: Directory names accepted for a layer, in preference order. The Drive export
#: is not perfectly consistent (AIS vs AIS_GFW), so a layer may have aliases.
#: All of them must resolve under the dataset root; none is invented.
DATASET_DIR_ALIASES: Dict[str, List[str]] = {
    "ais": ["AIS_GFW", "AIS"],
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
    """
    Return the configured dataset root, or ``None`` when none is reachable.

    Order:
      1. ``$SIH_DATA_ROOT`` — always wins if set.
      2. The Google Drive mount, but ONLY when ``/content/drive`` really is a
         directory (i.e. we are in Colab with Drive attached). A runtime
         without that mount resolves to ``None`` rather than to a path that
         does not exist.
    """
    raw = os.environ.get(DATA_ROOT_ENVVAR)
    if raw:
        return Path(raw).expanduser()
    if DRIVE_ROOT.is_dir():
        return DRIVE_DATASET_ROOT
    return None


def data_root_source() -> str:
    """How :func:`data_root` was resolved, for provenance in reports."""
    if os.environ.get(DATA_ROOT_ENVVAR):
        return f"${DATA_ROOT_ENVVAR}"
    if DRIVE_ROOT.is_dir():
        return "google drive mount (/content/drive)"
    return "unresolved"


def root_candidates() -> List[str]:
    """Every root that would be accepted, whether or not it exists here."""
    out = [f"${DATA_ROOT_ENVVAR}"]
    if DRIVE_ROOT.is_dir():
        out.append(str(DRIVE_DATASET_ROOT))
    else:
        out.append(f"{DRIVE_DATASET_ROOT}  (absent: /content/drive not mounted)")
    return out


def layer_dirs(layer: str) -> List[str]:
    """Accepted directory names for a layer, in preference order."""
    aliases = DATASET_DIR_ALIASES.get(layer)
    if aliases:
        return list(aliases)
    sub = DATASET_DIRS.get(layer)
    return [sub] if sub else []


def layer_path(layer: str) -> Optional[Path]:
    """
    Best candidate path for one logical layer.

    Returns the per-layer override if set, else the first existing
    ``<data_root>/<alias>``, else the first alias.  A non-existent path is
    still returned so callers can report where they looked; use
    :func:`describe` to get the ``exists`` flag.
    """
    override = LAYER_ENV_OVERRIDES.get(layer)
    if override:
        raw = os.environ.get(override)
        if raw:
            return Path(raw).expanduser()

    root = data_root()
    if root is None:
        return None
    candidates = [root / d for d in layer_dirs(layer)]
    for c in candidates:
        if c.is_dir():
            return c
    return candidates[0] if candidates else None


def searched_paths(layer: str) -> List[str]:
    """Every location that was inspected for ``layer``, for error messages."""
    out: List[str] = []
    override = LAYER_ENV_OVERRIDES.get(layer)
    if override:
        out.append(f"${override}")
    root = data_root()
    if root is not None:
        out.extend(str(root / d) for d in layer_dirs(layer))
    if not out:
        out.append(f"${DATA_ROOT_ENVVAR} (unset) and "
                   f"{DRIVE_DATASET_ROOT} (no Drive mount)")
    return out


def describe(layer: str) -> Dict[str, object]:
    """
    Availability record for one layer.

    Keys: ``layer``, ``configured``, ``path``, ``exists``, ``searched``,
    ``data_root``, ``data_root_source``, ``dataset_location``.
    """
    path = layer_path(layer)
    root = data_root()
    record: Dict[str, object] = {
        "layer": layer,
        "data_root": str(root) if root else None,
        "data_root_source": data_root_source(),
        "dataset_location": DATASET_LOCATION_HINT,
        "configured": path is not None,
        "path": str(path) if path else None,
        "exists": bool(path.is_dir()) if path is not None else False,
        "searched": searched_paths(layer),
    }
    return record


def describe_all() -> Dict[str, Dict[str, object]]:
    """Availability record for every logical layer."""
    return {name: describe(name) for name in sorted(DATASET_DIRS)}

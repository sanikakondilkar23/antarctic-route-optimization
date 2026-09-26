"""
SIC Forecast Adapter (2026 routing artifacts)
============================================

Loads the teammate's *already-computed* 2026 SIC forecast artifacts from
``backend/cache/`` and exposes them as the existing
:class:`~src.environment.grid.EnvironmentalGrid` layers ``sic_mean`` and
``sic_uncertainty``.

This module is an *upstream inference consumer* only.  It does not train,
modify, re-run, or re-implement anything from the SIC forecasting model,
and it never fabricates SIC input data.

Artifacts consumed (all optional except the SIC grid / coordinates /
metadata, which are required)::

    routing_sic_2026.npy        (n_time, 173, 369) float32  day-1 SIC point estimate
    uncertainty_2026.npy        (n_time, 3, 101, 361) float32 combined ensemble + MC std
    routing_lat.npy             (173,)   lat -75.00 .. -32.00, 0.25 deg
    routing_lon.npy             (369,)   lon -10.00 ..  82.00, 0.25 deg
    dates_2026.npy              (n_time,) datetime64[ns] daily stamps
    routing_metadata.json                 band definitions and multipliers
    valid_mask.npy               (101, 361) bool, model-band land/ice-shelf mask
    routing_multiplier_2026.npy  (n_time, 173, 369) float32, read-only accessor

.. warning::
   ``uncertainty_2026.npy`` is **not** ``(n_time, 173, 369)``.  It is
   ``(n_time, 3, 101, 361)``: three forecast horizons (D+1, D+2, D+3) over
   the *model band* only (rows 0:101, cols 0:361).  The extension band and
   the longitude-extension columns have no model uncertainty, so they are
   NaN after expansion.  See ``routing_metadata.json`` -> ``notes_lon_domain``.

NaN policy
----------
NaN means *invalid / impassable* and is preserved exactly.  Nothing in this
module substitutes 0.0 for a missing value, interpolates across it, or
clips it.  ``load()`` marks NaN cells non-navigable so the existing A* /
TD-A* implementations (which already skip ``navigable == False``) never
evaluate a cost there.  No routing, cost, scenario, CVaR, or CMEMS module
is modified by this integration.

Uncertainty semantics
---------------------
``sic_uncertainty`` carries the *raw* combined ensemble + MC-dropout
standard deviation that the teammate's inference wrote to
``uncertainty_2026.npy``.  The project's conformal 90% interval half-widths
are a separate quantity, frozen in ``metrics_2025.json`` and applied only in
``backend/scripts/inference_2026.py``; ``ensemble_2026.npy`` is not present
in ``backend/cache/``.  This module therefore makes **no** coverage or
calibration claim: the values are the artefact's raw spread, and are fed to
``src/uncertainty/scenarios.py`` as the standard deviation of its documented
Gaussian perturbation.

Multiplier
----------
``routing_multiplier_2026.npy`` is the committed POLARIS-style ice-cost
heuristic (open 1.0, marginal 2.0, moderate 8.0, hard 50.0, impassable
``inf``), used by the legacy backend router that reads
``routing_cost_x/y_2026.npy`` directly.  ``src/routing/cost.py`` instead
uses a linear ``w_sic * sic_mean`` term and ``EnvironmentalGrid`` has no
multiplier layer, so the multiplier is exposed here as a **read-only
accessor** and is never injected into the grid or the cost weights.

Usage::

    from datetime import datetime, timezone
    from src.data.sic_forecast import SICForecastField

    field = SICForecastField(
        cache_dir="backend/cache",
        route_start_datetime=datetime(2026, 1, 6, tzinfo=timezone.utc),
    )
    grid = field.load(t_hours=0.0, grid_template=grid_template)
    grid.sic_mean, grid.sic_uncertainty   # NaN preserved

or, through the existing builder plumbing::

    from src.data.builder import build_env_fn_from_adapters
    from src.data.adapters import CMEMSDateAwareAdapter

    env_fn = build_env_fn_from_adapters(
        grid_template,
        [field, CMEMSDateAwareAdapter(cmems_root, start_dt)],
    )
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import numpy as np

from src.data.adapters import BaseAdapter
from src.environment.grid import EnvironmentalGrid

# Default artifact filenames (overridable per instance)
SIC_FILENAME = "routing_sic_2026.npy"
UNCERTAINTY_FILENAME = "uncertainty_2026.npy"
LAT_FILENAME = "routing_lat.npy"
LON_FILENAME = "routing_lon.npy"
DATES_FILENAME = "dates_2026.npy"
METADATA_FILENAME = "routing_metadata.json"
VALID_MASK_FILENAME = "valid_mask.npy"
MULTIPLIER_FILENAME = "routing_multiplier_2026.npy"

# Coordinate snap tolerance: half of one grid cell.
_COORD_TOL = 1e-3
_RANGE_TOL = 1e-3


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SICForecastMetadata:
    """
    Parsed ``routing_metadata.json``.

    Band indices are read from the file, never hardcoded, so a future
    rebuild of the routing grid is picked up automatically.
    """

    grid_shape: Tuple[int, int]
    resolution_deg: float
    lat_range: Tuple[float, float]
    lon_range: Tuple[float, float]
    model_band_rows: Tuple[int, int]
    extension_band_rows: Tuple[int, int]
    model_band_cols: Tuple[int, int]
    lon_extension_cols: Tuple[int, int]
    polaris_multipliers: Dict[str, Any]
    notes_lon_domain: str
    raw: Dict[str, Any]

    @classmethod
    def from_json(cls, path) -> "SICForecastMetadata":
        with open(str(path), "r", encoding="utf-8") as f:
            raw = json.load(f)
        return cls(
            grid_shape=tuple(raw["grid_shape"]),
            resolution_deg=float(raw["resolution_deg"]),
            lat_range=tuple(raw["lat_range"]),
            lon_range=tuple(raw["lon_range"]),
            model_band_rows=tuple(raw["model_band_rows"]),
            extension_band_rows=tuple(raw["extension_band_rows"]),
            model_band_cols=tuple(raw["model_band_cols"]),
            lon_extension_cols=tuple(raw["lon_extension_cols"]),
            polaris_multipliers=raw.get("polaris_multipliers", {}),
            notes_lon_domain=raw.get("notes_lon_domain", ""),
            raw=raw,
        )

    @property
    def n_rows(self) -> int:
        return int(self.grid_shape[0])

    @property
    def n_cols(self) -> int:
        return int(self.grid_shape[1])

    @property
    def model_band_shape(self) -> Tuple[int, int]:
        """(rows, cols) of the region the SIC model actually covers."""
        return (
            int(self.model_band_rows[1] - self.model_band_rows[0]),
            int(self.model_band_cols[1] - self.model_band_cols[0]),
        )


# ---------------------------------------------------------------------------
# Adapter
# ---------------------------------------------------------------------------

class SICForecastField(BaseAdapter):
    """
    Adapter for the teammate's committed 2026 SIC forecast artifacts.

    Parameters
    ----------
    cache_dir : str
        Directory holding the ``.npy`` artifacts (normally ``backend/cache``).
    route_start_datetime : datetime, optional
        Explicit time origin used to convert ``t_hours`` (hours since
        departure) into a forecast date.  Never hidden: required for
        ``load(t_hours, ...)``.
    horizon : int
        Which uncertainty horizon fills ``EnvironmentalGrid.sic_uncertainty``.
        ``0`` = D+1 (the default, matching the day-1 SIC grid), ``1`` = D+2,
        ``2`` = D+3.
    sic_filename, uncertainty_filename, lat_filename, lon_filename,
    dates_filename, metadata_filename, valid_mask_filename,
    multiplier_filename : str
        Artifact filenames; overridable for testing.
    require_valid_mask : bool
        If True, a missing ``valid_mask.npy`` raises instead of degrading.
    """

    def __init__(
        self,
        cache_dir: Optional[str] = None,
        route_start_datetime: Optional[datetime] = None,
        horizon: int = 0,
        sic_filename: str = SIC_FILENAME,
        uncertainty_filename: str = UNCERTAINTY_FILENAME,
        lat_filename: str = LAT_FILENAME,
        lon_filename: str = LON_FILENAME,
        dates_filename: str = DATES_FILENAME,
        metadata_filename: str = METADATA_FILENAME,
        valid_mask_filename: str = VALID_MASK_FILENAME,
        multiplier_filename: str = MULTIPLIER_FILENAME,
        require_valid_mask: bool = False,
    ):
        super().__init__(path=cache_dir)
        self._route_start_datetime = route_start_datetime
        self._horizon = int(horizon)
        self._files = {
            "sic": sic_filename,
            "uncertainty": uncertainty_filename,
            "lat": lat_filename,
            "lon": lon_filename,
            "dates": dates_filename,
            "metadata": metadata_filename,
            "valid_mask": valid_mask_filename,
            "multiplier": multiplier_filename,
        }
        self._require_valid_mask = require_valid_mask

        self._metadata: Optional[SICForecastMetadata] = None
        self._sic: Optional[np.ndarray] = None          # (n_time, 173, 369)
        self._uncertainty: Optional[np.ndarray] = None  # (n_time, 3, 101, 361)
        self._lat: Optional[np.ndarray] = None          # (173,)
        self._lon: Optional[np.ndarray] = None          # (369,)
        self._dates: Optional[np.ndarray] = None         # (n_time,) datetime64
        self._valid_mask: Optional[np.ndarray] = None   # (101, 361) bool
        self._multiplier: Optional[np.ndarray] = None   # (n_time, 173, 369)
        self._loaded = False

    # -- availability ----------------------------------------------------

    def is_available(self) -> bool:
        if self._path is None:
            return False
        cache = Path(self._path)
        if not cache.exists():
            return False
        for key in ("sic", "uncertainty", "lat", "lon", "dates", "metadata"):
            if not (cache / self._files[key]).exists():
                return False
        return True

    def describe(self) -> Dict[str, Any]:
        """Return a summary dict of the loaded artifacts (shapes/coverage)."""
        self.ensure_loaded()
        sic = self._sic
        unc = self._uncertainty
        valid_frac = float(np.mean(~np.isnan(sic)))
        return {
            "cache_dir": str(self._path),
            "n_time_steps": int(self.n_time_steps),
            "sic_shape": tuple(int(x) for x in sic.shape),
            "sic_dtype": str(sic.dtype),
            "uncertainty_shape": tuple(int(x) for x in unc.shape),
            "uncertainty_dtype": str(unc.dtype),
            "n_horizons": int(unc.shape[1]),
            "valid_cell_fraction": valid_frac,
            "nan_cell_fraction": float(1.0 - valid_frac),
            "resolution_deg": float(self.metadata.resolution_deg),
            "lat_range": (float(self._lat[0]), float(self._lat[-1])),
            "lon_range": (float(self._lon[0]), float(self._lon[-1])),
            "model_band_rows": self.metadata.model_band_rows,
            "model_band_cols": self.metadata.model_band_cols,
            "extension_band_rows": self.metadata.extension_band_rows,
            "lon_extension_cols": self.metadata.lon_extension_cols,
            "valid_mask_shape": (None if self._valid_mask is None
                                 else tuple(int(x) for x in self._valid_mask.shape)),
            "has_multiplier": self.has_multiplier,
            "date_range": [str(d)[:10] for d in self._dates[[0, -1]]],
        }

    # -- loading ---------------------------------------------------------

    def ensure_loaded(self) -> None:
        """Load and validate all required artifacts once (idempotent)."""
        if self._loaded:
            return
        if not self.is_available():
            missing = []
            if self._path is not None and Path(self._path).exists():
                cache = Path(self._path)
                for key in ("sic", "uncertainty", "lat", "lon", "dates", "metadata"):
                    if not (cache / self._files[key]).exists():
                        missing.append(self._files[key])
            raise FileNotFoundError(
                f"SIC forecast artifacts not available in {self._path!r}"
                + (f"; missing: {missing}" if missing else "")
            )

        cache = Path(self._path)
        meta = SICForecastMetadata.from_json(cache / self._files["metadata"])
        lat = np.load(str(cache / self._files["lat"]))
        lon = np.load(str(cache / self._files["lon"]))
        sic = np.load(str(cache / self._files["sic"]))
        unc = np.load(str(cache / self._files["uncertainty"]))
        dates = np.load(str(cache / self._files["dates"]))

        valid_mask = None
        vm_path = cache / self._files["valid_mask"]
        if vm_path.exists():
            valid_mask = np.load(str(vm_path))
        elif self._require_valid_mask:
            raise FileNotFoundError(f"valid_mask not found: {vm_path}")

        n_time = self.validate_shapes(sic, unc, lat, lon, meta,
                                      dates=dates, valid_mask=valid_mask)

        self._metadata = meta
        self._lat = np.asarray(lat, dtype=np.float64)
        self._lon = np.asarray(lon, dtype=np.float64)
        self._sic = sic
        self._uncertainty = unc
        self._dates = dates
        self._valid_mask = None if valid_mask is None else np.asarray(valid_mask, dtype=bool)
        self._loaded = True
        assert self._sic.shape[0] == n_time

    # -- validation ------------------------------------------------------

    @staticmethod
    def validate_shapes(
        sic: np.ndarray,
        uncertainty: np.ndarray,
        lat: np.ndarray,
        lon: np.ndarray,
        meta: SICForecastMetadata,
        dates: Optional[np.ndarray] = None,
        valid_mask: Optional[np.ndarray] = None,
    ) -> int:
        """
        Validate artifact dimensions against the metadata.

        Returns the number of time steps.  Raises ``ValueError`` with both
        shapes named on any mismatch.  Pure function of its arguments, so
        it can be exercised with in-memory arrays.
        """
        # --- coordinate axes ---
        for name, axis, n_expected, rng in (
            ("lat", lat, meta.n_rows, meta.lat_range),
            ("lon", lon, meta.n_cols, meta.lon_range),
        ):
            axis = np.asarray(axis)
            if axis.ndim != 1:
                raise ValueError(f"{name} must be 1-D, got shape {axis.shape}")
            if axis.shape[0] != n_expected:
                raise ValueError(
                    f"{name} length {axis.shape[0]} != grid_shape "
                    f"{n_expected} from routing_metadata.json"
                )
            if axis.shape[0] > 1 and not np.all(np.diff(axis) > 0):
                raise ValueError(f"{name} must be strictly ascending")
            if abs(float(axis[0]) - rng[0]) > _RANGE_TOL or \
               abs(float(axis[-1]) - rng[1]) > _RANGE_TOL:
                raise ValueError(
                    f"{name} range [{float(axis[0])}, {float(axis[-1])}] "
                    f"!= metadata {tuple(rng)}"
                )
            if axis.shape[0] > 1:
                step = float(np.mean(np.diff(axis)))
                if abs(step - meta.resolution_deg) > _RANGE_TOL:
                    raise ValueError(
                        f"{name} spacing {step:.6f} != resolution_deg "
                        f"{meta.resolution_deg}"
                    )

        # --- SIC grid ---
        sic = np.asarray(sic)
        if sic.ndim != 3:
            raise ValueError(
                f"SIC must be 3-D (time, lat, lon), got shape {sic.shape}"
            )
        if tuple(sic.shape[1:]) != tuple(meta.grid_shape):
            raise ValueError(
                f"SIC spatial shape {tuple(sic.shape[1:])} != metadata "
                f"grid_shape {tuple(meta.grid_shape)}"
            )
        n_time = int(sic.shape[0])
        if n_time == 0:
            raise ValueError("SIC array has zero time steps")

        # --- uncertainty ---
        unc = np.asarray(uncertainty)
        if unc.ndim != 4:
            raise ValueError(
                f"uncertainty must be 4-D (time, horizon, lat, lon), got "
                f"shape {unc.shape}"
            )
        if int(unc.shape[0]) != n_time:
            raise ValueError(
                f"uncertainty time axis {int(unc.shape[0])} != SIC time "
                f"axis {n_time}"
            )
        if tuple(unc.shape[2:]) != tuple(meta.model_band_shape):
            raise ValueError(
                f"uncertainty spatial shape {tuple(unc.shape[2:])} != model "
                f"band shape {tuple(meta.model_band_shape)} from "
                f"routing_metadata.json (model_band_rows="
                f"{meta.model_band_rows}, model_band_cols={meta.model_band_cols})"
            )

        # --- optional companions ---
        if dates is not None:
            dates = np.asarray(dates)
            if dates.ndim != 1 or int(dates.shape[0]) != n_time:
                raise ValueError(
                    f"dates shape {dates.shape} incompatible with SIC time "
                    f"axis {n_time}"
                )
        if valid_mask is not None:
            valid_mask = np.asarray(valid_mask)
            if valid_mask.shape != tuple(meta.model_band_shape):
                raise ValueError(
                    f"valid_mask shape {valid_mask.shape} != model band "
                    f"shape {tuple(meta.model_band_shape)}"
                )
        return n_time

    # -- basic properties ------------------------------------------------

    @property
    def metadata(self) -> SICForecastMetadata:
        self.ensure_loaded()
        return self._metadata

    @property
    def n_time_steps(self) -> int:
        self.ensure_loaded()
        return int(self._sic.shape[0])

    @property
    def horizon(self) -> int:
        return self._horizon

    @horizon.setter
    def horizon(self, value: int) -> None:
        self.ensure_loaded()
        self._horizon = self.validate_horizon(value)

    @property
    def n_horizons(self) -> int:
        self.ensure_loaded()
        return int(self._uncertainty.shape[1])

    @property
    def dates(self) -> np.ndarray:
        self.ensure_loaded()
        return self._dates

    @property
    def valid_mask(self) -> Optional[np.ndarray]:
        self.ensure_loaded()
        return self._valid_mask

    @property
    def has_multiplier(self) -> bool:
        return (self._path is not None
                and (Path(self._path) / self._files["multiplier"]).exists())

    def date_range(self) -> Tuple[Optional[str], Optional[str]]:
        self.ensure_loaded()
        return str(self._dates[0])[:19], str(self._dates[-1])[:19]

    def grid_spec(self) -> Dict[str, Any]:
        """
        Describe the grid this artifact expects.

        Intended to be passed to the existing
        ``src.data.builder.build_grid_template`` so the adapter reuses the
        project's grid constructor instead of inventing a new grid.
        """
        self.ensure_loaded()
        return {
            "n_rows": self.metadata.n_rows,
            "n_cols": self.metadata.n_cols,
            "lat_min": float(self._lat[0]),
            "lat_max": float(self._lat[-1]),
            "lon_min": float(self._lon[0]),
            "lon_max": float(self._lon[-1]),
            "resolution_deg": float(self.metadata.resolution_deg),
        }

    # -- time lookup -----------------------------------------------------

    def validate_time_index(self, index) -> int:
        """
        Validate a forecast time index.

        Raises ``TypeError`` for non-integer input and ``IndexError`` when
        the index is outside ``[0, n_time_steps)``.
        """
        if isinstance(index, bool) or not isinstance(index, (int, np.integer)):
            raise TypeError(
                f"time index must be an integer, got {type(index).__name__}: {index!r}"
            )
        idx = int(index)
        n = self.n_time_steps
        if idx < 0 or idx >= n:
            raise IndexError(
                f"time index {idx} out of range for {n} forecast time steps "
                f"(valid 0..{n - 1})"
            )
        return idx

    def validate_horizon(self, horizon) -> int:
        if isinstance(horizon, bool) or not isinstance(horizon, (int, np.integer)):
            raise TypeError(
                f"horizon must be an integer, got {type(horizon).__name__}: {horizon!r}"
            )
        h = int(horizon)
        n_h = self.n_horizons
        if h < 0 or h >= n_h:
            raise IndexError(
                f"horizon {h} out of range; uncertainty has {n_h} horizons "
                f"(0 = D+1 .. {n_h - 1} = D+{n_h})"
            )
        return h

    def time_index_for_date(self, when: datetime) -> int:
        """Nearest forecast time index for an absolute datetime."""
        self.ensure_loaded()
        query = np.datetime64(when.replace(tzinfo=None), "ns")
        return int(np.argmin(np.abs(self._dates - query)))

    def time_index_for_hours(self, t_hours: float) -> int:
        """
        Convert hours-since-departure to the nearest forecast time index.

        The time origin must be supplied explicitly; it is never hidden
        inside the adapter.
        """
        if self._route_start_datetime is None:
            raise ValueError(
                "route_start_datetime must be set to convert t_hours to a date"
            )
        self.ensure_loaded()
        query_dt = self._route_start_datetime + timedelta(hours=float(t_hours))
        return self.time_index_for_date(query_dt)

    def _resolve_time_index(
        self, t_hours: Optional[float] = None, time_index: Optional[int] = None,
    ) -> int:
        if time_index is not None and t_hours is not None:
            raise ValueError("pass either t_hours or time_index, not both")
        if time_index is not None:
            return self.validate_time_index(time_index)
        if t_hours is None:
            return 0
        return self.time_index_for_hours(t_hours)

    # -- coordinate lookup -----------------------------------------------

    def _index_for(self, value: float, axis: np.ndarray, name: str) -> int:
        value = float(value)
        if not np.isfinite(value):
            raise IndexError(f"{name} must be a finite number, got {value!r}")
        lo, hi = float(axis[0]), float(axis[-1])
        if value < lo - _COORD_TOL or value > hi + _COORD_TOL:
            raise IndexError(
                f"{name}={value} is outside the supported grid "
                f"[{lo}, {hi}] (0.25 deg spacing; no cell within half a cell = "
                f"{self.metadata.resolution_deg / 2.0} deg)"
            )
        idx = int(np.argmin(np.abs(axis - value)))
        half_cell = self.metadata.resolution_deg / 2.0
        if abs(float(axis[idx]) - value) > half_cell + _COORD_TOL:
            raise IndexError(
                f"{name}={value} has no cell centre within half a cell "
                f"({half_cell} deg) on the supported grid [{lo}, {hi}]"
            )
        return idx

    def row_for_lat(self, lat: float) -> int:
        """Row index for a latitude (degrees). Raises IndexError if unsupported."""
        self.ensure_loaded()
        return self._index_for(lat, self._lat, "lat")

    def col_for_lon(self, lon: float) -> int:
        """Column index for a longitude (degrees). Raises IndexError if unsupported."""
        self.ensure_loaded()
        return self._index_for(lon, self._lon, "lon")

    def latlon_to_rc(self, lat: float, lon: float) -> Tuple[int, int]:
        """(row, col) for a geographic coordinate."""
        return self.row_for_lat(lat), self.col_for_lon(lon)

    def rowcol_to_latlon(self, row: int, col: int) -> Tuple[float, float]:
        """(lat, lon) centre of a cell. Raises IndexError for bad indices."""
        self.ensure_loaded()
        n_rows, n_cols = self.metadata.n_rows, self.metadata.n_cols
        for name, idx, n in (("row", row, n_rows), ("col", col, n_cols)):
            if isinstance(idx, bool) or not isinstance(idx, (int, np.integer)):
                raise TypeError(
                    f"{name} must be an integer, got {type(idx).__name__}: {idx!r}"
                )
            if not 0 <= int(idx) < n:
                raise IndexError(f"{name} {int(idx)} out of range (valid 0..{n - 1})")
        return float(self._lat[int(row)]), float(self._lon[int(col)])

    # -- field access ----------------------------------------------------

    def sic_at_time(
        self, t_hours: Optional[float] = None, time_index: Optional[int] = None,
    ) -> np.ndarray:
        """
        SIC field ``(173, 369)`` for one forecast step, NaN preserved.

        Returns a fresh float64 array; the cached artifact is never handed
        out directly.
        """
        idx = self._resolve_time_index(t_hours, time_index)
        self.ensure_loaded()
        return np.array(self._sic[idx], dtype=np.float64, copy=True)

    def uncertainty_at_time(
        self,
        t_hours: Optional[float] = None,
        time_index: Optional[int] = None,
        horizon: Optional[int] = None,
    ) -> np.ndarray:
        """
        SIC uncertainty ``(173, 369)`` for one step and horizon, NaN-padded.

        The artifact covers the model band only; the extension band and the
        longitude-extension columns are NaN, matching
        ``routing_metadata.json`` -> ``notes_lon_domain``.
        """
        idx = self._resolve_time_index(t_hours, time_index)
        h = self.validate_horizon(self._horizon if horizon is None else horizon)
        self.ensure_loaded()
        meta = self.metadata
        out = np.full(meta.grid_shape, np.nan, dtype=np.float64)
        r0, r1 = meta.model_band_rows
        c0, c1 = meta.model_band_cols
        out[r0:r1, c0:c1] = np.asarray(self._uncertainty[idx, h], dtype=np.float64)
        return out

    def uncertainty_frames(
        self, t_hours: Optional[float] = None, time_index: Optional[int] = None,
    ) -> np.ndarray:
        """All uncertainty horizons ``(3, 173, 369)`` for one forecast step."""
        idx = self._resolve_time_index(t_hours, time_index)
        self.ensure_loaded()
        frames = [self.uncertainty_at_time(time_index=idx, horizon=h)
                  for h in range(self.n_horizons)]
        return np.stack(frames, axis=0)

    def multiplier(
        self, t_hours: Optional[float] = None, time_index: Optional[int] = None,
    ) -> np.ndarray:
        """
        Read-only access to ``routing_multiplier_2026.npy`` for one step.

        Committed POLARIS-style heuristic from ``routing_metadata.json``
        (open 1.0 / marginal 2.0 / moderate 8.0 / hard 50.0 / impassable
        ``inf``).  Provided for parity with the legacy backend router; it is
        **not** wired into ``EnvironmentalGrid`` or ``CostWeights``.
        """
        idx = self._resolve_time_index(t_hours, time_index)
        if not self.has_multiplier:
            raise FileNotFoundError(
                f"{self._files['multiplier']} not found in {self._path}"
            )
        if self._multiplier is None:
            self._multiplier = np.load(
                str(Path(self._path) / self._files["multiplier"]), mmap_mode="r"
            )
        expected = (self.n_time_steps, self.metadata.n_rows, self.metadata.n_cols)
        if tuple(self._multiplier.shape) != expected:
            raise ValueError(
                f"multiplier shape {tuple(self._multiplier.shape)} != {expected}"
            )
        return np.asarray(self._multiplier[idx], dtype=np.float64)

    def sic_at(
        self,
        lat: float,
        lon: float,
        t_hours: Optional[float] = None,
        time_index: Optional[int] = None,
    ) -> float:
        """
        SIC at a geographic coordinate for one forecast step.

        Returns NaN when the artifact cell itself is NaN (invalid cell).
        Lookup failures (unsupported coordinate) raise IndexError.
        """
        r, c = self.latlon_to_rc(lat, lon)
        idx = self._resolve_time_index(t_hours, time_index)
        self.ensure_loaded()
        return float(self._sic[idx, r, c])

    def uncertainty_at(
        self,
        lat: float,
        lon: float,
        t_hours: Optional[float] = None,
        time_index: Optional[int] = None,
        horizon: Optional[int] = None,
    ) -> float:
        """SIC uncertainty at a geographic coordinate (NaN if cell is NaN)."""
        r, c = self.latlon_to_rc(lat, lon)
        return float(self.uncertainty_at_time(
            t_hours=t_hours, time_index=time_index, horizon=horizon,
        )[r, c])

    # -- grid integration ------------------------------------------------

    def _align(self, data: np.ndarray, grid: EnvironmentalGrid) -> np.ndarray:
        """
        Place a native-grid field onto the caller's grid.

        Reuses the grid the caller already built: if its shape and
        coordinates match the artifact axes, the array is returned as-is
        (no interpolation, so NaN is preserved exactly).  Otherwise the
        existing nearest-neighbour pattern is used with ``fill_value=NaN``
        so unsupported cells stay invalid.
        """
        self.ensure_loaded()
        if (data.shape == (self.metadata.n_rows, self.metadata.n_cols)
                and grid.n_rows == data.shape[0] and grid.n_cols == data.shape[1]
                and np.allclose(grid.lat, self._lat, atol=_COORD_TOL)
                and np.allclose(grid.lon, self._lon, atol=_COORD_TOL)):
            return data

        from scipy.interpolate import RegularGridInterpolator

        interp = RegularGridInterpolator(
            (self._lat, self._lon), data,
            method="nearest", bounds_error=False, fill_value=np.nan,
        )
        lon_mesh, lat_mesh = np.meshgrid(grid.lon, grid.lat)
        points = np.stack([lat_mesh.ravel(), lon_mesh.ravel()], axis=-1)
        return interp(points).reshape(grid.n_rows, grid.n_cols)

    def load(
        self,
        t_hours: float,
        grid_template: EnvironmentalGrid,
        horizon: Optional[int] = None,
    ) -> EnvironmentalGrid:
        """
        Populate ``sic_mean`` / ``sic_uncertainty`` on a copy of the template.

        Follows the existing ``BaseAdapter`` protocol, so the result can be
        chained with the CMEMS current adapter (which then fills
        ``current_cost`` / ``current_uo`` / ``current_vo`` on the same grid).

        NaN SIC cells are marked non-navigable: NaN means invalid /
        impassable, and the existing routers already skip
        ``navigable == False`` cells, so no cost or routing code changes.

        Parameters
        ----------
        t_hours : float
            Hours since departure.  Requires ``route_start_datetime``.
        grid_template : EnvironmentalGrid
            Existing grid to copy.  Its coordinates are reused, never
            replaced.
        horizon : int, optional
            Uncertainty horizon override (default: instance ``horizon``).

        Returns
        -------
        EnvironmentalGrid
            Copy of ``grid_template`` with SIC layers set.
        """
        grid = self._copy_grid(grid_template)

        if not self.is_available():
            grid.sic_mean = np.full((grid.n_rows, grid.n_cols), np.nan)
            grid.sic_uncertainty = np.full((grid.n_rows, grid.n_cols), np.nan)
            grid.navigable = np.zeros_like(grid.navigable)
            return grid

        t_index = self.time_index_for_hours(t_hours)
        sic_2d = self._align(self.sic_at_time(time_index=t_index), grid)
        unc_2d = self._align(
            self.uncertainty_at_time(time_index=t_index, horizon=horizon), grid
        )

        grid.sic_mean = sic_2d
        grid.sic_uncertainty = unc_2d
        # NaN == invalid/impassable.  Never substituted with 0.
        grid.navigable = grid.navigable & ~np.isnan(sic_2d)
        return grid

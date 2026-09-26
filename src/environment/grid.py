"""
Environmental Grid Representation
=================================

A structured representation of a 2D environmental field for route planning.

Each grid cell stores layered environmental information as 2D NumPy arrays.
Layers are optional — missing data is represented as None.

Designed to later accept outputs from:
- SIC prediction model (mean + uncertainty)
- Iceberg trajectory model (risk + uncertainty)
- Ocean current fields
- Wind/weather fields
"""

from dataclasses import dataclass, field
from typing import Optional

import numpy as np


@dataclass
class EnvironmentalGrid:
    """
    2D environmental grid for maritime route optimization.

    All arrays share the same shape (n_rows, n_cols).
    Latitude/longitude define the geographic extent.

    Required layers:
        navigable : bool array, True where ship can traverse
        lat       : 1D array of row centers (degrees)
        lon       : 1D array of column centers (degrees)

    Optional layers (None if not available):
        sic_mean                : sea-ice concentration mean (0 to 1)
        sic_uncertainty         : SIC standard deviation, dimensionless (>= 0)
        iceberg_risk            : iceberg threat score (0 to 1)
        iceberg_risk_uncertainty: iceberg-risk-field std, dimensionless (>= 0)
        iceberg_uncertainty     : iceberg positional uncertainty (km, >= 0)
        wind_cost               : wind-related traversal cost multiplier (>= 0)
        current_cost            : current-related traversal cost (knots, negative=favorable)
    """

    n_rows: int
    n_cols: int

    lat: np.ndarray         # (n_rows,) — row center latitudes
    lon: np.ndarray         # (n_cols,) — column center longitudes

    navigable: np.ndarray   # (n_rows, n_cols) bool

    sic_mean: Optional[np.ndarray] = None
    sic_uncertainty: Optional[np.ndarray] = None

    iceberg_risk: Optional[np.ndarray] = None
    iceberg_risk_uncertainty: Optional[np.ndarray] = None
    iceberg_uncertainty: Optional[np.ndarray] = None

    wind_cost: Optional[np.ndarray] = None
    current_cost: Optional[np.ndarray] = None

    # Directional current velocity components (m/s)
    # uo: zonal current (positive = eastward)
    # vo: meridional current (positive = northward)
    # These are raw CMEMS velocities used by the directional current model.
    # current_cost (above) remains for backward-compatible scalar cost.
    current_uo: Optional[np.ndarray] = None
    current_vo: Optional[np.ndarray] = None

    # Metadata
    resolution_deg: float = 0.05
    projection: str = "EPSG:4326"  # WGS84 lat/lon

    def __post_init__(self):
        """Validate dimensions after construction."""
        assert self.lat.shape == (self.n_rows,), (
            f"lat shape {self.lat.shape} != (n_rows={self.n_rows},)"
        )
        assert self.lon.shape == (self.n_cols,), (
            f"lon shape {self.lon.shape} != (n_cols={self.n_cols},)"
        )
        assert self.navigable.shape == (self.n_rows, self.n_cols), (
            f"navigable shape {self.navigable.shape} != ({self.n_rows}, {self.n_cols})"
        )
        self._validate_optional_layers()

    def _validate_optional_layers(self):
        """Check that optional layers have correct shape if present."""
        expected = (self.n_rows, self.n_cols)
        optional = [
            ("sic_mean", self.sic_mean),
            ("sic_uncertainty", self.sic_uncertainty),
            ("iceberg_risk", self.iceberg_risk),
            ("iceberg_risk_uncertainty", self.iceberg_risk_uncertainty),
            ("iceberg_uncertainty", self.iceberg_uncertainty),
            ("wind_cost", self.wind_cost),
            ("current_cost", self.current_cost),
            ("current_uo", self.current_uo),
            ("current_vo", self.current_vo),
        ]
        for name, arr in optional:
            if arr is not None:
                assert arr.shape == expected, (
                    f"{name} shape {arr.shape} != {expected}"
                )

    def has_layer(self, name: str) -> bool:
        """Check if a named layer is available."""
        return getattr(self, name) is not None

    def get_layer(self, name: str) -> np.ndarray:
        """
        Get a layer by name.

        Raises ValueError if the layer is not available.
        """
        arr = getattr(self, name)
        if arr is None:
            raise ValueError(
                f"Layer '{name}' is not available. "
                f"Available: {[n for n in self.LAYER_NAMES if self.has_layer(n)]}"
            )
        return arr

    LAYER_NAMES = [
        "sic_mean",
        "sic_uncertainty",
        "iceberg_risk",
        "iceberg_risk_uncertainty",
        "iceberg_uncertainty",
        "wind_cost",
        "current_cost",
        "current_uo",
        "current_vo",
    ]

    def cell_cost_factors(self, row: int, col: int) -> dict:
        """
        Get all available cost factors for a single cell.

        Returns a dict of layer_name -> value.
        Missing layers are omitted.
        """
        factors = {"navigable": bool(self.navigable[row, col])}
        for name in self.LAYER_NAMES:
            arr = getattr(self, name)
            if arr is not None:
                factors[name] = float(arr[row, col])
        return factors

    def summary(self) -> str:
        """Return a human-readable summary of grid contents."""
        lines = [
            f"EnvironmentalGrid: {self.n_rows} x {self.n_cols} "
            f"(resolution={self.resolution_deg} deg)",
            f"  Lat range: [{self.lat.min():.3f}, {self.lat.max():.3f}]",
            f"  Lon range: [{self.lon.min():.3f}, {self.lon.max():.3f}]",
            f"  Navigable cells: {self.navigable.sum()} / {self.navigable.size} "
            f"({100 * self.navigable.mean():.1f}%)",
        ]
        for name in self.LAYER_NAMES:
            arr = getattr(self, name)
            if arr is not None:
                lines.append(
                    f"  {name}: [{arr.min():.4f}, {arr.max():.4f}] "
                    f"mean={arr.mean():.4f}"
                )
            else:
                lines.append(f"  {name}: (not available)")
        return "\n".join(lines)

    def time_query(self, t: float) -> "EnvironmentalGrid":
        """
        Return the environmental grid at time t.

        For a static grid (no time-varying data), this returns self.
        Subclasses or wrapper grids can override this to provide
        time-interpolated or time-indexed data.

        Parameters
        ----------
        t : float
            Time in hours since departure.

        Returns
        -------
        EnvironmentalGrid
            The grid state valid at time t.
        """
        return self

    def cell_size_km(self) -> float:
        """
        Approximate real-world cell size in km.

        Uses latitude range and grid rows to estimate.
        At high latitudes (Antarctica), 1 deg lat ~ 111 km,
        1 deg lon ~ 111 * cos(lat) km.
        """
        lat_range_deg = abs(self.lat[-1] - self.lat[0])
        n_rows = self.n_rows
        km_per_deg_lat = 111.0
        return (lat_range_deg / n_rows) * km_per_deg_lat if n_rows > 1 else 1.0

    def __repr__(self) -> str:
        return (
            f"EnvironmentalGrid({self.n_rows}x{self.n_cols}, "
            f"layers={[n for n in self.LAYER_NAMES if self.has_layer(n)]})"
        )

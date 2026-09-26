"""
SIC Forecast Integration Tests (focused)
=======================================

Focused tests for :mod:`src.data.sic_forecast`, the adapter that consumes the
teammate's already-computed 2026 SIC forecast artifacts in ``backend/cache``
and exposes them as the existing ``EnvironmentalGrid`` layers ``sic_mean`` and
``sic_uncertainty``.

Coverage:
  1. SIC artifact loading
  2. uncertainty loading
  3. shape validation
  4. NaN preservation
  5. latitude/longitude coordinate lookup
  6. time-index lookup
  7. invalid coordinate handling
  8. invalid time-index handling
  plus: current-field (CMEMS) compatibility and multiplier accessor.

No model is trained, re-run, or mocked with synthetic SIC data: every value
asserted here comes from the committed artifacts.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pytest

from src.data.builder import build_env_fn, build_grid_template
from src.data.config import DataConfig
from src.data.sic_forecast import SICForecastField, SICForecastMetadata

REPO_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = REPO_ROOT / "backend" / "cache"

REQUIRED = [
    "routing_sic_2026.npy",
    "uncertainty_2026.npy",
    "routing_lat.npy",
    "routing_lon.npy",
    "dates_2026.npy",
    "routing_metadata.json",
]

HAS_ARTIFACTS = CACHE_DIR.exists() and all(
    (CACHE_DIR / name).exists() for name in REQUIRED
)

pytestmark = pytest.mark.skipif(
    not HAS_ARTIFACTS,
    reason="committed SIC forecast artifacts not found in backend/cache",
)

ROUTE_START = datetime(2026, 1, 6, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def field() -> SICForecastField:
    return SICForecastField(
        cache_dir=str(CACHE_DIR),
        route_start_datetime=ROUTE_START,
    )


@pytest.fixture(scope="module")
def native_grid():
    """Grid built with the existing builder, matching the artifact axes."""
    return build_grid_template(
        lat_min=-75.0, lat_max=-32.0,
        lon_min=-10.0, lon_max=82.0,
        resolution_deg=0.25,
    )


def _raw_sic() -> np.ndarray:
    return np.load(str(CACHE_DIR / "routing_sic_2026.npy"), mmap_mode="r")


def _raw_uncertainty() -> np.ndarray:
    return np.load(str(CACHE_DIR / "uncertainty_2026.npy"), mmap_mode="r")


def _lat_axis() -> np.ndarray:
    return (-75.0 + 0.25 * np.arange(173)).astype(np.float32)


def _lon_axis() -> np.ndarray:
    return (-10.0 + 0.25 * np.arange(369)).astype(np.float32)


def _metadata() -> SICForecastMetadata:
    return SICForecastMetadata.from_json(CACHE_DIR / "routing_metadata.json")


# ---------------------------------------------------------------------------
# 1. SIC artifact loading
# ---------------------------------------------------------------------------

class TestSICLoading:

    def test_is_available_and_loads(self, field):
        assert field.is_available()
        field.ensure_loaded()

    def test_sic_shape_and_dtype(self, field):
        sic = _raw_sic()
        assert sic.shape == (167, 173, 369)
        assert sic.dtype == np.float32
        assert field.n_time_steps == 167

    def test_coordinate_axes(self, field):
        assert field.grid_spec()["n_rows"] == 173
        assert field.grid_spec()["n_cols"] == 369
        assert field.grid_spec()["resolution_deg"] == pytest.approx(0.25)
        assert field.grid_spec()["lat_min"] == pytest.approx(-75.0)
        assert field.grid_spec()["lat_max"] == pytest.approx(-32.0)
        assert field.grid_spec()["lon_min"] == pytest.approx(-10.0)
        assert field.grid_spec()["lon_max"] == pytest.approx(82.0)

    def test_sic_values_in_range(self, field):
        sic = field.sic_at_time(time_index=0)
        valid = sic[~np.isnan(sic)]
        assert valid.size > 0
        assert float(valid.min()) >= 0.0
        assert float(valid.max()) <= 1.0

    def test_load_populates_grid_layers(self, field, native_grid):
        grid = field.load(t_hours=0.0, grid_template=native_grid)
        assert grid.sic_mean is not None
        assert grid.sic_uncertainty is not None
        assert grid.sic_mean.shape == (173, 369)
        assert grid.sic_uncertainty.shape == (173, 369)
        # existing grid coordinates are reused, not replaced
        assert np.array_equal(grid.lat, native_grid.lat)
        assert np.array_equal(grid.lon, native_grid.lon)
        assert grid.resolution_deg == native_grid.resolution_deg

    def test_missing_cache_dir_is_unavailable(self):
        assert not SICForecastField(cache_dir=None).is_available()
        assert not SICForecastField(
            cache_dir=str(REPO_ROOT / "does" / "not" / "exist")
        ).is_available()

    def test_missing_cache_dir_yields_all_invalid(self, native_grid):
        grid = SICForecastField(cache_dir=None).load(0.0, native_grid)
        assert np.all(np.isnan(grid.sic_mean))
        assert np.all(np.isnan(grid.sic_uncertainty))
        assert not grid.navigable.any()

    def test_load_requires_explicit_time_origin(self, native_grid):
        with pytest.raises(ValueError, match="route_start_datetime"):
            SICForecastField(cache_dir=str(CACHE_DIR)).load(0.0, native_grid)


# ---------------------------------------------------------------------------
# 2. Uncertainty loading
# ---------------------------------------------------------------------------

class TestUncertaintyLoading:

    def test_uncertainty_shape_and_dtype(self, field):
        unc = _raw_uncertainty()
        assert unc.shape == (167, 3, 101, 361)
        assert unc.dtype == np.float32
        assert field.n_horizons == 3

    def test_uncertainty_finite_and_non_negative(self, field):
        unc = field.uncertainty_at_time(time_index=0)
        valid = unc[~np.isnan(unc)]
        assert valid.size > 0
        assert np.all(np.isfinite(valid))
        assert float(valid.min()) >= 0.0

    def test_uncertainty_expanded_to_full_grid(self, field):
        assert field.uncertainty_at_time(time_index=0).shape == (173, 369)

    def test_uncertainty_horizon_selection(self, field):
        d1 = field.uncertainty_at_time(time_index=0, horizon=0)
        d3 = field.uncertainty_at_time(time_index=0, horizon=2)
        # horizons are distinct, and each matches the artifact
        assert not np.allclose(d1[0:101, 0:361], d3[0:101, 0:361])
        assert np.allclose(d1[0:101, 0:361],
                           _raw_uncertainty()[0, 0], equal_nan=True)

    def test_uncertainty_kept_separate_from_sic(self, field):
        sic = field.sic_at_time(time_index=0)
        unc = field.uncertainty_at_time(time_index=0)
        assert sic.shape == unc.shape
        # different fields, not a copy of one another
        assert not np.allclose(sic[0:101, 0:361], unc[0:101, 0:361],
                               equal_nan=True)

    def test_uncertainty_frames_returns_all_horizons(self, field):
        frames = field.uncertainty_frames(time_index=0)
        assert frames.shape == (3, 173, 369)
        for h in range(3):
            assert np.allclose(frames[h][0:101, 0:361],
                               _raw_uncertainty()[0, h], equal_nan=True)

    def test_default_horizon_is_d_plus_1(self):
        default = SICForecastField(cache_dir=str(CACHE_DIR),
                                   route_start_datetime=ROUTE_START)
        explicit = SICForecastField(cache_dir=str(CACHE_DIR),
                                    route_start_datetime=ROUTE_START,
                                    horizon=0)
        assert default.horizon == 0
        assert np.allclose(default.uncertainty_at_time(time_index=5),
                           explicit.uncertainty_at_time(time_index=5),
                           equal_nan=True)


# ---------------------------------------------------------------------------
# 3. Shape validation
# ---------------------------------------------------------------------------

class TestShapeValidation:

    def test_real_arrays_validate(self, field):
        field.ensure_loaded()
        n_time = SICForecastField.validate_shapes(
            np.asarray(_raw_sic()),
            np.asarray(_raw_uncertainty()),
            np.load(str(CACHE_DIR / "routing_lat.npy")),
            np.load(str(CACHE_DIR / "routing_lon.npy")),
            _metadata(),
        )
        assert n_time == 167

    def test_sic_wrong_spatial_shape_rejected(self):
        meta = _metadata()
        with pytest.raises(ValueError, match=r"SIC spatial shape"):
            SICForecastField.validate_shapes(
                np.zeros((167, 173, 360), np.float32),   # bad lon count
                np.zeros((167, 3, 101, 361), np.float32),
                _lat_axis(),
                _lon_axis(),
                meta,
            )

    def test_sic_wrong_dimensionality_rejected(self):
        meta = _metadata()
        with pytest.raises(ValueError, match="3-D"):
            SICForecastField.validate_shapes(
                np.zeros((173, 369), np.float32),
                np.zeros((167, 3, 101, 361), np.float32),
                _lat_axis(),
                _lon_axis(),
                meta,
            )

    def test_inconsistent_lat_length_rejected(self):
        meta = _metadata()
        with pytest.raises(ValueError, match="lat length"):
            SICForecastField.validate_shapes(
                np.zeros((167, 173, 369), np.float32),
                np.zeros((167, 3, 101, 361), np.float32),
                (-75.0 + 0.25 * np.arange(101)).astype(np.float32),  # 101 not 173
                _lon_axis(),
                meta,
            )

    def test_unsorted_lat_rejected(self):
        meta = _metadata()
        lat = _lat_axis()
        lat[0], lat[-1] = lat[-1], lat[0]
        with pytest.raises(ValueError, match="ascending"):
            SICForecastField.validate_shapes(
                np.zeros((167, 173, 369), np.float32),
                np.zeros((167, 3, 101, 361), np.float32),
                lat,
                _lon_axis(),
                meta,
            )

    def test_time_axis_mismatch_rejected(self):
        meta = _metadata()
        with pytest.raises(ValueError, match="time axis"):
            SICForecastField.validate_shapes(
                np.zeros((167, 173, 369), np.float32),
                np.zeros((99, 3, 101, 361), np.float32),
                _lat_axis(),
                _lon_axis(),
                meta,
            )

    def test_uncertainty_wrong_spatial_shape_rejected(self):
        """Model-band uncertainty pasted onto the full grid is not accepted."""
        meta = _metadata()
        with pytest.raises(ValueError, match="uncertainty spatial shape"):
            SICForecastField.validate_shapes(
                np.zeros((167, 173, 369), np.float32),
                np.zeros((167, 3, 173, 369), np.float32),
                _lat_axis(),
                _lon_axis(),
                meta,
            )

    def test_uncertainty_wrong_dimensionality_rejected(self):
        meta = _metadata()
        with pytest.raises(ValueError, match="4-D"):
            SICForecastField.validate_shapes(
                np.zeros((167, 173, 369), np.float32),
                np.zeros((167, 101, 361), np.float32),
                _lat_axis(),
                _lon_axis(),
                meta,
            )

    def test_uncertainty_time_axis_mismatch_rejected(self):
        meta = _metadata()
        with pytest.raises(ValueError, match="uncertainty time axis"):
            SICForecastField.validate_shapes(
                np.zeros((167, 173, 369), np.float32),
                np.zeros((160, 3, 101, 361), np.float32),
                _lat_axis(),
                _lon_axis(),
                meta,
            )

    def test_valid_mask_shape_validated(self):
        meta = _metadata()
        lat = _lat_axis()
        lon = _lon_axis()
        sic = np.zeros((167, 173, 369), np.float32)
        unc = np.zeros((167, 3, 101, 361), np.float32)
        SICForecastField.validate_shapes(sic, unc, lat, lon, meta,
                                        valid_mask=np.ones((101, 361), bool))
        with pytest.raises(ValueError, match="valid_mask shape"):
            SICForecastField.validate_shapes(sic, unc, lat, lon, meta,
                                            valid_mask=np.ones((173, 369), bool))

    def test_real_valid_mask_loads(self, field):
        assert field.valid_mask is not None
        assert field.valid_mask.shape == (101, 361)
        assert field.valid_mask.dtype == bool


# ---------------------------------------------------------------------------
# 4. NaN preservation
# ---------------------------------------------------------------------------

class TestNaNPreservation:

    def test_sic_matches_artifact_exactly(self, field):
        for idx in (0, 83, 166):
            loaded = field.sic_at_time(time_index=idx)
            raw = np.asarray(_raw_sic()[idx])
            assert np.array_equal(loaded, raw.astype(np.float64), equal_nan=True)

    def test_nan_never_becomes_zero(self, field):
        sic = field.sic_at_time(time_index=0)
        n_nan = int(np.isnan(sic).sum())
        assert n_nan > 0
        # an artifact NaN must not appear as a 0.0 in the loaded field
        raw = np.asarray(_raw_sic()[0])
        nan_positions = np.isnan(raw)
        assert np.all(np.isnan(sic[nan_positions]))
        assert not np.any(sic[nan_positions] == 0.0)

    def test_lon_extension_columns_stay_nan(self, field):
        """Model band covers lon -10..80; lon 80.25..82 is outside the model."""
        meta = field.metadata
        c0, c1 = meta.lon_extension_cols
        sic = field.sic_at_time(time_index=0)
        assert np.all(np.isnan(sic[meta.model_band_rows[0]:meta.model_band_rows[1],
                                  c0:c1]))
        unc = field.uncertainty_at_time(time_index=0)
        assert np.all(np.isnan(unc[meta.model_band_rows[0]:meta.model_band_rows[1],
                                  c0:c1]))

    def test_extension_band_sic_is_not_nan_padded(self, field):
        """SIC covers the full extension band; only uncertainty does not."""
        meta = field.metadata
        r0, r1 = meta.extension_band_rows
        sic = field.sic_at_time(time_index=0)
        unc = field.uncertainty_at_time(time_index=0)
        assert not np.all(np.isnan(sic[r0:r1, :]))
        assert np.all(np.isnan(unc[r0:r1, :]))

    def test_uncertainty_extension_band_is_nan(self, field):
        meta = field.metadata
        r0, r1 = meta.extension_band_rows
        unc = field.uncertainty_at_time(time_index=0)
        assert np.all(np.isnan(unc[r0:r1, :]))
        assert not np.all(np.isnan(unc[0:101, 0:361]))

    def test_load_marks_nan_cells_impassable(self, field, native_grid):
        grid = field.load(t_hours=0.0, grid_template=native_grid)
        nan_mask = np.isnan(grid.sic_mean)
        assert nan_mask.any()
        assert not grid.navigable[nan_mask].any()
        # valid cells stay navigable
        assert grid.navigable[~nan_mask].all()

    def test_load_preserves_nan_positions(self, field, native_grid):
        grid = field.load(t_hours=0.0, grid_template=native_grid)
        raw = np.asarray(_raw_sic()[0]).astype(np.float64)
        assert np.array_equal(grid.sic_mean, raw, equal_nan=True)

    def test_out_of_domain_grid_is_all_nan(self, field):
        grid = build_grid_template(lat_min=-10.0, lat_max=10.0,
                                   lon_min=0.0, lon_max=10.0,
                                   resolution_deg=1.0)
        out = field.load(t_hours=0.0, grid_template=grid)
        assert np.all(np.isnan(out.sic_mean))
        assert np.all(np.isnan(out.sic_uncertainty))
        assert not out.navigable.any()

    def test_sub_grid_lookup_preserves_nan_pattern(self, field):
        grid = build_grid_template(lat_min=-65.0, lat_max=-55.0,
                                   lon_min=0.0, lon_max=50.0,
                                   resolution_deg=0.25)
        out = field.load(t_hours=0.0, grid_template=grid)
        assert out.sic_mean.shape == (41, 201)
        r0, c0 = field.latlon_to_rc(-65.0, 0.0)
        assert np.isnan(out.sic_mean[0, 0]) == bool(np.isnan(
            _raw_sic()[0, r0, c0]))


# ---------------------------------------------------------------------------
# 5. Latitude / longitude coordinate lookup
# ---------------------------------------------------------------------------

class TestLatLonLookup:

    def test_row_for_lat(self, field):
        assert field.row_for_lat(-75.0) == 0
        assert field.row_for_lat(-32.0) == 172
        assert field.row_for_lat(-70.5) == 18
        assert field.row_for_lat(-50.0) == 100   # last model-band row

    def test_col_for_lon(self, field):
        assert field.col_for_lon(-10.0) == 0
        assert field.col_for_lon(82.0) == 368
        assert field.col_for_lon(11.75) == 87
        assert field.col_for_lon(80.0) == 360    # last model-band column

    def test_latlon_to_rc(self, field):
        assert field.latlon_to_rc(-70.0, 10.5) == (20, 82)   # Maitri cell
        assert field.latlon_to_rc(-69.0, 76.25) == (24, 345)  # Bharati cell

    def test_station_goals_match_artifact(self, field):
        goals = json.loads((CACHE_DIR / "routing_station_goals.json").read_text())
        for name, info in goals.items():
            row, col = info["cell"]
            lat, lon = field.rowcol_to_latlon(row, col)
            assert lat == pytest.approx(info["lat"], abs=0.3), name
            assert lon == pytest.approx(info["lon"], abs=0.3), name

    def test_rowcol_to_latlon_roundtrip(self, field):
        for row, col in [(0, 0), (18, 87), (100, 360), (172, 368)]:
            lat, lon = field.rowcol_to_latlon(row, col)
            assert field.latlon_to_rc(lat, lon) == (row, col)

    def test_sic_at_coordinate_matches_index(self, field):
        lat, lon = -70.0, 10.5
        r, c = field.latlon_to_rc(lat, lon)
        for idx in (0, 40, 166):
            assert field.sic_at(lat, lon, time_index=idx) == pytest.approx(
                float(_raw_sic()[idx, r, c]), nan_ok=True
            )

    def test_uncertainty_at_coordinate(self, field):
        lat, lon = -65.0, 20.0
        r, c = field.latlon_to_rc(lat, lon)
        assert field.uncertainty_at(lat, lon, time_index=3) == pytest.approx(
            float(_raw_uncertainty()[3, 0, r, c]), nan_ok=True
        )

    def test_lookup_slight_offsets_snap_to_node(self, field):
        exact = field.row_for_lat(-70.5)
        assert field.row_for_lat(-70.5 + 0.05) == exact
        assert field.row_for_lat(-70.5 - 0.05) == exact

    def test_bad_rowcol_index(self, field):
        with pytest.raises(IndexError):
            field.rowcol_to_latlon(173, 0)
        with pytest.raises(IndexError):
            field.rowcol_to_latlon(0, -1)
        with pytest.raises(TypeError):
            field.rowcol_to_latlon(1.5, 0)


# ---------------------------------------------------------------------------
# 6. Time-index lookup
# ---------------------------------------------------------------------------

class TestTimeIndexLookup:

    def test_n_time_steps(self, field):
        assert field.n_time_steps == 167

    def test_first_and_last_dates(self, field):
        assert str(field.dates[0])[:10] == "2026-01-06"
        assert str(field.dates[-1])[:10] == "2026-06-21"
        first, last = field.date_range()
        assert first.startswith("2026-01-06")
        assert last.startswith("2026-06-21")

    def test_dates_match_artifact_length(self, field):
        dates = np.load(str(CACHE_DIR / "dates_2026.npy"))
        assert dates.shape[0] == field.n_time_steps
        assert np.array_equal(field.dates, dates)

    def test_time_index_for_hours(self, field):
        assert field.time_index_for_hours(0.0) == 0
        assert field.time_index_for_hours(24.0) == 1
        assert field.time_index_for_hours(166 * 24.0) == 166
        assert field.time_index_for_hours(12.0) == 0   # nearest day

    def test_time_index_for_date(self, field):
        assert field.time_index_for_date(datetime(2026, 1, 6)) == 0
        assert field.time_index_for_date(datetime(2026, 3, 3)) == 56
        assert field.time_index_for_date(datetime(2026, 6, 21)) == 166

    def test_dates_are_ascending(self, field):
        assert np.all(np.diff(field.dates.astype("datetime64[ns]"))
                      >= np.timedelta64(0, "ns"))

    def test_time_slice_lookup(self, field):
        assert np.array_equal(field.sic_at_time(time_index=7),
                              np.asarray(_raw_sic()[7]).astype(np.float64),
                              equal_nan=True)

    def test_t_hours_and_time_index_disagree_guard(self, field):
        with pytest.raises(ValueError, match="not both"):
            field.sic_at_time(t_hours=0.0, time_index=0)

    def test_load_at_specific_step(self, field, native_grid):
        grid = field.load(t_hours=50 * 24.0, grid_template=native_grid)
        assert np.array_equal(grid.sic_mean,
                              np.asarray(_raw_sic()[50]).astype(np.float64),
                              equal_nan=True)

    def test_horizon_validation(self, field):
        assert field.validate_horizon(0) == 0
        assert field.validate_horizon(2) == 2
        with pytest.raises(IndexError):
            field.validate_horizon(3)
        with pytest.raises(TypeError):
            field.validate_horizon(1.5)


# ---------------------------------------------------------------------------
# 7. Invalid coordinate handling
# ---------------------------------------------------------------------------

class TestInvalidCoordinates:

    @pytest.mark.parametrize("lat", [10.0, -90.0, -20.0, 89.0])
    def test_latitude_outside_grid(self, field, lat):
        with pytest.raises(IndexError):
            field.row_for_lat(lat)

    @pytest.mark.parametrize("lon", [90.0, -20.0, 200.0, -180.0])
    def test_longitude_outside_grid(self, field, lon):
        with pytest.raises(IndexError):
            field.col_for_lon(lon)

    def test_cell_midpoint_snaps_to_nearest_node(self, field):
        # -70.625 sits exactly between nodes -70.75 and -70.5 (half a cell)
        assert field.row_for_lat(-70.625) in (17, 18)
        assert field.col_for_lon(11.375) in (85, 86)

    def test_just_outside_grid_edge_rejected(self, field):
        with pytest.raises(IndexError, match=r"outside the supported grid"):
            field.row_for_lat(-75.1)
        with pytest.raises(IndexError, match=r"outside the supported grid"):
            field.col_for_lon(82.1)

    def test_non_finite_coordinate(self, field):
        with pytest.raises(IndexError):
            field.row_for_lat(float("nan"))
        with pytest.raises(IndexError):
            field.col_for_lon(float("inf"))

    def test_error_message_reports_supported_range(self, field):
        with pytest.raises(IndexError, match=r"-75.0, -32.0"):
            field.row_for_lat(10.0)
        with pytest.raises(IndexError, match=r"-10.0, 82.0"):
            field.col_for_lon(200.0)

    def test_sic_at_invalid_coordinate(self, field):
        with pytest.raises(IndexError):
            field.sic_at(10.0, 10.0, time_index=0)
        with pytest.raises(IndexError):
            field.uncertainty_at(-70.0, 200.0, time_index=0)

    def test_latlon_to_rc_invalid(self, field):
        with pytest.raises(IndexError):
            field.latlon_to_rc(10.0, 0.0)
        with pytest.raises(IndexError):
            field.latlon_to_rc(-70.0, 100.0)


# ---------------------------------------------------------------------------
# 8. Invalid time-index handling
# ---------------------------------------------------------------------------

class TestInvalidTimeIndex:

    @pytest.mark.parametrize("index", [-1, 167, 200, 10_000])
    def test_out_of_range_index(self, field, index):
        with pytest.raises(IndexError):
            field.validate_time_index(index)

    @pytest.mark.parametrize("index", [1.5, "0", None, [0], 2.0])
    def test_non_integer_index(self, field, index):
        with pytest.raises(TypeError):
            field.validate_time_index(index)

    def test_error_message_reports_valid_range(self, field):
        with pytest.raises(IndexError, match=r"valid 0\.\.166"):
            field.validate_time_index(167)

    def test_invalid_index_in_field_access(self, field):
        with pytest.raises(IndexError):
            field.sic_at_time(time_index=167)
        with pytest.raises(IndexError):
            field.uncertainty_at_time(time_index=-1)
        with pytest.raises(IndexError):
            field.uncertainty_frames(time_index=999)

    def test_invalid_horizon_in_load(self, field, native_grid):
        with pytest.raises(IndexError, match="horizon"):
            field.load(t_hours=0.0, grid_template=native_grid, horizon=99)


# ---------------------------------------------------------------------------
# Compatibility with the existing CMEMS current fields
# ---------------------------------------------------------------------------

class TestCurrentFieldCompatibility:

    def test_current_fields_survive_load(self, field, native_grid):
        rng = np.random.default_rng(0)
        uo = rng.normal(0.0, 0.05, (173, 369))
        vo = rng.normal(0.0, 0.05, (173, 369))
        template = type(native_grid)(
            n_rows=native_grid.n_rows,
            n_cols=native_grid.n_cols,
            lat=native_grid.lat.copy(),
            lon=native_grid.lon.copy(),
            navigable=np.ones((173, 369), dtype=bool),
            current_cost=np.sqrt(uo ** 2 + vo ** 2),
            current_uo=uo,
            current_vo=vo,
            resolution_deg=0.25,
        )
        out = field.load(t_hours=0.0, grid_template=template)
        assert np.array_equal(out.current_uo, uo)
        assert np.array_equal(out.current_vo, vo)
        assert np.array_equal(out.current_cost, template.current_cost)
        # SIC layers added alongside, not replacing, the current fields
        assert out.sic_mean is not None
        assert out.sic_uncertainty is not None
        assert out.n_cols == native_grid.n_cols

    def test_grid_template_not_mutated(self, field, native_grid):
        before_nav = native_grid.navigable.copy()
        field.load(t_hours=0.0, grid_template=native_grid)
        assert np.array_equal(native_grid.navigable, before_nav)
        assert native_grid.sic_mean is None


# ---------------------------------------------------------------------------
# Wiring through the existing builder / config (no new architecture)
# ---------------------------------------------------------------------------

class TestBuilderIntegration:

    def test_build_env_fn_uses_sic_forecast(self, native_grid):
        config = DataConfig(
            sic_forecast_cache_dir=str(CACHE_DIR),
            route_start_datetime=ROUTE_START,
        )
        assert "sic_forecast" in config.active_adapters()
        env_fn = build_env_fn(config, native_grid)
        grid = env_fn(0.0)
        assert grid.sic_mean.shape == (173, 369)
        assert grid.sic_uncertainty.shape == (173, 369)
        assert np.array_equal(grid.sic_mean,
                              np.asarray(_raw_sic()[0]).astype(np.float64),
                              equal_nan=True)
        assert not grid.navigable[np.isnan(grid.sic_mean)].any()

    def test_forecast_takes_precedence_over_sic_path(self):
        config = DataConfig(sic_forecast_cache_dir="cache", sic_path="sic.nc")
        assert config.active_adapters()[0] == "sic_forecast"
        assert "sic" not in config.active_adapters()

    def test_default_config_keeps_existing_sic_adapter(self):
        assert DataConfig().active_adapters() == []

    def test_from_env_reads_sic_forecast_settings(self, monkeypatch):
        monkeypatch.setenv("ARCTIC_SIC_FORECAST_CACHE", str(CACHE_DIR))
        monkeypatch.setenv("ARCTIC_SIC_FORECAST_HORIZON", "1")
        config = DataConfig.from_env()
        assert config.sic_forecast_cache_dir == str(CACHE_DIR)
        assert config.sic_forecast_horizon == 1

    def test_env_fn_chains_with_current_adapter(self, native_grid):
        """SIC adapter leaves current_* fields for the CMEMS adapter."""
        from src.data.builder import build_env_fn_from_adapters

        field = SICForecastField(cache_dir=str(CACHE_DIR),
                                 route_start_datetime=ROUTE_START)
        rng = np.random.default_rng(1)
        template = type(native_grid)(
            n_rows=173, n_cols=369,
            lat=native_grid.lat.copy(), lon=native_grid.lon.copy(),
            navigable=np.ones((173, 369), dtype=bool),
            current_uo=rng.normal(0, 0.03, (173, 369)),
            current_vo=rng.normal(0, 0.03, (173, 369)),
            resolution_deg=0.25,
        )
        env_fn = build_env_fn_from_adapters(template, [field])
        grid = env_fn(0.0)
        assert np.array_equal(grid.current_uo, template.current_uo)
        assert np.array_equal(grid.current_vo, template.current_vo)
        assert grid.sic_mean is not None


# ---------------------------------------------------------------------------
# Read-only routing multiplier accessor
# ---------------------------------------------------------------------------

class TestMultiplierAccessor:

    def test_multiplier_shape(self, field):
        mult = field.multiplier(time_index=0)
        assert mult.shape == (173, 369)
        assert field.has_multiplier

    def test_multiplier_impassable_where_sic_nan(self, field):
        mult = field.multiplier(time_index=0)
        sic = field.sic_at_time(time_index=0)
        assert np.all(np.isinf(mult[np.isnan(sic)]))

    def test_multiplier_documented_values(self, field):
        mult = field.multiplier(time_index=0)
        finite = mult[np.isfinite(mult)]
        assert set(np.unique(finite).tolist()) <= {1.0, 2.0, 8.0, 50.0}

    def test_multiplier_matches_artifact(self, field):
        mult = np.load(str(CACHE_DIR / "routing_multiplier_2026.npy"),
                       mmap_mode="r")
        for idx in (0, 166):
            assert np.array_equal(field.multiplier(time_index=idx),
                                  np.asarray(mult[idx]).astype(np.float64),
                                  equal_nan=True)

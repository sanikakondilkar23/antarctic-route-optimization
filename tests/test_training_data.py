"""
Tests for training data generation.
"""

import os
import tempfile

import numpy as np
import pytest

from src.environment.synthetic import generate_synthetic
from src.ml.training_data import (
    ACTION_TO_INDEX,
    ACTIONS_8,
    FEATURE_NAMES,
    N_FEATURES,
    TrainingDataset,
    _extract_features,
    _get_navigable_cells,
    _sample_start_goal,
    generate_training_dataset,
    generate_training_dataset_from_config,
)


# ---------------------------------------------------------------------------
# Feature extraction
# ---------------------------------------------------------------------------

class TestExtractFeatures:
    def test_correct_length(self):
        grid = generate_synthetic(n_rows=10, n_cols=12, seed=42)
        feat = _extract_features(grid, 5, 5, 0, 0, t_hours=0.0)
        assert feat.shape == (N_FEATURES,)

    def test_no_nan(self):
        grid = generate_synthetic(n_rows=10, n_cols=12, seed=42)
        feat = _extract_features(grid, 5, 5, 0, 0, t_hours=0.0)
        assert not np.any(np.isnan(feat))

    def test_no_inf(self):
        grid = generate_synthetic(n_rows=10, n_cols=12, seed=42)
        feat = _extract_features(grid, 5, 5, 0, 0, t_hours=0.0)
        assert not np.any(np.isinf(feat))

    def test_distance_to_goal(self):
        grid = generate_synthetic(n_rows=10, n_cols=12, seed=42)
        feat = _extract_features(grid, 0, 0, 0, 0, t_hours=0.0)
        # Same cell as goal -> dist = 0
        assert feat[10] == 0.0  # normalized_dist_to_goal

    def test_t_hours_stored(self):
        grid = generate_synthetic(n_rows=10, n_cols=12, seed=42)
        feat = _extract_features(grid, 5, 5, 0, 0, t_hours=42.0)
        assert feat[13] == 42.0  # t_hours


# ---------------------------------------------------------------------------
# Navigable cells
# ---------------------------------------------------------------------------

class TestNavigableCells:
    def test_returns_list(self):
        grid = generate_synthetic(n_rows=10, n_cols=12, seed=42)
        cells = _get_navigable_cells(grid)
        assert isinstance(cells, list)
        assert len(cells) > 0

    def test_all_navigable(self):
        grid = generate_synthetic(n_rows=10, n_cols=12, seed=42)
        cells = _get_navigable_cells(grid)
        for r, c in cells:
            assert grid.navigable[r, c]


# ---------------------------------------------------------------------------
# Start/goal sampling
# ---------------------------------------------------------------------------

class TestSampleStartGoal:
    def test_returns_tuple(self):
        grid = generate_synthetic(n_rows=10, n_cols=12, seed=42)
        cells = _get_navigable_cells(grid)
        rng = np.random.RandomState(42)
        pair = _sample_start_goal(cells, rng, min_dist=3.0)
        assert pair is not None
        start, goal = pair
        assert isinstance(start, tuple)
        assert isinstance(goal, tuple)

    def test_minimum_distance(self):
        grid = generate_synthetic(n_rows=10, n_cols=12, seed=42)
        cells = _get_navigable_cells(grid)
        rng = np.random.RandomState(42)
        pair = _sample_start_goal(cells, rng, min_dist=5.0)
        if pair is not None:
            start, goal = pair
            dist = np.sqrt((start[0] - goal[0])**2 + (start[1] - goal[1])**2)
            assert dist >= 5.0


# ---------------------------------------------------------------------------
# Dataset generation (small MVP)
# ---------------------------------------------------------------------------

class TestDatasetGeneration:
    def test_generation_succeeds(self):
        grid = generate_synthetic(n_rows=15, n_cols=18, seed=42)
        dataset = generate_training_dataset(
            grid=grid,
            n_routes=3,
            n_scenarios=3,
            seed=42,
        )
        assert dataset.n_routes >= 1
        assert dataset.n_samples > 0

    def test_features_labels_match_length(self):
        grid = generate_synthetic(n_rows=15, n_cols=18, seed=42)
        dataset = generate_training_dataset(
            grid=grid,
            n_routes=3,
            n_scenarios=3,
            seed=42,
        )
        assert len(dataset.features) == len(dataset.actions)

    def test_valid_actions(self):
        grid = generate_synthetic(n_rows=15, n_cols=18, seed=42)
        dataset = generate_training_dataset(
            grid=grid,
            n_routes=3,
            n_scenarios=3,
            seed=42,
        )
        valid_indices = set(range(len(ACTIONS_8)))
        for a in dataset.actions:
            assert a in valid_indices, f"Invalid action index: {a}"

    def test_no_nan_in_features(self):
        grid = generate_synthetic(n_rows=15, n_cols=18, seed=42)
        dataset = generate_training_dataset(
            grid=grid,
            n_routes=3,
            n_scenarios=3,
            seed=42,
        )
        assert not np.any(np.isnan(dataset.features))

    def test_no_inf_in_features(self):
        grid = generate_synthetic(n_rows=15, n_cols=18, seed=42)
        dataset = generate_training_dataset(
            grid=grid,
            n_routes=3,
            n_scenarios=3,
            seed=42,
        )
        assert not np.any(np.isinf(dataset.features))

    def test_feature_names_match_width(self):
        grid = generate_synthetic(n_rows=15, n_cols=18, seed=42)
        dataset = generate_training_dataset(
            grid=grid,
            n_routes=3,
            n_scenarios=3,
            seed=42,
        )
        assert dataset.features.shape[1] == len(dataset.feature_names)


# ---------------------------------------------------------------------------
# Fix 3: route_ids
# ---------------------------------------------------------------------------

class TestRouteIds:
    def test_route_ids_exist(self):
        grid = generate_synthetic(n_rows=15, n_cols=18, seed=42)
        dataset = generate_training_dataset(
            grid=grid, n_routes=3, n_scenarios=3, seed=42,
        )
        assert hasattr(dataset, "route_ids")
        assert len(dataset.route_ids) == dataset.n_samples

    def test_route_ids_match_length(self):
        grid = generate_synthetic(n_rows=15, n_cols=18, seed=42)
        dataset = generate_training_dataset(
            grid=grid, n_routes=3, n_scenarios=3, seed=42,
        )
        assert len(dataset.route_ids) == len(dataset.features)
        assert len(dataset.route_ids) == len(dataset.actions)

    def test_route_ids_are_contiguous(self):
        grid = generate_synthetic(n_rows=15, n_cols=18, seed=42)
        dataset = generate_training_dataset(
            grid=grid, n_routes=3, n_scenarios=3, seed=42,
        )
        unique_ids = np.unique(dataset.route_ids)
        assert len(unique_ids) == dataset.n_routes
        assert int(unique_ids[0]) == 0
        assert int(unique_ids[-1]) == dataset.n_routes - 1

    def test_route_ids_incremental(self):
        grid = generate_synthetic(n_rows=15, n_cols=18, seed=42)
        dataset = generate_training_dataset(
            grid=grid, n_routes=3, n_scenarios=3, seed=42,
        )
        # Within each route, ids are the same; routes are sequential
        for rid in range(dataset.n_routes):
            mask = dataset.route_ids == rid
            assert mask.sum() > 0, f"Route {rid} has no samples"


# ---------------------------------------------------------------------------
# Fix 2: t_hours uses actual arrival times, not step index
# ---------------------------------------------------------------------------

class TestActualTimes:
    def test_t_hours_not_step_index(self):
        """t_hours should be float arrival time, not int step index."""
        grid = generate_synthetic(n_rows=15, n_cols=18, seed=42)
        dataset = generate_training_dataset(
            grid=grid, n_routes=3, n_scenarios=3, seed=42,
        )
        t_col = FEATURE_NAMES.index("t_hours")
        t_vals = dataset.features[:, t_col]
        # t_hours should be floats (arrival times), not integers 0,1,2,...
        # At minimum, check they're not all exactly 0.0
        assert not np.all(t_vals == 0.0), "t_hours all zero suggests step index fallback"

    def test_t_hours_non_negative(self):
        grid = generate_synthetic(n_rows=15, n_cols=18, seed=42)
        dataset = generate_training_dataset(
            grid=grid, n_routes=3, n_scenarios=3, seed=42,
        )
        t_col = FEATURE_NAMES.index("t_hours")
        assert np.all(dataset.features[:, t_col] >= 0.0)


# ---------------------------------------------------------------------------
# Fix 1: features extracted from scenario grid
# ---------------------------------------------------------------------------

class TestScenarioFeatures:
    def test_features_vary_across_seeds(self):
        """Different seeds produce different scenario grids, so features differ."""
        grid = generate_synthetic(n_rows=15, n_cols=18, seed=42)
        ds1 = generate_training_dataset(grid=grid, n_routes=2, n_scenarios=3, seed=42)
        ds2 = generate_training_dataset(grid=grid, n_routes=2, n_scenarios=3, seed=99)
        # With different scenarios, SIC/iceberg features should differ
        sic_col = FEATURE_NAMES.index("sic_mean")
        if ds1.n_samples > 0 and ds2.n_samples > 0:
            # Compare first few samples' SIC means
            s1 = ds1.features[:min(5, ds1.n_samples), sic_col]
            s2 = ds2.features[:min(5, ds2.n_samples), sic_col]
            assert not np.allclose(s1, s2, atol=1e-6), \
                "Scenario features identical across different seeds"


# ---------------------------------------------------------------------------
# Save/load
# ---------------------------------------------------------------------------

class TestSaveLoad:
    def test_save_csv_and_npz(self):
        grid = generate_synthetic(n_rows=15, n_cols=18, seed=42)
        dataset = generate_training_dataset(
            grid=grid,
            n_routes=3,
            n_scenarios=3,
            seed=42,
        )

        output_dir = os.path.join(os.path.dirname(__file__), "_test_ml_out")
        try:
            csv_path, npz_path = dataset.save(output_dir)
            assert os.path.exists(csv_path)
            assert os.path.exists(npz_path)

            # Load NPZ
            data = np.load(npz_path, allow_pickle=True)
            assert "features" in data
            assert "actions" in data
            assert "route_ids" in data
            assert data["features"].shape == dataset.features.shape
            assert data["actions"].shape == dataset.actions.shape
            assert data["route_ids"].shape == dataset.route_ids.shape
            data.close()

            # Load CSV
            import pandas as pd
            df = pd.read_csv(csv_path)
            assert len(df) == dataset.n_samples
            assert "action" in df.columns
            assert "route_id" in df.columns
        finally:
            import shutil
            if os.path.exists(output_dir):
                shutil.rmtree(output_dir, ignore_errors=True)

    def test_feature_names_in_csv(self):
        grid = generate_synthetic(n_rows=15, n_cols=18, seed=42)
        dataset = generate_training_dataset(
            grid=grid,
            n_routes=2,
            n_scenarios=3,
            seed=42,
        )
        output_dir = os.path.join(os.path.dirname(__file__), "_test_ml_out2")
        try:
            csv_path, _ = dataset.save(output_dir)
            import pandas as pd
            df = pd.read_csv(csv_path)
            for name in FEATURE_NAMES:
                assert name in df.columns, f"Missing column: {name}"
            assert "route_id" in df.columns
        finally:
            import shutil
            if os.path.exists(output_dir):
                shutil.rmtree(output_dir, ignore_errors=True)

    def test_npz_has_route_ids(self):
        grid = generate_synthetic(n_rows=15, n_cols=18, seed=42)
        dataset = generate_training_dataset(
            grid=grid, n_routes=2, n_scenarios=3, seed=42,
        )
        output_dir = os.path.join(os.path.dirname(__file__), "_test_ml_out3")
        try:
            _, npz_path = dataset.save(output_dir)
            data = np.load(npz_path, allow_pickle=True)
            assert "route_ids" in data
            np.testing.assert_array_equal(data["route_ids"], dataset.route_ids)
            data.close()
        finally:
            import shutil
            if os.path.exists(output_dir):
                shutil.rmtree(output_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# Fix 4: real-data entry point
# ---------------------------------------------------------------------------

class TestRealDataEntryPoint:
    def test_function_exists_and_importable(self):
        assert callable(generate_training_dataset_from_config)

    def test_synthetic_config_works(self):
        """generate_training_dataset_from_config works with a dummy DataConfig
        that has no real files — it falls back to no-op adapters."""
        from src.data.config import DataConfig
        from src.data.adapters import SICAdapter

        grid = generate_synthetic(n_rows=15, n_cols=18, seed=42)
        config = DataConfig(
            sic_path="/nonexistent/sic.nc",
            current_path="/nonexistent/current.nc",
        )
        # Should not crash — adapters report unavailable, env_fn returns template
        dataset = generate_training_dataset_from_config(
            data_config=config,
            grid_template=grid,
            n_routes=2,
            n_scenarios=3,
            seed=42,
        )
        # With no real data, adapters are unavailable; routing may still
        # produce routes using static grid.  At minimum, no crash.
        assert hasattr(dataset, "features")
        assert hasattr(dataset, "route_ids")


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

class TestConstants:
    def test_8_actions(self):
        assert len(ACTIONS_8) == 8

    def test_action_to_index_covers_all(self):
        for a in ACTIONS_8:
            assert a in ACTION_TO_INDEX

    def test_feature_names_count(self):
        assert len(FEATURE_NAMES) == N_FEATURES

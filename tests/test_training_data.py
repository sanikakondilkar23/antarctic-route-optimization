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
        # Same cell as goal → dist = 0
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
            assert data["features"].shape == dataset.features.shape
            assert data["actions"].shape == dataset.actions.shape
            data.close()

            # Load CSV
            import pandas as pd
            df = pd.read_csv(csv_path)
            assert len(df) == dataset.n_samples
            assert "action" in df.columns
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
        finally:
            import shutil
            if os.path.exists(output_dir):
                shutil.rmtree(output_dir, ignore_errors=True)


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

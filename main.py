"""
Antarctic Uncertainty-Aware Maritime Route Optimization
=======================================================

Step 1: Project environment verification.

This file ONLY verifies that the project environment is correctly set up.
No routing algorithms are implemented here.
"""

import sys
import numpy as np


def check_python_version():
    """Verify Python version meets minimum requirements."""
    major, minor = sys.version_info[:2]
    assert major == 3 and minor >= 11, (
        f"Python 3.11+ required, found {major}.{minor}"
    )
    return f"Python {major}.{minor} [OK]"


def check_numpy():
    """Verify NumPy is available."""
    return f"NumPy {np.__version__} [OK]"


def check_project_structure():
    """Verify expected directories exist."""
    from pathlib import Path

    base = Path(__file__).parent
    expected = [
        "data/raw",
        "data/processed",
        "data/test",
        "src/environment",
        "src/routing",
        "src/risk",
        "src/uncertainty",
        "src/utils",
        "experiments",
        "outputs/routes",
        "outputs/metrics",
        "outputs/figures",
        "tests",
        "research",
    ]
    missing = [d for d in expected if not (base / d).is_dir()]
    if missing:
        return f"Missing directories: {missing}"
    return f"Project structure: {len(expected)} directories [OK]"


def main():
    """Run all verification checks."""
    print("=" * 60)
    print("Antarctic Route Optimization System")
    print("Step 1 — Research Audit + Project Foundation")
    print("=" * 60)
    print()

    checks = [
        ("Python version", check_python_version),
        ("NumPy", check_numpy),
        ("Project structure", check_project_structure),
    ]

    all_passed = True
    for name, check_fn in checks:
        try:
            result = check_fn()
            print(f"  [{name}] {result}")
        except Exception as e:
            print(f"  [{name}] FAILED: {e}")
            all_passed = False

    print()
    if all_passed:
        print("All checks passed. Project environment is ready.")
        print()
        print("Next: STEP 2 — Environment Representation + Baseline Design")
    else:
        print("Some checks failed. Fix issues before proceeding.")
        sys.exit(1)


if __name__ == "__main__":
    main()

"""
Conditional Value-at-Risk (CVaR) for Route Selection
=====================================================

Computes CVaR (Expected Shortfall) from a set of scenario costs.

Definition:
    Given K scenario costs sorted ascending: c_(1) <= ... <= c_(K)
    VaR_alpha = c_(ceil(alpha*K))       -- the alpha-quantile
    CVaR_alpha = mean of worst ceil(alpha*K) observations

With K=15 and alpha=0.05:
    ceil(0.05 * 15) = 1
    CVaR = mean of worst 1 scenario = max(costs)
    VaR  = max(costs)

Both are identical in this regime because the worst alpha-fraction
contains exactly one scenario.

References:
    - Rockafellar & Uryasev (2000) — Optimization of conditional value-at-risk
    - Nuñez et al. (2023) — CVaR in stochastic ship routing (IROS)
"""

from __future__ import annotations

import math
from typing import List, Tuple


def compute_cvar(
    costs: List[float],
    alpha: float = 0.05,
) -> Tuple[float, float]:
    """
    Compute Value-at-Risk and Conditional Value-at-Risk.

    Parameters
    ----------
    costs : list of float
        Scenario costs (one per scenario).  Must have at least 1 element.
    alpha : float
        Risk significance level in (0, 1].
        alpha=0.05 means we care about the worst 5% of scenarios.

    Returns
    -------
    (var, cvar) : tuple of float
        VaR_alpha  -- the alpha-quantile cost
        CVaR_alpha -- mean of the worst ceil(alpha*K) costs

    Raises
    ------
    ValueError
        If costs is empty or alpha is not in (0, 1].

    Notes
    -----
    This uses the empirical (historical) CVaR definition:
        n_tail = ceil(alpha * K)
        VaR  = sorted_costs[-n_tail]       (the smallest value in the tail)
        CVaR = mean(sorted_costs[-n_tail:]) (average of the tail)

    With K=15, alpha=0.05: n_tail=1, CVaR = max(costs), VaR = max(costs).
    """
    if not costs:
        raise ValueError("costs must be non-empty")
    if not (0.0 < alpha <= 1.0):
        raise ValueError(f"alpha must be in (0, 1], got {alpha}")

    sorted_costs = sorted(costs)
    k = len(sorted_costs)
    n_tail = max(1, math.ceil(alpha * k))

    var = sorted_costs[-n_tail]
    cvar = sum(sorted_costs[-n_tail:]) / n_tail

    return var, cvar

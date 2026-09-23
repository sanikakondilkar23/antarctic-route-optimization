# Research Audit: Existing Solutions for Antarctic Maritime Route Optimization

> **Date**: September 2026  
> **Purpose**: Identify what has already been built, what is common, and what might be differentiated.  
> **Status**: Step 1 — Research Audit (NOT final algorithm selection)

---

## 1. Methodology

This audit inspects:
- 4 direct SIH 2026 competitor repositories (code-level, not just README)
- 6 additional GitHub repositories related to polar/ice routing
- 10+ academic papers on stochastic/robust/CVaR routing
- Established open-source routing tools

**Important**: Every claim below is based on actual code inspection where possible, or on the stated source. README claims are explicitly separated from verified implementations.

---

## 2. Competitor Repositories — Code-Level Analysis

### 2.1 polarpath-ai (Team AXIOM)

| Attribute | Finding |
|-----------|---------|
| **Algorithm** | **NOT A\* or D\* Lite** despite README claims. Code is a hardcoded waypoint builder — pre-defined static coordinate arrays for ~5 routes. Zero graph search. |
| **Cost function** | Risk formula exists in `risk_engine.py` but SIC is faked from latitude formula, not satellite data. |
| **Uncertainty** | Linear time penalty (`15.0 + h * 1.35`), not spatially varying. No expanding cones despite README claims. |
| **Data** | All synthetic. Labeled as such. |
| **Validation** | 0 tests. |
| **Verdict** | **Frontend demo with scripted routes, not a routing engine.** |

### 2.2 POLAR-NAV AI (sumonachatterjeebw-byte)

| Attribute | Finding |
|-----------|---------|
| **Algorithm** | **Genuine A\*** on lat/lon lattice with 16-way connectivity. Two searches: ice-blind baseline and ice-aware optimized route. |
| **Cost function** | `fuel * w_fuel + time * w_time + risk * w_risk`. Risk includes POLARIS RIO, Lindqvist ice resistance (real physics), compression index, coastal clearance. |
| **Uncertainty** | Icebergs tracked as `DriftingExclusion` objects with **growing uncertainty radii** (`base_radius + uncertainty_growth * hours/24`). This is real time-dependent spatial uncertainty for icebergs. SIC uncertainty not modeled. |
| **Data** | Synthetic but physically grounded. Semi-Lagrangian SIC advection, Stefan thickness growth, real Natural Earth coastline (97 polygons), real POLARIS tables. |
| **Validation** | **106 pytest tests**. Forecast skill verified against persistence. Honest negative results reported (-8% fuel on some legs). |
| **Verdict** | **Most technically rigorous competitor. Real A\*, real physics, honest validation.** |

### 2.3 SIH_2026 (2023abhisheksharma)

| Attribute | Finding |
|-----------|---------|
| **Algorithm** | **Real Multi-Objective A\*** on lat/lon grid, 16-way connectivity, haversine heuristic. |
| **Cost function** | `w_dist*dist + w_fuel*fuel + w_risk*risk*dist + w_time*time`. Risk from SIC, iceberg proximity, weather. |
| **Uncertainty** | Distance thresholds only (4/12/25 NM). No trajectory prediction, no expanding cones. |
| **Data** | Demo data throughout. No real satellite ingestion. |
| **Validation** | 11 tests. 3 commits — early stage. |
| **Verdict** | **Real A\* but demo data. Not competitive with POLAR-NAV AI.** |

### 2.4 POLARNAV (ghildiyalnitin067-a11y)

| Attribute | Finding |
|-----------|---------|
| **Algorithm** | **Full A\* on EPSG:3031** (Antarctic Polar Stereographic) with Chaikin smoothing, curvature-constrained shortcuts, bathymetric clearance. |
| **Cost function** | 7-factor: distance, SIC (quadratic), iceberg (Gaussian repulsion), current, weather, bathymetry, fuel. SIC penalty: `((SIC/100)^2) * w * 2.5`. Iceberg: `exp(-0.5*(dist/(clearance*0.4))^2) * 25.0`. |
| **Uncertainty** | Iceberg trajectories projected to 0-48h with KDTree spatial indexing. No explicit uncertainty cones. |
| **Data** | Real NOAA/NSIDC SIC, BYU/NIC iceberg catalogue (522 tracks), GEBCO bathymetry, Sentinel-1 SAR, Copernicus currents, ERA5 weather. |
| **Validation** | **259 tests** across 24 suites. Historical backtest against R/V Aurora Australis 2015/16. |
| **Verdict** | **Most feature-complete. Real data, real A\*, comprehensive testing.** |

---

## 3. Additional GitHub Repositories

### 3.1 poojitha-220929/antarctic-ai-navigation

| Attribute | Finding |
|-----------|---------|
| **Algorithm** | Multi-objective A\* grid pathfinder, 3 candidate routes (Safest/Fuel-Efficient/Balanced). |
| **Uncertainty** | **Kalman filter** for iceberg trajectory with expanding covariance (±1.2km at 6h to ±21.4km at 48h). Physics-informed drift with Coriolis. |
| **Data** | Synthetic data generator. ML models: Random Forest for SIC forecasting. |
| **Dynamic** | Yes — dynamic rerouting on hazard detection. |
| **Verdict** | **Interesting Kalman-based iceberg uncertainty, but SIC uncertainty not addressed.** |

### 3.2 52North/WeatherRoutingTool

| Attribute | Finding |
|-----------|---------|
| **Algorithm** | **Production-grade**: Dijkstra, Isochrone, Isofuel, GCR Slider, Genetic algorithm. |
| **Uncertainty** | Consumes time-varying GFS/ECMWF forecasts. No explicit uncertainty propagation. |
| **Data** | Real GFS/ECMWF weather via API. |
| **Dynamic** | Yes — isochrone/isofuel handle time-varying weather. |
| **Maturity** | **65 stars, 1141 commits.** Funded by BMWi and EU Horizon Europe. Most mature open-source weather routing tool. |
| **Verdict** | **Gold standard for general weather routing. Not Antarctic/ice-specific.** |

### 3.3 ishank1701/antarctic-maritime-intelligence-system

| Attribute | Finding |
|-----------|---------|
| **Algorithm** | Spatiotemporal graph optimizer, 4 candidate routes evaluated simultaneously. |
| **Uncertainty** | Iceberg trajectories with **R50, R80, R95 confidence corridors** over 7-day horizon using 14-head XGBoost. ConvLSTM for SIC. |
| **Data** | Open-Meteo Marine API (live), Copernicus CDS, ERA5. |
| **Dynamic** | Yes — time-stepped forecast visualization. |
| **Verdict** | **Most sophisticated uncertainty handling for icebergs. But uses regression heads, not full scenario-based routing.** |

### 3.4 Other repos (muni-iitdh, Yash22222, ZYTRONA)

| Repo | Finding |
|------|---------|
| muni-iitdh/antarctica-navigation-ai | Candidate route scoring, not graph search. Basic. |
| Yash22222/Arctic-Route-Optimization-System | **Frontend-only React mockup.** No backend routing. |
| ZYTRONA/SIH2026 | **Frontend-only React mockup.** No backend routing. |

---

## 4. Academic Literature — Key Findings

### 4.1 CVaR / Risk-Averse Routing (EXISTS in general maritime)

| Paper | Year | Key Finding |
|-------|------|-------------|
| Nuñez et al. — "Risk-Aware Stochastic Ship Routing Using CVaR" | 2023 (IROS) | CVaR in A\* objective for weather routing. Uses ensemble forecasts. Bridges gap between average-case and worst-case. |
| SINTEF — "Arctic route planning under ice uncertainty: A risk-averse stochastic shortest path" | 2025 | **Directly relevant.** CVaR-based stochastic shortest path for Arctic ice uncertainty. Risk-averse transit time estimation. |
| Nunez et al. — "Risk-aware stochastic ship routing using constrained CBTS" | 2024 (Ocean Eng.) | Continuous Belief Tree Search with CVaR constraint. |
| Ensemble-forecast uncertainty-robust framework | 2026 (CIE) | Min-max Pareto optimization with ensemble forecasts for weather routing. |
| Ahmadi et al. — "Risk-Averse Stochastic Shortest Path Planning" | 2021 (arXiv) | CVaR and EVaR in MDP shortest path. Theoretical foundation. |
| Hansen — "Uncertainty-Aware Decision Making for Safe Navigation" | 2024 | Decision-making under vessel encounter uncertainty. |

### 4.2 Scenario-Based / Robust Optimization (EXISTS in general shipping)

| Paper | Year | Key Finding |
|-------|------|-------------|
| Robust liner ship routing (NSR) | 2022 | Robust optimization for Northern Sea Route under uncertain weather/ocean. |
| Uncertainty in maritime routing review | 2023 | 99 publications reviewed. Stochastic/robust optimization "remains rare outside weather routing." |
| Corridor-scale sea-ice navigability | 2026 (Frontiers) | Interannual volatility of ice navigability. Route-level vs corridor-mean analysis. |
| Tran — "Route optimization for vessels in ice" | 2023 | POLARIS + CII optimization. Operational considerations. |

### 4.3 Polar-Specific Routing

| Paper/System | Year | Key Finding |
|-------------|------|-------------|
| Smith et al. — PolarRoute (BAS) | 2025 (JAIR) | Dijkstra on non-uniform adaptive mesh. Path smoothing. Validated in Weddell Sea. **Gold standard. No uncertainty handling.** |
| Lee et al. — "Ship route planning in Arctic based on POLARIS" | 2021 | A\* + POLARIS. Cited 98 times. |
| SOIPS v1.0 — Southern Ocean Ice Prediction | 2024 (GMD) | Operational SIC forecasting for Antarctic navigation support. |

---

## 5. What Is Already Common (Category A)

These approaches are **heavily explored** and should NOT be claimed as novel:

| Approach | Evidence |
|----------|----------|
| A\* on a grid with weighted environmental cost | All 4 SIH competitors, POLARNAV, poojitha, ishank1701 |
| Dijkstra on shipping lanes or mesh | PolarRoute (BAS), 52North, eurostat/searoute |
| Weighted sum cost function (distance + SIC + iceberg + weather) | Every SIH competitor |
| Multiple route alternatives with different weight profiles | POLARNAV (3 corridors), SIH_2026 (3 routes), poojitha (3 routes) |
| POLARIS risk integration | POLAR-NAV AI, POLARNAV, Tran 2023 |
| Lindqvist ice resistance model | POLAR-NAV AI, PolarRoute, Tran 2023 |
| Basic dynamic rerouting demo | SIH_2026, poojitha, ishank1701 |
| Iceberg proximity as Gaussian field | POLARNAV (Gaussian repulsion) |

## 6. What Exists but Is Adaptable (Category B)

These exist in the literature but have NOT been applied to Antarctic ice-aware routing:

| Approach | Where It Exists | Antarctic Application |
|----------|----------------|----------------------|
| CVaR in ship routing | Nuñez 2023 (weather), SINTEF 2025 (Arctic ice) | **NOT in any Antarctic implementation** |
| Ensemble-based route evaluation | Ensemble-forecast framework 2026, WindMar (Monte Carlo) | **NOT in any SIH competitor** |
| Scenario generation from forecast uncertainty | Standard in stochastic optimization | **NOT in any Antarctic routing system** |
| Kalman filter for iceberg uncertainty | poojitha (limited), ishank1701 (XGBoost heads) | Partial — not propagated into routing cost |
| Expanding uncertainty cones for icebergs | POLAR-NAV AI (icebergs only), poojitha (Kalman) | Partial — SIC uncertainty not addressed |

## 7. What Is a Combination of Existing Techniques (Category C)

| Combination | Components | Status |
|------------|-----------|--------|
| A\* + scenario evaluation + CVaR selection | A\* (standard) + scenarios (standard in stochastic opt.) + CVaR (standard risk measure) | **Exists in general form (Nuñez 2023) but NOT applied to ice-aware Antarctic routing** |
| A\* + non-uniform mesh + path smoothing | PolarRoute (BAS) implementation | **Exists and published (JAIR 2025)** |
| Multi-objective A\* + Pareto front | Standard in multi-objective optimization | **Exists in multiple implementations** |
| Physics-based iceberg drift + ML residual | poojitha, POLAR-NAV AI (partial) | **Exists but limited integration** |

## 8. What Appears Potentially Differentiated (Category D)

| Direction | Evidence | Differentiation Level |
|-----------|----------|----------------------|
| **Scenario-based uncertainty propagation into Antarctic ice routing** | No known Antarctic implementation routes over K forecast scenarios and selects based on CVaR/robustness. SINTEF 2025 does Arctic CVaR but their implementation is not open-source and focuses on transit time, not multi-factor routing. | **Potentially differentiated — needs verification that SINTEF code is not publicly available and that no other implementation exists** |
| **Joint SIC + iceberg uncertainty in routing cost** | Icebergs have expanding uncertainty (some repos handle this). SIC has forecast uncertainty (nobody propagates this into routing). Combining both in a single robustness framework is unexplored. | **Likely differentiated** |
| **Route robustness metrics (CVaR, P(violation), stability)** | No Antarctic system reports these. All compare routes on expected cost only. | **Likely differentiated** |
| **Ablation study quantifying value of uncertainty handling** | No existing system does this. All claim "uncertainty-aware" without measuring the improvement. | **Likely differentiated** |

---

## 9. Novelty Assessment Summary

### What Is Already Established (DO NOT claim as novel):
- A\* routing on environmental grids
- Weighted multi-factor cost functions
- POLARIS risk integration
- Lindqvist ice resistance
- Multiple candidate routes
- Dynamic rerouting demos
- Iceberg trajectory prediction
- CVaR in general maritime weather routing (Nuñez 2023, SINTEF 2025)

### What Requires Further Verification:
- Whether SINTEF's Arctic CVaR code is publicly available
- Whether any implementation propagates BOTH SIC and iceberg uncertainty into routing
- Whether ensemble-based route evaluation exists for Antarctic specifically

### What Appears Genuinely Differentiated:
- **Scenario-based robust A\* for Antarctic ice-aware routing**: Using K forecast scenarios from the SIC/iceberg models, evaluating routes across scenarios, and selecting via CVaR/robustness. This combines standard techniques but applies them to an underserved domain (Antarctic routing) where no implementation exists.
- **Quantitative robustness evaluation**: Measuring route performance under forecast error (CVaR, worst-case, P(violation)) rather than just expected cost.

### Honest Caveat:
This is an **adaptation and combination** of existing techniques (A\* + scenarios + CVaR) applied to a **new domain** (Antarctic ice routing with SIC+iceberg uncertainty). It is NOT a fundamentally new algorithm. Its value is in the **application** and in the **empirical demonstration** that uncertainty-aware routing produces more robust routes than deterministic routing in Antarctic conditions.

---

## 10. Comparison Table

| System | Algorithm | SIC | Iceberg | Uncertainty in Routing | Scenario Eval | CVaR/Robust | Dynamic | Validation | Data |
|--------|-----------|-----|---------|----------------------|---------------|-------------|---------|------------|------|
| polarpath-ai | Scripted waypoints | Faked | Hardcoded | Linear time penalty | No | No | No | 0 tests | Synthetic |
| POLAR-NAV AI | A\* (16-way) | Semi-Lagrangian | RK4 drift + exclusion zones | Iceberg cones only | No | No | Voyage sim | 106 tests | Synthetic |
| SIH_2026 (abhishek) | Multi-obj A\* | Demo | Distance thresholds | No | No | No | Hazard inject | 11 tests | Demo |
| POLARNAV (nitin) | A\* EPSG:3031 | NOAA/NSIDC | KDTree trajectories | Iceberg trajectories | No | No | Emergency div | 259 tests | Real |
| poojitha | A\* multi-obj | RF model | Kalman filter | Iceberg covariance | No | No | Yes | Yes (pytest) | Synthetic |
| 52North | Dijkstra/Isochrone/Genetic | No | No | Via forecast data | No | No | Yes (isochrone) | Extensive | Real GFS/ECMWF |
| ishank1701 | Graph optimizer | ConvLSTM | 14-head XGBoost | R50/R80/R95 corridors | No | No | Yes | Partial | Open-Meteo |
| PolarRoute (BAS) | Dijkstra mesh | Observed | No | No | No | No | No | Peer-reviewed | Real EO |
| **Our target** | **A\* + scenarios** | **Teammate forecast** | **Teammate forecast** | **K scenarios + CVaR** | **Yes** | **Yes** | **Re-plan** | **Ablation study** | **Teammate** |

---

## 11. Key Takeaways for Step 2

1. **A\* is the right base algorithm** — it is standard, fast, deterministic, and proven for this domain. We should use it.

2. **The differentiation is NOT in the routing algorithm itself** — it is in how we handle forecast uncertainty.

3. **Scenario generation + CVaR selection is the most promising direction** — it exists in general maritime literature but has NOT been applied to Antarctic ice-aware routing with SIC + iceberg uncertainty.

4. **We should NOT build**: Non-uniform mesh (PolarRoute already does this), NSGA-II (overkill for 2-3 objectives), deep RL (not implementable in time).

5. **We should build**: A clean A\* with environmental cost (as baseline), scenario generator, route evaluator across scenarios, and robustness metrics.

6. **The teammate interface is critical** — we need clean abstractions for consuming SIC forecasts (with uncertainty) and iceberg predictions (with uncertainty).

7. **Validation matters most** — an ablation study showing "uncertainty-aware routing is X% more robust than deterministic routing" is the key scientific contribution.

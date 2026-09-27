import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchMetadata, fetchSystemStatus, fetchLimitations, fetchRoute, fetchRouteAt,
  fetchRerouteDemo, fetchSlice, cachedSlice, fetchRouteProfile,
  fetchUncertainty, cachedUncertainty, fetchUncertaintySummary, fetchEnsemble,
  fetchCurrent, buildDiff,
  REROUTE_ORIGIN_STEP, REROUTE_TARGET_STEP,
} from './api.js'
import SicMap from './components/SicMap.jsx'
import FinalScreen from './components/FinalScreen.jsx'
import Timeline from './components/Timeline.jsx'
import { STAGES, STAGE_CARD } from './components/StageList.jsx'
import Header from './components/Header.jsx'
import LeftSidebar from './components/LeftSidebar.jsx'
import IntelRail from './components/IntelRail.jsx'

const ORIGIN_STEP = REROUTE_ORIGIN_STEP // D0 — the leg is planned here
const TARGET_STEP = REROUTE_TARGET_STEP // D3 — verified real reroute endpoint

const DEFAULT_LAYERS = {
  sic: true,
  nonNav: true,
  route: true,
  vessel: true,
  uncertainty: false,
  current: false,
  risk: false,
  rerouteDiff: false,
}

/**
 * Minimum perceivable busy window (ms).
 *
 * The backend caches A* plans, so a repeat click can resolve in a few
 * milliseconds. Without a floor the loading state and the map highlight
 * would never paint and the button would look like it did nothing. The
 * request is real either way — this only guarantees the transition is
 * actually visible on stage.
 */
const MIN_BUSY_MS = { route: 1100, reroute: 1800 }

const holdBusyWindow = async (t0, min) => {
  const left = min - (performance.now() - t0)
  if (left > 0) await new Promise((resolve) => setTimeout(resolve, left))
}

export default function App() {
  const [meta, setMeta] = useState(null)
  const [status, setStatus] = useState(null)
  const [limitations, setLimitations] = useState(null)
  const [ensemble, setEnsemble] = useState(null)
  const [uncSummary, setUncSummary] = useState(null)
  const [cmems, setCmems] = useState(null)
  const [route, setRoute] = useState(null)     // verified artifact (final_route.json)
  const [plan, setPlan] = useState(null)       // A* plan with SIC metrics, from /api/route/at
  const [profile, setProfile] = useState(null) // real SIC along the route
  const [reroute, setReroute] = useState(null) // real /api/reroute/3 result
  const [afterSlice, setAfterSlice] = useState(null)
  const [timestep, setTimestep] = useState(ORIGIN_STEP)
  const [slice, setSlice] = useState(null)
  const [horizon, setHorizon] = useState(0)
  const [uncertainty, setUncertainty] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState({ slice: false, route: false, reroute: false, profile: false, unc: false })
  const [error, setError] = useState(null)
  const [stage, setStage] = useState('intro')
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(160)
  const [layers, setLayers] = useState(DEFAULT_LAYERS)
  const [renderMode, setRenderMode] = useState('sic')
  const [sideBySide, setSideBySide] = useState(false)
  const [routeVisible, setRouteVisible] = useState(false)
  const [pulseT, setPulseT] = useState(null)
  const [vesselT, setVesselT] = useState(null)
  const [vesselPark, setVesselPark] = useState(0)
  const [flashKey, setFlashKey] = useState(0)
  const [planResult, setPlanResult] = useState(null)
  const [rrResult, setRrResult] = useState(null)
  const [focus, setFocus] = useState('env')
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(false)

  const pulseRef = useRef(null)
  const vesselRef = useRef(null)
  const playRef = useRef(null)

  /* ------------------------------------------------------------------ */
  /* The window itself must never scroll.                                */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
    const pin = () => { if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0) }
    window.addEventListener('scroll', pin, { passive: true })
    pin()
    return () => window.removeEventListener('scroll', pin)
  }, [])

  /* ------------------------------------------------------------------ */
  /* Bootstrap: metadata + status + verified route + A* plan metrics      */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [m, s, r, lim, ens, usum, cur] = await Promise.all([
          fetchMetadata(), fetchSystemStatus(), fetchRoute(), fetchLimitations(),
          fetchEnsemble(), fetchUncertaintySummary(), fetchCurrent(ORIGIN_STEP),
        ])
        if (!alive) return
        setMeta(m)
        setStatus(s)
        setLimitations(lim)
        setEnsemble(ens)
        setUncSummary(usum)
        setCmems(cur)
        if (r) {
          setRoute(r)
          // /api/route carries no SIC-along-route stats, so ask the backend
          // router for the D0 plan to populate the route metrics panel.
          try {
            const p = await fetchRouteAt(ORIGIN_STEP)
            if (alive) setPlan(p)
          } catch (e) {
            if (alive) setPlan(r)
          }
        }
      } catch (e) {
        if (!alive) return
        setError(e.message)
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [])

  /* ------------------------------------------------------------------ */
  /* Lazy per-timestep SIC slice                                          */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    let alive = true
    const cached = cachedSlice(timestep)
    if (cached) { setSlice(cached); return undefined }
    setBusy((b) => ({ ...b, slice: true }))
    fetchSlice(timestep)
      .then((s) => { if (alive) setSlice(s) })
      .catch((e) => { if (alive) setError(e.message) })
      .finally(() => { if (alive) setBusy((b) => ({ ...b, slice: false })) })
    return () => { alive = false }
  }, [timestep])

  /* ------------------------------------------------------------------ */
  /* Lazy per-timestep route profile (real SIC along the real route)       */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!layers.risk) return undefined
    let alive = true
    setBusy((b) => ({ ...b, profile: true }))
    fetchRouteProfile(timestep)
      .then((p) => { if (alive) setProfile(p) })
      .catch(() => { if (alive) setProfile(null) })
      .finally(() => { if (alive) setBusy((b) => ({ ...b, profile: false })) })
    return () => { alive = false }
  }, [timestep, layers.risk])

  /* ------------------------------------------------------------------ */
  /* Lazy uncertainty frame (artifact-backed, horizon 0..2)              */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const need = layers.uncertainty || sideBySide || renderMode === 'uncertainty'
    if (!need) return undefined
    const cached = cachedUncertainty(timestep, horizon)
    if (cached) { setUncertainty(cached); return undefined }
    let alive = true
    setBusy((b) => ({ ...b, unc: true }))
    fetchUncertainty(timestep, horizon)
      .then((u) => { if (alive) setUncertainty(u) })
      .catch((e) => { if (alive) setError(e.message) })
      .finally(() => { if (alive) setBusy((b) => ({ ...b, unc: false })) })
    return () => { alive = false }
  }, [timestep, horizon, layers.uncertainty, sideBySide, renderMode])

  /* ------------------------------------------------------------------ */
  /* Timeline autoplay — state only, never touches scroll                 */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    if (!playing || !meta) return undefined
    playRef.current = setInterval(() => {
      setTimestep((t) => (t + 1 >= meta.n_timesteps ? 0 : t + 1))
    }, speed)
    return () => clearInterval(playRef.current)
  }, [playing, meta, speed])

  /* ------------------------------------------------------------------ */
  /* Animation helpers                                                    */
  /* ------------------------------------------------------------------ */
  const stopAnims = useCallback(() => {
    if (pulseRef.current) { cancelAnimationFrame(pulseRef.current); pulseRef.current = null }
    if (vesselRef.current) { cancelAnimationFrame(vesselRef.current); vesselRef.current = null }
    setPulseT(null)
    setVesselT(null)
  }, [])

  const sweep = useCallback((ms = 2100) => {
    if (pulseRef.current) cancelAnimationFrame(pulseRef.current)
    const t0 = performance.now()
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms)
      setPulseT(t)
      if (t < 1) pulseRef.current = requestAnimationFrame(step)
      else { pulseRef.current = null; setPulseT(null) }
    }
    pulseRef.current = requestAnimationFrame(step)
  }, [])

  const sailVessel = useCallback((ms = 2400) => {
    if (vesselRef.current) cancelAnimationFrame(vesselRef.current)
    const t0 = performance.now()
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms)
      setVesselT(t)
      if (t < 1) vesselRef.current = requestAnimationFrame(step)
      else {
        vesselRef.current = null
        setVesselT(null)
        setVesselPark(1)
        window.setTimeout(() => setVesselPark(0), 3400)
      }
    }
    vesselRef.current = requestAnimationFrame(step)
  }, [])

  useEffect(() => stopAnims, [stopAnims])

  /* ------------------------------------------------------------------ */
  /* Stage changes are always visibly confirmed                          */
  /* ------------------------------------------------------------------ */
  const goStage = useCallback((key) => {
    setStage(key)
    setFlashKey((k) => k + 1)
    if (key === 'final') setPlaying(false)
    const card = STAGE_CARD[key]
    if (card) setFocus(card)
  }, [])

  /* ------------------------------------------------------------------ */
  /* ACTION 1 — OPTIMIZE ROUTE                                           */
  /* ------------------------------------------------------------------ */
  const onOptimize = useCallback(async () => {
    setBusy((b) => ({ ...b, route: true }))
    setError(null)
    setPlanResult({ tone: 'busy', text: `Querying /api/route/at/${timestep} · A* + CostMap on real SIC` })
    stopAnims()
    goStage('route')
    const t0 = performance.now()
    try {
      const r = await fetchRouteAt(timestep)
      await holdBusyWindow(t0, MIN_BUSY_MS.route)
      setPlan(r)
      setRouteVisible(true)
      setLayers((l) => ({ ...l, route: true, risk: true }))
      sweep()
      sailVessel()
      setPlanResult({
        tone: r.success ? 'ok' : 'bad',
        text: r.success
          ? `SUCCESS · ${r.waypoints} waypoints · ${Number(r.route_length_grid_units).toFixed(2)} units · mean SIC ${Number(r.mean_sic).toFixed(4)} · ${r.nan_cells_on_route} NaN cells`
          : `FAILED · no navigable path at D${timestep}`,
        date: r.date,
      })
    } catch (e) {
      setError(e.message)
      setPlanResult({ tone: 'bad', text: e.message })
    } finally {
      setBusy((b) => ({ ...b, route: false }))
    }
  }, [timestep, sweep, sailVessel, stopAnims, goStage])

  /* ------------------------------------------------------------------ */
  /* ACTION 2 — DYNAMIC REROUTE  (verified GET /api/reroute/3)            */
  /* ------------------------------------------------------------------ */
  const onReroute = useCallback(async () => {
    setBusy((b) => ({ ...b, reroute: true }))
    setError(null)
    stopAnims()
    setTimestep(TARGET_STEP)
    setRrResult({ tone: 'busy', text: `GET /api/reroute/3 · re-planning on the D${TARGET_STEP} real SIC forecast` })
    goStage('reroute')
    const t0 = performance.now()
    try {
      const [rr, after] = await Promise.all([
        fetchRerouteDemo(),      // GET /api/reroute/3?origin_timestep=0
        fetchSlice(TARGET_STEP),
      ])
      await holdBusyWindow(t0, MIN_BUSY_MS.reroute)
      setReroute(rr)
      setAfterSlice(after)
      setRouteVisible(true)
      setLayers((l) => ({ ...l, route: true, risk: true, rerouteDiff: true }))
      sweep(2500)
      sailVessel(2800)
      const same = rr.comparison?.changed_cells === 0
      setRrResult({
        tone: rr.status === 'SUCCESS' ? 'ok' : 'bad',
        text: rr.status === 'SUCCESS'
          ? `${rr.status} · D${rr.origin_timestep}→D${rr.reroute_timestep} (${rr.reroute_date}) · jaccard ${Number(rr.comparison.jaccard_overlap).toFixed(3)} · coverage ${Number(rr.comparison.route_coverage).toFixed(3)} · ${rr.comparison.changed_cells} changed cells${same ? ' · safe corridor unchanged' : ''}`
          : `${rr.status} · no route at D${rr.reroute_timestep}`,
      })
    } catch (e) {
      setError(e.message)
      setRrResult({ tone: 'bad', text: e.message })
    } finally {
      setBusy((b) => ({ ...b, reroute: false }))
    }
  }, [sweep, sailVessel, stopAnims, goStage])

  /* ------------------------------------------------------------------ */
  /* Derived geometry — API paths only, never fabricated                  */
  /* ------------------------------------------------------------------ */
  const primaryRoute = useMemo(() => {
    if (reroute?.rerouted_route?.path?.length) return reroute.rerouted_route.path
    if (plan?.path?.length) return plan.path
    if (route?.path?.length) return route.path
    return null
  }, [reroute, plan, route])

  useEffect(() => {
    if (primaryRoute) setRouteVisible(true)
  }, [primaryRoute])

  const originRoute = useMemo(() => {
    if (reroute?.original_route?.path?.length) return reroute.original_route.path
    if (reroute && plan?.path?.length) return plan.path
    if (reroute && route?.path?.length) return route.path
    return null
  }, [reroute, plan, route])

  const changedCells = useMemo(() => {
    if (!reroute || !reroute.original_route?.path) return null
    const n = reroute.comparison?.changed_cells
    if (!n) return new Set()
    const a = new Set(reroute.original_route.path.map(([r, c]) => `${r},${c}`))
    const b = new Set((reroute.rerouted_route?.path || []).map(([r, c]) => `${r},${c}`))
    const diff = new Set()
    a.forEach((k) => { if (!b.has(k)) diff.add(k) })
    b.forEach((k) => { if (!a.has(k)) diff.add(k) })
    return diff
  }, [reroute])

  const beforeSlice = slice
  const diff = useMemo(
    () => (beforeSlice && afterSlice ? buildDiff(beforeSlice, afterSlice) : null),
    [beforeSlice, afterSlice],
  )

  /** The plan currently drawn on the chart: rerouted > optimized > artifact. */
  const activePlan = reroute?.rerouted_route?.path?.length
    ? reroute.rerouted_route
    : plan || route

  const routeLabel = reroute
    ? `UPDATED D${reroute.reroute_timestep}`
    : plan
      ? `OPTIMIZED D${plan.timestep ?? timestep}`
      : 'AWAITING OPTIMIZE'

  const corridorUnchanged =
    !!reroute && reroute.comparison?.changed_cells === 0 && !!originRoute

  const availability = useMemo(() => ({
    sic: true,
    nonNav: true,
    route: true,
    vessel: true,
    uncertainty: (meta?.uncertainty_horizons ?? 0) > 0,
    current: !!cmems?.available,
    risk: true,
    rerouteDiff: !!reroute,
  }), [meta, cmems, reroute])

  /* ------------------------------------------------------------------ */
  /* Vessel telemetry — deterministic, from the real route polyline      */
  /* ------------------------------------------------------------------ */
  const vesselTNow = vesselT != null ? vesselT : (routeVisible && vesselPark ? 1 : null)
  const vessel = useMemo(() => {
    if (vesselTNow == null || !primaryRoute || !meta) return null
    const fi = vesselTNow * (primaryRoute.length - 1)
    const i0 = Math.floor(fi)
    const i1 = Math.min(primaryRoute.length - 1, i0 + 1)
    const f = fi - i0
    const r = primaryRoute[i0][0]
    const c = primaryRoute[i0][1]
    const sic = slice && slice.valid[r * slice.nCols + c]
      ? slice.values[r * slice.nCols + c] / 255
      : null
    return {
      lat: meta.lat[r],
      lon: meta.lon[c],
      progress: vesselTNow,
      sic,
      waypoint: i0 + 1,
      of: primaryRoute.length,
    }
  }, [vesselTNow, primaryRoute, slice, meta])

  /* ------------------------------------------------------------------ */
  /* The leg, for the on-chart START → DESTINATION readout                */
  /* ------------------------------------------------------------------ */
  const leg = useMemo(() => {
    const latlon = (v) =>
      `${Math.abs(Number(v[0])).toFixed(2)}°${Number(v[0]) < 0 ? 'S' : 'N'} ` +
      `${Math.abs(Number(v[1])).toFixed(2)}°E`
    const name = route?.leg?.name ? String(route.leg.name).split(/\s*(?:->|→)\s*/) : null
    const sl = route?.leg?.start_latlon
    const gl = route?.leg?.goal_latlon
    const start = sl
      ? `${name?.[0] || 'Start'} · ${latlon(sl)}`
      : (primaryRoute ? `cell ${primaryRoute[0][0]},${primaryRoute[0][1]}` : '—')
    const goal = gl
      ? `${name?.[1] || 'Destination'} · ${latlon(gl)}`
      : (primaryRoute
        ? `cell ${primaryRoute[primaryRoute.length - 1][0]},${primaryRoute[primaryRoute.length - 1][1]}`
        : '—')
    return { start, goal }
  }, [route, primaryRoute])

  const statusChip = useMemo(() => {
    if (busy.route) {
      return { tone: 'busy', lines: [`OPTIMIZING ROUTE — D${timestep}`,
        'A* + CostMap on real SIC'] }
    }
    if (busy.reroute) {
      return { tone: 'warn', lines: [`REROUTING — D${ORIGIN_STEP} → D${TARGET_STEP}`,
        're-planning on the later real forecast'] }
    }
    if (renderMode === 'diff') {
      return diff
        ? { tone: 'warn', lines: [
            'ENVIRONMENT DIFFERENCE — D0 → D3',
            `${diff.nIncreased.toLocaleString()} ↑ · ${diff.nDecreased.toLocaleString()} ↓ · max |Δ| ${diff.vmax.toFixed(3)}`,
          ] }
        : { tone: 'warn', lines: ['ENVIRONMENT DIFFERENCE', 'run DYNAMIC REROUTE to compute it'] }
    }
    if (renderMode === 'uncertainty') {
      return uncertainty
        ? { tone: 'busy', lines: [
            `FORECAST UNCERTAINTY — HORIZON ${uncertainty.horizon + 1} (D+${uncertainty.horizon + 1})`,
            `mean ${Number(uncertainty.stats.mean).toFixed(4)} · max ${Number(uncertainty.stats.max).toFixed(4)}`,
          ] }
        : { tone: 'busy', lines: ['FORECAST UNCERTAINTY', 'reading artifact…'] }
    }
    if (reroute) {
      return {
        tone: reroute.status === 'SUCCESS' ? 'ok' : 'bad',
        lines: [
          `ROUTE RE-OPTIMIZED — ${reroute.status} (D${reroute.reroute_timestep}, ${reroute.reroute_date})`,
          corridorUnchanged
            ? 'corridor unchanged · 0 cells changed · safe'
            : `${reroute.comparison?.changed_cells ?? 0} cells changed`,
        ],
      }
    }
    if (plan?.success) {
      return {
        tone: 'ok',
        lines: [
          `ROUTE OPTIMIZED — SUCCESS (D${plan.timestep}, ${plan.date})`,
          `${plan.waypoints} waypoints · ${Number(plan.max_sic).toFixed(4)} max SIC · ${plan.nan_cells_on_route} NaN cells`,
        ],
      }
    }
    return null
  }, [busy.route, busy.reroute, reroute, plan, corridorUnchanged, timestep, renderMode, diff, uncertainty])

  const s = slice?.stats

  /* ------------------------------------------------------------------ */
  /* Render                                                              */
  /* ------------------------------------------------------------------ */
  if (loading) {
    return (
      <div className="boot">
        <div className="spinner" />
        <div>Loading the real SIC forecast artifact from the backend…</div>
      </div>
    )
  }

  if (error && !meta) {
    return (
      <div className="boot">
        <h2>Backend unreachable</h2>
        <p>{error}</p>
        <p className="hint">Start it with <code>python -m backend.api.main</code></p>
      </div>
    )
  }

  return (
    <div className="app">
      <Header meta={meta} status={status} />

      {error ? <div className="errbar">⚠ {error}</div> : null}

      <div className="workspace">
        {/* ---------------------------------------------- LEFT: controls */}
        <LeftSidebar
          className={leftOpen ? 'open' : ''}
          meta={meta}
          stage={stage}
          setStage={goStage}
          flashKey={flashKey}
          layers={layers}
          setLayers={setLayers}
          availability={availability}
          renderMode={renderMode}
          setRenderMode={setRenderMode}
          diffAvailable={!!diff}
          busy={busy}
          plan={plan}
          route={route}
          reroute={reroute}
          onOptimize={onOptimize}
          onReroute={onReroute}
          legend={(
            <Legend
              renderMode={renderMode}
              stats={s}
              uncertainty={uncertainty}
              diff={diff}
              changed={changedCells}
              hasReroute={!!reroute}
              routeVisible={routeVisible}
              layers={layers}
              cmems={cmems}
            />
          )}
          onClose={() => setLeftOpen(false)}
        />

        {/* ------------------------------------------------ CENTER: map */}
        <section className="mapcol">
          <SicMap
            slice={slice}
            lat={meta.lat}
            lon={meta.lon}
            uncertainty={uncertainty}
            diff={diff}
            renderMode={renderMode}
            uncMax={uncertainty?.stats?.max ?? null}
            layers={layers}
            primaryRoute={primaryRoute}
            originRoute={originRoute}
            changedCells={changedCells}
            routeVisible={routeVisible && !!primaryRoute}
            pulseT={pulseT}
            vesselT={vesselTNow}
            corridorUnchanged={corridorUnchanged}
            statusChip={statusChip}
            hud={{
              timestep: slice?.timestep ?? 0,
              date: slice?.date ?? '—',
              showRoute: routeVisible && !!primaryRoute,
              routeLabel,
              waypoints: activePlan?.waypoints ?? primaryRoute?.length ?? '—',
              length: activePlan?.route_length_grid_units == null
                ? '—'
                : Number(activePlan.route_length_grid_units).toFixed(2),
              meanSic: activePlan?.mean_sic == null ? '—' : Number(activePlan.mean_sic).toFixed(4),
              maxSic: activePlan?.max_sic == null ? '—' : Number(activePlan.max_sic).toFixed(4),
              start: leg.start,
              goal: leg.goal,
              hasReroute: !!reroute,
              nonNav: !!layers.nonNav,
              vessel,
              source: renderMode === 'uncertainty'
                ? 'uncertainty_2026.npy'
                : renderMode === 'diff'
                  ? 'routing_sic_2026.npy Δ(D0,D3)'
                  : 'routing_sic_2026.npy',
            }}
          />
          <button
            type="button"
            className="drawer-tab left"
            onClick={() => { setLeftOpen((v) => !v); setRightOpen(false) }}
            aria-label="toggle controls"
          >
            ☰
          </button>
          <button
            type="button"
            className="drawer-tab right"
            onClick={() => { setRightOpen((v) => !v); setLeftOpen(false) }}
            aria-label="toggle intelligence"
          >
            ▤
          </button>
        </section>

        {/* ------------------------------------- RIGHT: compact intel */}
        <IntelRail
          className={rightOpen ? 'open' : ''}
          focus={focus}
          onFocus={setFocus}
          onClose={() => setRightOpen(false)}
          data={{
            slice, meta, uncertainty, uncSummary,
            horizon,
            setHorizon: (h) => {
              setHorizon(h)
              setRenderMode('uncertainty')
              setLayers((l) => ({ ...l, uncertainty: true }))
            },
            sideBySide,
            setSideBySide,
            onOverlay: () => {
              setRenderMode('sic')
              setLayers((l) => ({ ...l, uncertainty: !l.uncertainty }))
            },
            setRenderMode,
            busy, plan, route, reroute, planResult, rrResult, profile,
            src: activePlan,
            vesselT: vesselTNow,
            beforeSlice, afterSlice, diff, lat: meta.lat, lon: meta.lon,
            originRoute, primaryRoute,
            status, ensemble, limitations, cmems,
            originStep: ORIGIN_STEP, targetStep: TARGET_STEP,
          }}
        />
      </div>

      <Timeline
        metadata={meta}
        timestep={timestep}
        onChange={(t) => { setTimestep(t); if (stage !== 'final') goStage('change') }}
        playing={playing}
        onPlayToggle={() => setPlaying((p) => !p)}
        speed={speed}
        setSpeed={setSpeed}
        originStep={ORIGIN_STEP}
        targetStep={TARGET_STEP}
        rerouteTimestep={reroute ? reroute.reroute_timestep : null}
        onJump={(d) => setTimestep(d)}
        busy={busy}
      />

      {stage === 'final' ? (
        <FinalScreen
          meta={meta} route={route} plan={plan} reroute={reroute} profile={profile}
          onClose={() => goStage('environment')}
          onRerun={() => {
            setReroute(null); setAfterSlice(null); setPlan(null)
            setRouteVisible(false); setVesselPark(0)
            setLayers(DEFAULT_LAYERS)
            setRenderMode('sic')
            setTimestep(ORIGIN_STEP)
            goStage('intro')
          }}
        />
      ) : null}

      {/* visible confirmation banner on every stage transition */}
      <div className="stage-flash" key={flashKey} aria-live="polite">
        <span className="sf-n">
          {String((STAGES.find((x) => x.key === stage)?.num ?? 1)).padStart(2, '0')}
        </span>
        <span className="sf-t">{STAGES.find((x) => x.key === stage)?.label}</span>
        <span className="sf-s">/ 07</span>
      </div>
    </div>
  )
}

function Legend({ renderMode, stats, uncertainty, diff, changed, hasReroute, routeVisible, layers, cmems }) {
  return (
    <div className="legend">
      <div className="lg-items">
        {renderMode === 'uncertainty' ? (
          <>
            <span><i className="lg-swatch" style={{ background: 'linear-gradient(90deg,#0c0822,#2d1854,#582a82,#8c3c96,#c45c8c,#ee8c8c,#ffd6eb)' }} /> forecast uncertainty 0 → {uncertainty?.stats?.max?.toFixed(3) ?? '—'}</span>
            <span><i className="lg-swatch sw-nonnav" /> outside model domain (no value)</span>
          </>
        ) : renderMode === 'diff' && diff ? (
          <>
            <span><i className="lg-swatch" style={{ background: '#0a101a' }} /> unchanged</span>
            <span><i className="lg-swatch" style={{ background: '#12b3e0' }} /> ice retreated (Δ &lt; 0)</span>
            <span><i className="lg-swatch" style={{ background: '#f6a11a' }} /> ice advanced (Δ &gt; 0)</span>
            <span><i className="lg-swatch" style={{ background: '#facc15' }} /> became non-navigable</span>
            <span><i className="lg-swatch" style={{ background: '#38bdf8' }} /> became navigable</span>
          </>
        ) : (
          <>
            <span><i className="lg-swatch sw-sic" /> sea ice concentration 0.0 → 1.0</span>
            {layers.nonNav ? <span><i className="lg-swatch sw-nonnav" /> non-navigable (NaN)</span> : null}
          </>
        )}
        {routeVisible ? (
          <>
            <span><i className="lg-swatch sw-route" /> {hasReroute ? 'updated safe route' : 'optimized route (A* + CostMap)'}</span>
            {hasReroute ? <span><i className="lg-swatch sw-orig" /> original route (D0, dashed)</span> : null}
            {changed && changed.size > 0 ? <span><i className="lg-swatch sw-changed" /> changed cells ({changed.size})</span> : null}
            <span><i className="lg-swatch sw-start" /> start</span>
            <span><i className="lg-swatch sw-goal" /> destination</span>
            {layers.vessel ? <span><i className="lg-swatch" style={{ background: 'rgba(56,189,248,0.5)' }} /> vessel</span> : null}
          </>
        ) : null}
        {layers.uncertainty && renderMode === 'sic' && uncertainty ? (
          <span><i className="lg-swatch" style={{ background: 'linear-gradient(90deg,#2d1854,#c45c8c)' }} /> uncertainty overlay (H{horizonLabel(uncertainty)})</span>
        ) : null}
        {!cmems?.available ? (
          <span className="lg-off">Ocean current — Unavailable in current deployment</span>
        ) : null}
      </div>
      {stats ? (
        <div className="lg-stats">
          navigable <b>{stats.n_navigable.toLocaleString()}</b> · non-navigable{' '}
          <b>{stats.n_non_navigable.toLocaleString()}</b> · mean <b>{Number(stats.mean).toFixed(4)}</b>
        </div>
      ) : null}
    </div>
  )
}

function horizonLabel(u) {
  return u.horizon != null ? u.horizon + 1 : '?'
}

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchMetadata, fetchSystemStatus, fetchLimitations, fetchSlice, cachedSlice,
  fetchUncertainty, cachedUncertainty, fetchCurrent, fetchCoastline, buildDiff,
  optimizeRoute, rerouteRoute,
} from './api.js'
import SicMap from './components/SicMap.jsx'
import Timeline from './components/Timeline.jsx'
import Header from './components/Header.jsx'
import './planner.css'

/**
 * IceRoute-Robust — route-optimization planner.
 *
 *   INPUT (start, goal, forecast day)
 *     -> REAL SIC field + navigability constraints   (GET  /api/sic/<t>)
 *     -> A* + CostMap environmental cost map         (POST /api/route/optimize)
 *     -> OPTIMIZED ROUTE
 *     -> metrics + hard safety validation           (same response)
 *     -> DYNAMIC REROUTE on a later forecast day     (POST /api/route/reroute)
 *
 * The chart is drawn from the API's base64 SIC raster — there is no image
 * frame dependency of any kind. Every number on screen comes from a backend
 * response; this component computes no science.
 */

/** The verified real-data baseline: the leg used to validate the backend. */
const BASELINE = {
  start: { lat: -32.0, lon: 82.0 },
  goal: { lat: -70.0, lon: 10.5 },
  timestep: 0,
}

const PRESETS = [
  { name: 'Cape Town → Maitri', ...BASELINE },
  { name: 'Cape Town → Bharati', start: { lat: -32.0, lon: 82.0 }, goal: { lat: -69.41, lon: 76.19 }, timestep: 0 },
  { name: 'Cape Town → Maitri (mid-season)', start: { lat: -34.0, lon: 18.5 }, goal: { lat: -70.0, lon: 10.5 }, timestep: 100 },
  { name: 'Prydz Bay → Maitri', start: { lat: -68.0, lon: 75.0 }, goal: { lat: -70.0, lon: 10.5 }, timestep: 140 },
]

const fmt = (v, d = 4) =>
  v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(d)
const fmtInt = (v) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString())
const dms = (v, pos, neg) =>
  v == null || Number.isNaN(Number(v)) ? '—' : `${Math.abs(Number(v)).toFixed(2)}°${Number(v) < 0 ? neg : pos}`

export default function App() {
  const [meta, setMeta] = useState(null)
  const [status, setStatus] = useState(null)
  const [limitations, setLimitations] = useState(null)
  const [cmems, setCmems] = useState(null)
  const [coastline, setCoastline] = useState(null)
  const [fatal, setFatal] = useState(null)

  const [start, setStart] = useState(BASELINE.start)
  const [goal, setGoal] = useState(BASELINE.goal)
  const [timestep, setTimestep] = useState(BASELINE.timestep)
  const [rrTarget, setRrTarget] = useState(null) // null = follow the timeline

  const [slice, setSlice] = useState(null)
  const [uncertainty, setUncertainty] = useState(null)
  const [showUncertainty, setShowUncertainty] = useState(false)

  const [plan, setPlan] = useState(null) // POST /api/route/optimize response
  const [rr, setRr] = useState(null) // POST /api/route/reroute response
  const [rrBefore, setRrBefore] = useState(null) // SIC frame the reroute started from
  const [afterSlice, setAfterSlice] = useState(null)

  const [busy, setBusy] = useState({ slice: false, optimize: false, reroute: false })
  const [notice, setNotice] = useState(null) // {tone, text}
  const [pickMode, setPickMode] = useState(null) // 'start' | 'goal' | null
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(160)
  const [vesselT, setVesselT] = useState(null)

  const sweepRef = useRef(null)

  /* ------------------------------------------------------------------ */
  /* Bootstrap                                                            */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [m, s, lim, cur, coast] = await Promise.all([
          fetchMetadata(), fetchSystemStatus(), fetchLimitations(), fetchCurrent(0),
          fetchCoastline(),
        ])
        if (!alive) return
        setMeta(m)
        setStatus(s)
        setLimitations(lim)
        setCmems(cur)
        setCoastline(coast)
      } catch (e) {
        if (!alive) return
        setFatal(e.message)
      }
    })()
    return () => { alive = false }
  }, [])

  /* Real SIC raster for the selected day. Cached per timestep. */
  useEffect(() => {
    let alive = true
    const cached = cachedSlice(timestep)
    if (cached) { setSlice(cached); return undefined }
    setBusy((b) => ({ ...b, slice: true }))
    fetchSlice(timestep)
      .then((s) => { if (alive) setSlice(s) })
      .catch((e) => { if (alive) setNotice({ tone: 'bad', text: e.message }) })
      .finally(() => { if (alive) setBusy((b) => ({ ...b, slice: false })) })
    return () => { alive = false }
  }, [timestep])

  useEffect(() => {
    if (!showUncertainty) return undefined
    const cached = cachedUncertainty(timestep, 0)
    if (cached) { setUncertainty(cached); return undefined }
    let alive = true
    fetchUncertainty(timestep, 0)
      .then((u) => { if (alive) setUncertainty(u) })
      .catch(() => { if (alive) setUncertainty(null) })
    return () => { alive = false }
  }, [timestep, showUncertainty])

  useEffect(() => {
    if (!playing || !meta) return undefined
    const id = setInterval(() => setTimestep((t) => (t + 1 >= meta.n_timesteps ? 0 : t + 1)), speed)
    return () => clearInterval(id)
  }, [playing, meta, speed])

  /** Make an action visible on the chart without faking any result. */
  const sweep = useCallback((ms = 1600) => {
    if (sweepRef.current) cancelAnimationFrame(sweepRef.current)
    const t0 = performance.now()
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms)
      setVesselT(t)
      if (t < 1) sweepRef.current = requestAnimationFrame(step)
      else {
        sweepRef.current = null
        setVesselT(1)
        setTimeout(() => setVesselT(null), 2600)
      }
    }
    sweepRef.current = requestAnimationFrame(step)
  }, [])
  useEffect(() => () => { if (sweepRef.current) cancelAnimationFrame(sweepRef.current) }, [])

  /* ------------------------------------------------------------------ */
  /* ACTION — OPTIMIZE ROUTE  (real POST)                                */
  /* ------------------------------------------------------------------ */
  const onOptimize = useCallback(async () => {
    setBusy((b) => ({ ...b, optimize: true }))
    setNotice({ tone: 'busy', text: 'POST /api/route/optimize · A* + CostMap on the real SIC field' })
    setRr(null)
    setAfterSlice(null)
    setRrBefore(null)
    try {
      const res = await optimizeRoute({
        start_lat: start.lat, start_lon: start.lon,
        goal_lat: goal.lat, goal_lon: goal.lon,
        timestep,
      })
      setPlan(res)
      setTimestep(res.timestep)
      sweep()
      setNotice({
        tone: 'ok',
        text: `OPTIMIZED · ${res.waypoints} waypoints · ${fmt(res.route_length, 2)} grid units · ${fmt(res.route_length_km, 0)} km · mean SIC ${fmt(res.mean_sic)} · max ${fmt(res.max_sic)} · ${res.nan_cells} invalid cells`,
      })
    } catch (e) {
      setPlan(null)
      setNotice({ tone: 'bad', text: `REJECTED — ${e.reason || 'error'}: ${e.message}` })
    } finally {
      setBusy((b) => ({ ...b, optimize: false }))
    }
  }, [start, goal, timestep, sweep])

  /* ------------------------------------------------------------------ */
  /* ACTION — DYNAMIC REROUTE  (real POST on a later real field)         */
  /* ------------------------------------------------------------------ */
  const onReroute = useCallback(async () => {
    if (!plan) return
    const target = rrTarget == null ? Math.min(timestep + 1, (meta?.n_timesteps ?? 2) - 1) : rrTarget
    setBusy((b) => ({ ...b, reroute: true }))
    setNotice({ tone: 'busy', text: `POST /api/route/reroute · re-planning on the D${target} real SIC forecast` })
    try {
      const res = await rerouteRoute({
        original_route: {
          path: plan.path, start: plan.start, goal: plan.goal,
          timestep: plan.timestep, mean_sic: plan.mean_sic, max_sic: plan.max_sic,
        },
        new_timestep: target,
      })
      const [after] = await Promise.all([fetchSlice(res.new_timestep)])
      setRr(res)
      setRrBefore(slice)   // the D<origin> frame, captured before the timeline moves
      setAfterSlice(after)
      setTimestep(res.new_timestep)
      sweep(1800)
      const c = res.route_comparison
      setNotice({
        tone: 'ok',
        text: c.identical_path
          ? `RE-OPTIMIZED D${res.origin_timestep} → D${res.new_timestep} · corridor unchanged (0 cells changed) — the cost surface did not move the optimum`
          : `RE-OPTIMIZED D${res.origin_timestep} → D${res.new_timestep} · ${c.changed_cells} changed cells in ${res.changed_segments.length} segment(s) · overlap ${fmt(c.jaccard_overlap, 3)}`,
      })
    } catch (e) {
      setNotice({ tone: 'bad', text: `REROUTE REJECTED — ${e.reason || 'error'}: ${e.message}` })
    } finally {
      setBusy((b) => ({ ...b, reroute: false }))
    }
  }, [plan, rrTarget, timestep, meta, slice, sweep])

  const onPickCell = useCallback((cell) => {
    if (!pickMode) return
    const next = { lat: Number(cell.lat.toFixed(2)), lon: Number(cell.lon.toFixed(2)) }
    if (pickMode === 'start') setStart(next)
    else setGoal(next)
    setNotice({
      tone: cell.valid ? 'ok' : 'warn',
      text: cell.valid
        ? `${pickMode.toUpperCase()} set to ${dms(next.lat, 'N', 'S')} ${dms(next.lon, 'E', 'W')} (navigable cell)`
        : `${pickMode.toUpperCase()} set to a NON-NAVIGABLE cell — the backend will snap it or reject the route`,
    })
    setPickMode(null)
  }, [pickMode])

  const applyPreset = (p) => {
    setStart(p.start)
    setGoal(p.goal)
    setTimestep(p.timestep)
    setPlan(null)
    setRr(null)
    setNotice({ tone: 'busy', text: `Loaded “${p.name}” — press OPTIMIZE ROUTE to run A* + CostMap` })
  }

  /* ------------------------------------------------------------------ */
  /* Derived chart state                                                  */
  /* ------------------------------------------------------------------ */
  const primaryRoute = useMemo(() => {
    if (rr?.updated_route?.path?.length) return rr.updated_route.path
    if (plan?.path?.length) return plan.path
    return null
  }, [rr, plan])

  const originRoute = useMemo(
    () => (rr?.original_route?.path?.length ? rr.original_route.path : null),
    [rr],
  )

  const changedCells = useMemo(() => {
    if (!originRoute || !primaryRoute) return null
    const a = new Set(originRoute.map(([r, c]) => `${r},${c}`))
    const b = new Set(primaryRoute.map(([r, c]) => `${r},${c}`))
    const d = new Set()
    a.forEach((k) => { if (!b.has(k)) d.add(k) })
    b.forEach((k) => { if (!a.has(k)) d.add(k) })
    return d
  }, [originRoute, primaryRoute])

  const envDiff = useMemo(
    () => (rrBefore && afterSlice ? buildDiff(rrBefore, afterSlice) : null),
    [rrBefore, afterSlice],
  )

  /** Pending selection, in grid indices, for the pre-route chart state. */
  const selection = useMemo(() => {
    if (!meta || primaryRoute) return null
    const idx = (ll) => {
      let r = 0
      let c = 0
      let bd = Infinity
      meta.lat.forEach((v, i) => { const d = Math.abs(v - ll.lat); if (d < bd) { bd = d; r = i } })
      bd = Infinity
      meta.lon.forEach((v, i) => { const d = Math.abs(v - ll.lon); if (d < bd) { bd = d; c = i } })
      const nav = slice ? !!slice.valid[r * slice.nCols + c] : true
      return { row: r, col: c, navigable: nav }
    }
    return { start: idx(start), goal: idx(goal), lat: meta.lat, lon: meta.lon }
  }, [meta, start, goal, slice, primaryRoute])

  const s = slice?.stats
  const navPct = s && s.n_cells ? (s.n_navigable / s.n_cells) * 100 : null

  const statusChip = useMemo(() => {
    // Only while a request is in flight. Once a route is on the chart the
    // pipeline strip, the notice and the metrics card carry the status, and a
    // chip in the plate's top-left would sit on top of the route's start.
    if (busy.optimize) return { tone: 'busy', lines: [`OPTIMIZING — D${timestep}`, 'A* + CostMap on the real SIC field'] }
    if (busy.reroute) return { tone: 'warn', lines: [`REROUTING — D${rrTarget ?? timestep + 1}`, 're-planning on a later real forecast'] }
    return null
  }, [busy.optimize, busy.reroute, timestep, rrTarget])

  if (fatal) {
    return (
      <div className="boot">
        <h2>Backend unreachable</h2>
        <p>{fatal}</p>
        <p className="hint">Start it with <code>python -m backend.api.main</code></p>
      </div>
    )
  }

  return (
    <div className="planner">
      <Header meta={meta} status={status} />

      <div className="plan-main">
        {/* ==================================================== THE MAP */}
        <section className="mapcol">
          <SicMap
            slice={slice}
            lat={meta?.lat || []}
            lon={meta?.lon || []}
            uncertainty={uncertainty}
            renderMode={showUncertainty && uncertainty ? 'uncertainty' : 'sic'}
            uncMax={uncertainty?.stats?.max ?? null}
            layers={{
              sic: true,
              nonNav: true,
              route: true,
              vessel: true,
              uncertainty: showUncertainty,
              rerouteDiff: true,
            }}
            primaryRoute={primaryRoute}
            originRoute={originRoute}
            changedCells={changedCells}
            routeVisible={!!primaryRoute}
            selection={selection}
            pickMode={pickMode}
            onPickCell={onPickCell}
            coastline={coastline}
            pulseT={null}
            vesselT={vesselT}
            corridorUnchanged={!!rr && rr.route_comparison.identical_path}
            statusChip={statusChip}
            hud={{
              timestep: slice?.timestep ?? timestep,
              date: slice?.date ?? '—',
              showRoute: !!primaryRoute,
              routeLabel: rr ? `UPDATED D${rr.new_timestep}` : plan ? `OPTIMIZED D${plan.timestep}` : '—',
              waypoints: plan?.waypoints ?? '—',
              length: plan ? fmt(plan.route_length, 2) : '—',
              meanSic: plan ? fmt(plan.mean_sic) : '—',
              maxSic: plan ? fmt(plan.max_sic) : '—',
              start: `${dms(start.lat, 'N', 'S')} ${dms(start.lon, 'E', 'W')}`,
              goal: `${dms(goal.lat, 'N', 'S')} ${dms(goal.lon, 'E', 'W')}`,
              hasReroute: !!rr,
              originStep: rr?.origin_timestep ?? null,
              changedCells: changedCells ? changedCells.size : 0,
              navStats: s
                ? `navigable ${s.n_navigable.toLocaleString()}`
                  + `${navPct != null ? ` (${navPct.toFixed(1)}%)` : ''}`
                  + ` · non-navigable ${s.n_non_navigable.toLocaleString()}`
                : null,
              nonNav: true,
              vessel: null,
              source: 'routing_sic_2026.npy (API raster)',
            }}
          />

          {/* ----------------------------- pipeline strip (top centre) */}
          <div className="float pipeline" aria-label="pipeline">
            {[
              ['INPUT',
                `${dms(start.lat, 'N', 'S')}, ${dms(start.lon, 'E', 'W')} → ${dms(goal.lat, 'N', 'S')}, ${dms(goal.lon, 'E', 'W')}`,
                `${dms(start.lat, 'N', 'S')} → ${dms(goal.lat, 'N', 'S')}`],
              ['SIC FIELD', `D${slice?.timestep ?? timestep} · ${slice?.date ?? '—'}`, `D${slice?.timestep ?? timestep}`],
              ['NAVIGABILITY', s ? `${s.n_navigable.toLocaleString()} cells` : '—', s ? `${s.n_navigable.toLocaleString()}` : '—'],
              ['COST MAP', 'SIC + distance', 'SIC+dist'],
              ['A* + COSTMAP', busy.optimize ? 'running…' : 'ready', busy.optimize ? '…' : 'ready'],
              ['ROUTE', plan ? `${plan.waypoints} wp` : '—', plan ? `${plan.waypoints}` : '—'],
              ['VALIDATION', plan ? (plan.nan_cells === 0 ? 'PASS' : 'FAIL') : '—', plan ? (plan.nan_cells === 0 ? 'PASS' : 'FAIL') : '—'],
            ].map(([k, long, short], i, arr) => (
              <React.Fragment key={k}>
                <div className={`pl-step ${k === 'VALIDATION' && plan ? (plan.nan_cells === 0 ? 'ok' : 'bad') : ''}`}>
                  <span className="pl-k">{k}</span>
                  <span className="pl-v long">{long}</span>
                  <span className="pl-v short">{short}</span>
                </div>
                {i < arr.length - 1 ? <span className="pl-arrow">→</span> : null}
              </React.Fragment>
            ))}
          </div>

          {/* --------------------------------------- control card (left) */}
          <aside className="float ctrl">
            <div className="fc-h">
              <span>ROUTE PLANNER</span>
              <span className="fc-tag">real SIC + A*</span>
            </div>

            <Endpoint
              id="start"
              label="START"
              value={start}
              onChange={setStart}
              onPick={() => setPickMode(pickMode === 'start' ? null : 'start')}
              picking={pickMode === 'start'}
            />
            <Endpoint
              id="goal"
              label="DESTINATION"
              value={goal}
              onChange={setGoal}
              onPick={() => setPickMode(pickMode === 'goal' ? null : 'goal')}
              picking={pickMode === 'goal'}
            />

            <div className="fc-row">
              <button type="button" className="btn btn-ghost sm"
                onClick={() => { setStart(goal); setGoal(start) }}>
                ⇅ swap
              </button>
              <select className="sel sm" defaultValue="" onChange={(e) => {
                const p = PRESETS[Number(e.target.value)]
                if (p) applyPreset(p)
                e.target.value = ''
              }}>
                <option value="">presets…</option>
                {PRESETS.map((p, i) => <option key={p.name} value={i}>{p.name}</option>)}
              </select>
            </div>

            <div className="fc-day">
              <span className="fc-lab">FORECAST DAY</span>
              <b>D{timestep}</b>
              <span className="fc-date">{slice?.date ?? meta?.dates?.[timestep] ?? '—'}</span>
              <input
                className="rng" type="range" min={0} max={(meta?.n_timesteps ?? 1) - 1}
                value={timestep}
                onChange={(e) => { setTimestep(Number(e.target.value)); setRr(null) }}
                aria-label="forecast day"
              />
            </div>

            <button
              type="button"
              className="btn btn-primary wide"
              onClick={onOptimize}
              disabled={busy.optimize || busy.slice}
            >
              {busy.optimize ? 'OPTIMIZING…' : '⚡ OPTIMIZE ROUTE'}
            </button>

            <div className="fc-row reroute">
              <span className="fc-lab">REROUTE TO</span>
              <input
                className="num xs" type="number" min={0} max={(meta?.n_timesteps ?? 1) - 1}
                value={rrTarget ?? ''}
                placeholder={`D${Math.min((plan?.timestep ?? timestep) + 1, (meta?.n_timesteps ?? 2) - 1)}`}
                onChange={(e) => setRrTarget(e.target.value === '' ? null : Number(e.target.value))}
              />
              <button
                type="button" className="btn btn-warn sm"
                onClick={onReroute}
                disabled={!plan || busy.reroute || busy.optimize}
                title={plan ? 'Re-plan the same leg on a later real SIC forecast day' : 'Optimize a route first'}
              >
                {busy.reroute ? 'REROUTING…' : '↻ DYNAMIC REROUTE'}
              </button>
            </div>

            <label className="chk">
              <input type="checkbox" checked={showUncertainty}
                onChange={(e) => setShowUncertainty(e.target.checked)} />
              forecast uncertainty layer <span className="muted">(artifact)</span>
            </label>

            {notice ? <div className={`fc-notice ${notice.tone}`}>{notice.text}</div> : null}
          </aside>
        </section>

        {/* ============================================ RIGHT RAIL */}
        <aside className="rail">
          <MetricsCard plan={plan} rr={rr} slice={slice} timestep={timestep} />

          {rr ? <RerouteCard rr={rr} envDiff={envDiff} /> : null}

          <EnvironmentCard
            status={status} cmems={cmems} meta={meta} slice={slice}
            limitations={limitations} uncertainty={uncertainty}
            showUncertainty={showUncertainty}
          />
        </aside>
      </div>

      <Timeline
        metadata={meta}
        timestep={timestep}
        onChange={(t) => { setTimestep(t); setRr(null) }}
        playing={playing}
        onPlayToggle={() => setPlaying((p) => !p)}
        speed={speed}
        setSpeed={setSpeed}
        originStep={plan?.timestep ?? BASELINE.timestep}
        targetStep={rr?.new_timestep ?? (plan ? plan.timestep + 1 : 3)}
        rerouteTimestep={rr ? rr.new_timestep : null}
        onJump={(d) => { setTimestep(d); setRr(null) }}
        busy={busy}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Endpoint editor                                                     */
/* ------------------------------------------------------------------ */
function Endpoint({ label, value, onChange, onPick, picking, id }) {
  return (
    <div className={`ep ${picking ? 'picking' : ''}`} data-ep={id}>
      <div className="ep-h">
        <span className="ep-lab">{label}</span>
        <button type="button" className="btn btn-ghost xs" onClick={onPick}>
          {picking ? 'click the chart…' : '📍 pick on map'}
        </button>
      </div>
      <div className="ep-fields">
        <label>lat<input className="num" type="number" step="0.25" value={value.lat}
          onChange={(e) => onChange({ ...value, lat: Number(e.target.value) })} /></label>
        <label>lon<input className="num" type="number" step="0.25" value={value.lon}
          onChange={(e) => onChange({ ...value, lon: Number(e.target.value) })} /></label>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Route metrics — every value comes from the API response             */
/* ------------------------------------------------------------------ */
function MetricsCard({ plan, rr, slice, timestep }) {
  const v = rr ? rr.updated_route : plan
  const validation = v?.validation
  const pass = validation
    ? validation.all_cells_in_bounds && validation.reaches_goal
      && validation.contiguous_8_connected && validation.nan_cells === 0
      && validation.non_navigable_cells === 0
    : null

  return (
    <div className="card">
      <div className="card-h">
        <span>ROUTE METRICS</span>
        <span className={`pill ${v ? (pass ? 'ok' : 'bad') : 'idle'}`}>
          {v ? (pass ? 'OPTIMIZED' : 'CHECK FAILED') : 'NO ROUTE'}
        </span>
      </div>

      {!v ? (
        <p className="empty">
          Set a start and a destination, then press <b>OPTIMIZE ROUTE</b>. The route is
          computed by the backend A* + CostMap on the real SIC field for the selected day.
        </p>
      ) : (
        <div className="metrics">
          <Row k="ALGORITHM" v="A* + CostMap" />
          <Row k="FORECAST DAY" v={`D${v.timestep ?? timestep} · ${v.date ?? slice?.date ?? '—'}`} />
          <Row k="WAYPOINTS" v={fmtInt(v.waypoints)} />
          <Row k="DISTANCE" v={`${fmt(v.route_length, 2)} grid units`} sub={v.route_length_km != null ? `${fmtInt(v.route_length_km)} km along path${v.direct_length_km != null ? ` · ${fmtInt(v.direct_length_km)} km direct` : ''}` : null} />
          <Row k="MEAN SIC" v={fmt(v.mean_sic)} />
          <Row k="MAX SIC" v={fmt(v.max_sic)} />
          <Row k="INVALID CELLS" v={`${fmtInt(v.nan_cells)} NaN · ${fmtInt(v.non_navigable_cells)} non-nav`} tone={v.nan_cells || v.non_navigable_cells ? 'bad' : 'ok'} />
          <Row k="TOTAL COST" v={v.total_cost != null ? fmt(v.total_cost, 3) : '—'} />
          <Row k="EXPANDED NODES" v={fmtInt(v.expanded_nodes)} />
          <Row k="SAFETY VALIDATION" v={pass ? 'PASS' : 'FAIL'} tone={pass ? 'ok' : 'bad'} />
        </div>
      )}

      {validation ? (
        <div className="checks">
          {[
            ['in bounds', validation.all_cells_in_bounds],
            ['reaches goal', validation.reaches_goal],
            ['8-connected', validation.contiguous_8_connected],
            ['no NaN cells', validation.nan_cells === 0],
            ['no non-navigable', validation.non_navigable_cells === 0],
          ].map(([k, ok]) => (
            <span key={k} className={ok ? 'ok' : 'bad'}>{ok ? '✓' : '✕'} {k}</span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function Row({ k, v, sub, tone }) {
  return (
    <div className={`mrow ${tone || ''}`}>
      <span className="mk">{k}</span>
      <span className="mv">{v}{sub ? <em>{sub}</em> : null}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Reroute comparison                                                  */
/* ------------------------------------------------------------------ */
function RerouteCard({ rr, envDiff }) {
  const c = rr.route_comparison
  return (
    <div className="card">
      <div className="card-h">
        <span>DYNAMIC REROUTE</span>
        <span className={`pill ${c.identical_path ? 'ok' : 'warn'}`}>
          D{rr.origin_timestep} → D{rr.new_timestep}
        </span>
      </div>
      <div className="metrics">
        <Row k="ORIGINAL" v={`${fmtInt(rr.original_route.waypoints)} wp · max SIC ${fmt(rr.original_route.max_sic)}`} />
        <Row k="UPDATED" v={`${fmtInt(rr.updated_route.waypoints)} wp · max SIC ${fmt(rr.updated_route.max_sic)}`} />
        <Row k="Δ MEAN SIC" v={fmt(rr.metrics.delta.mean_sic)} />
        <Row k="Δ MAX SIC" v={fmt(rr.metrics.delta.max_sic)} />
        <Row k="CHANGED CELLS" v={fmtInt(c.changed_cells)} tone={c.changed_cells ? 'warn' : 'ok'} />
        <Row k="PATH OVERLAP" v={fmt(c.jaccard_overlap, 3)} sub={`coverage ${fmt(c.route_coverage, 3)}`} />
      </div>
      {envDiff ? (
        <div className="env-chg">
          ENVIRONMENT CHANGE D{rr.origin_timestep} → D{rr.new_timestep}:{' '}
          <b>{envDiff.nIncreased.toLocaleString()}</b> cells more ice ·{' '}
          <b>{envDiff.nDecreased.toLocaleString()}</b> less ·{' '}
          <b>{envDiff.nNavChanged.toLocaleString()}</b> changed navigability
        </div>
      ) : null}
      <div className="seg-list">
        {rr.changed_segments.length === 0 ? (
          <div className="muted">No changed segments — the two corridors are identical.</div>
        ) : (
          rr.changed_segments.map((sg, i) => (
            <div key={i} className="seg">
              <span className={`tag ${sg.route}`}>{sg.route === 'original' ? 'ABANDONED' : 'NEW'}</span>
              <b>{sg.cells}</b> cells · {fmt(sg.length_grid_units, 1)} units ·{' '}
              <span className="muted">cell {sg.from_cell.join(',')} → {sg.to_cell.join(',')}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Environment + provenance. Nothing here is ever optimistic.           */
/* ------------------------------------------------------------------ */
function EnvironmentCard({ status, cmems, meta, slice, limitations, uncertainty, showUncertainty }) {
  const sic = status?.environment?.sic
  const cvar = status?.environment?.cvar
  const policy = status?.models?.route_policy
  const ens = status?.models?.sic_forecaster
  const s = slice?.stats

  return (
    <div className="card">
      <div className="card-h">
        <span>ENVIRONMENT &amp; PROVENANCE</span>
        {!status ? <span className="pill idle">resolving…</span> : null}
      </div>

      <div className="metrics">
        <Row k="SIC FIELD" v={sic ? 'REAL' : '—'} tone="ok" />
        <Row k="ARTIFACT" v="routing_sic_2026.npy" />
        <Row k="DAYS" v={`${meta?.date_range?.[0] ?? '—'} → ${meta?.date_range?.[1] ?? '—'}`} />
        <Row k="GRID" v={meta ? `${meta.n_rows} × ${meta.n_cols} @ ${meta.resolution_deg}°` : '—'} />
        <Row k="MEAN SIC (DAY)" v={s ? fmt(s.mean) : '—'} />
        <Row k="MAX SIC (DAY)" v={s ? fmt(s.max) : '—'} />
        <Row k="UNCERTAINTY" v={showUncertainty && uncertainty ? `mean ${fmt(uncertainty.stats.mean)} · max ${fmt(uncertainty.stats.max)}` : `${sic?.uncertainty_horizons ?? '—'} horizons available`} />
        <Row k="OCEAN CURRENTS" v={cmems?.available ? 'AVAILABLE' : 'Unavailable'} tone={cmems?.available ? 'ok' : 'idle'} />
        <Row k="CVaR" v={cvar?.available ? 'AVAILABLE' : 'Unavailable — iceberg risk scenarios not loaded'} tone={cvar?.available ? 'ok' : 'idle'} />
        <Row k="ROUTE ML POLICY" v={policy?.present ? 'experimental — synthetic training data' : 'absent'} tone="idle" />
      </div>

      <div className="prov">
        <div className="prov-h">HOW THIS ROUTE WAS PRODUCED</div>
        <ol>
          <li>SIC field: 3-seed ConvLSTM ensemble, real 2026 forecast, {sic?.date_range?.join(' → ') ?? ''}.</li>
          <li>NaN cells are <b>non-navigable</b> — never zero-filled, never routed.</li>
          <li>Cost per cell = SIC + movement distance; movement is 8-connected.</li>
          <li>A* searches that cost surface; the result is re-validated before it is returned.</li>
        </ol>
        <div className="prov-h">NOT USED FOR THIS ROUTE</div>
        <ul>
          <li>Route ML policy ({policy?.path ?? 'outputs/ml/route_policy.pt'}) — trained on synthetic 20×25 smoke data, out-of-distribution for the real {meta?.n_rows}×{meta?.n_cols} grid.</li>
          <li>Live ConvLSTM inference — the raw multi-channel 2026 inputs are absent, so the committed forecast output is used instead.</li>
          <li>Currents / CVaR — no data configured; nothing is faked.</li>
        </ul>
        {ens && ens.inference_rerun_possible === false ? (
          <div className="prov-warn">{ens.label}</div>
        ) : null}
      </div>
    </div>
  )
}

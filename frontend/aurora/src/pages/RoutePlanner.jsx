import { useCallback, useEffect, useMemo, useState } from 'react'
import { Route, Waves, Eye, ShieldCheck, Compass } from 'lucide-react'
import AntarcticMap from '../components/map/AntarcticMap'
import {
  CoordReadout,
  FloatPanel,
  LayerManagerPanel,
  LegendPanel,
  LineLegend,
  SicLegend,
} from '../components/map/MapUi'
import { cn } from '../lib/utils'
import PlannerForm from '../components/planner/PlannerForm'
import RouteResult from '../components/planner/RouteResult'
import RerouteFlow from '../components/planner/RerouteFlow'
import { ErrorState, LoadingState } from '../components/ui/Status'
import {
  ROUTE_POINTS,
  fetchLimitations,
  fetchSicSlice,
  optimizeRoute,
  pathToLatLngs,
  rerouteRoute,
} from '../lib/auroraApi'
import { useCoastline, useLayersStatus, useMetadata, useSicRaster, useUncertaintyRaster } from '../lib/hooks'

const CAPETOWN = ROUTE_POINTS.find((p) => p.id === 'capetown')
const MAITRI = ROUTE_POINTS.find((p) => p.id === 'maitri')

export default function RoutePlanner() {
  const meta = useMetadata()
  const coastline = useCoastline()

  /* ---------------------------------------------------------- inputs */
  const [originPreset, setOriginPreset] = useState(CAPETOWN.id)
  const [goalPreset, setGoalPreset] = useState(MAITRI.id)
  const [origin, setOrigin] = useState({ lat: CAPETOWN.lat, lon: CAPETOWN.lon, label: CAPETOWN.name })
  const [goal, setGoal] = useState({ lat: MAITRI.lat, lon: MAITRI.lon, label: MAITRI.name })
  const [pickMode, setPickMode] = useState(null)
  const [timestep, setTimestep] = useState(0)
  const [snap, setSnap] = useState(true)

  const applyPreset = (which) => (id) => {
    if (id === '__custom__') {
      setPickMode(which)
      return
    }
    const p = ROUTE_POINTS.find((x) => x.id === id)
    if (!p) return
    const next = { lat: p.lat, lon: p.lon, label: p.name }
    if (which === 'origin') {
      setOriginPreset(id)
      setOrigin(next)
      if (goalPreset === id) {
        const other = ROUTE_POINTS.find((x) => x.id !== id)
        setGoalPreset(other.id)
        setGoal({ lat: other.lat, lon: other.lon, label: other.name })
      }
    } else {
      setGoalPreset(id)
      setGoal(next)
      if (originPreset === id) {
        const other = ROUTE_POINTS.find((x) => x.id !== id)
        setOriginPreset(other.id)
        setOrigin({ lat: other.lat, lon: other.lon, label: other.name })
      }
    }
    setPickMode(null)
  }

  const onPick = useCallback(
    ({ lat, lon }) => {
      const next = { lat, lon, label: 'Picked on chart' }
      if (pickMode === 'origin') setOrigin(next)
      else if (pickMode === 'goal') setGoal(next)
      if (pickMode === 'origin') setOriginPreset('__custom__')
      if (pickMode === 'goal') setGoalPreset('__custom__')
      setPickMode(null)
    },
    [pickMode]
  )

  /* ---------------------------------------------------------- status */
  const layers = useLayersStatus(timestep)
  const [limitations, setLimitations] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetchLimitations()
      .then((l) => !cancelled && setLimitations(l))
      .catch(() => !cancelled && setLimitations(null))
    return () => {
      cancelled = true
    }
  }, [])

  /* ---------------------------------------------------------- chart layers */
  const [show, setShow] = useState({
    enc: true,
    coast: true,
    graticule: true,
    corridor: true,
    stations: true,
    sic: true,
    unc: false,
    drift: true,
    icebergs: true,
    alt_routes: true,
    route: true,
    alarms: true,
  })
  const [opacities, setOpacities] = useState({
    enc: 1.0,
    coast: 1.0,
    graticule: 1.0,
    corridor: 1.0,
    stations: 1.0,
    sic: 1.0,
    unc: 1.0,
    drift: 1.0,
    icebergs: 1.0,
    alt_routes: 0.9,
    route: 1.0,
    alarms: 1.0,
  })

  const handleToggleLayer = (key) => setShow((s) => ({ ...s, [key]: !s[key] }))
  const handleOpacityChange = (key, val) => setOpacities((o) => ({ ...o, [key]: val }))

  const sic = useSicRaster(timestep, meta.data, { enabled: show.sic })
  const unc = useUncertaintyRaster(timestep, 0, meta.data, { enabled: show.unc })
  const [cursor, setCursor] = useState(null)

  /* ---------------------------------------------------------- plan */
  const [plan, setPlan] = useState(null)
  const [planError, setPlanError] = useState(null)
  const [busy, setBusy] = useState(false)

  const handlePlan = useCallback(async () => {
    setBusy(true)
    setPlanError(null)
    setReroute(null)
    setRerouteError(null)
    setSupported(null)
    try {
      const body = await optimizeRoute({
        start_lat: origin.lat,
        start_lon: origin.lon,
        goal_lat: goal.lat,
        goal_lon: goal.lon,
        timestep,
        snap,
      })
      setPlan(body)
      const opts = (meta.data?.dates ?? [])
        .map((d, i) => ({ i, d }))
        .filter(({ i }) => i > body.timestep)
      setTarget(opts.length ? opts[Math.min(30, opts.length - 1)].i : null)
    } catch (err) {
      setPlan(null)
      setPlanError(
        `${err?.message ?? 'Route request failed.'}` +
          (err?.detail?.reason ? ` (reason: ${err.detail.reason})` : '')
      )
    } finally {
      setBusy(false)
    }
  }, [origin, goal, timestep, snap, meta.data])

  /* ---------------------------------------------------------- reroute */
  const [reroute, setReroute] = useState(null)
  const [rerouteBusy, setRerouteBusy] = useState(false)
  const [rerouteError, setRerouteError] = useState(null)
  const [supported, setSupported] = useState(null)
  const [target, setTarget] = useState(null)

  const targetOptions = useMemo(() => {
    if (!plan || !meta.data?.dates) return []
    return meta.data.dates.map((d, i) => ({ i, d })).filter(({ i }) => i > plan.timestep)
  }, [plan, meta.data])

  useEffect(() => {
    if (target != null && !targetOptions.some((o) => o.i === target)) setTarget(null)
  }, [targetOptions, target])

  const handleReroute = useCallback(async () => {
    if (!plan || target == null) return
    setRerouteBusy(true)
    setRerouteError(null)
    try {
      const body = await rerouteRoute({ originalRoute: plan, newTimestep: target })
      setReroute(body)
      setSupported('ok')
    } catch (err) {
      const status = err?.status ?? 0
      if (status === 0 || status === 404) setSupported('unavailable')
      setRerouteError(`${err?.message ?? 'Reroute request failed.'}`)
    } finally {
      setRerouteBusy(false)
    }
  }, [plan, target])

  /* -------------------------------------------- frame statistics */
  const [frames, setFrames] = useState({ origin: null, target: null })
  useEffect(() => {
    let cancelled = false
    if (!plan) {
      setFrames({ origin: null, target: null })
      return undefined
    }
    const load = async () => {
      try {
        const [a, b] = await Promise.all([
          fetchSicSlice(plan.timestep).catch(() => null),
          target != null ? fetchSicSlice(target).catch(() => null) : Promise.resolve(null),
        ])
        if (cancelled) return
        setFrames({
          origin: a ? { date: a.date, stats: a.stats } : null,
          target: b ? { date: b.date, stats: b.stats } : null,
        })
      } catch {
        if (!cancelled) setFrames({ origin: null, target: null })
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [plan, target])

  /* -------------------------------------------- map line coordinates */
  const planLine = useMemo(() => {
    if (!plan?.path || !meta.data) return null
    return pathToLatLngs(meta.data, plan.path)
  }, [plan, meta.data])

  const newLine = useMemo(() => {
    if (!reroute?.path || !meta.data) return null
    return pathToLatLngs(meta.data, reroute.path)
  }, [reroute, meta.data])

  const priorLine = useMemo(() => {
    if (!reroute || !planLine) return null
    return planLine
  }, [reroute, planLine])

  const endpoints = useMemo(() => {
    const list = []
    if (origin) list.push({ ...origin, kind: 'origin' })
    if (goal) list.push({ ...goal, kind: 'goal' })
    return list
  }, [origin, goal])

  const canPlan = !busy && origin != null && goal != null

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#05182B] text-slate-100">
      <div className="grid h-full min-h-0 grid-cols-1 gap-2 p-2 lg:grid-cols-[18rem_minmax(0,1fr)_22rem]">
        {/* LEFT: LAYERS panel */}
        <aside className="order-2 flex min-h-0 flex-col gap-2 overflow-y-auto lg:order-1 scrollbar-thin">
          <FloatPanel
            title="LAYERS"
            action={<span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-[#22E5F0]">14</span>}
            className="flex-1"
          >
            <LayerManagerPanel
              layers={show}
              opacities={opacities}
              onToggle={handleToggleLayer}
              onOpacityChange={handleOpacityChange}
              sicAwaitingData={!meta.data}
            />
          </FloatPanel>
        </aside>

        {/* CENTER: Large continuous Antarctic polar map */}
        <div className="relative order-1 flex min-h-[450px] flex-col lg:order-2 lg:h-full lg:min-h-0">
          <AntarcticMap
            className="absolute inset-0"
            meta={meta.data}
            coastline={show.coast ? coastline : null}
            showBaseTiles={show.enc}
            showCoastline={show.coast}
            coastlineOpacity={opacities.coast}
            showGraticule={show.graticule}
            graticuleOpacity={opacities.graticule}
            showCorridor={show.corridor}
            corridorOpacity={opacities.corridor}
            showStations={show.stations}
            showIcebergs={show.icebergs}
            showWaypoints={show.route}
            sicRaster={show.sic ? sic : null}
            sicOpacity={opacities.sic}
            uncertaintyRaster={show.unc ? unc : null}
            uncertaintyOpacity={opacities.unc}
            routeLine={show.route ? (newLine ?? planLine) : null}
            routeLabel={reroute ? 'Re-planned route' : 'Recommended route'}
            priorLine={show.alt_routes ? priorLine : null}
            priorLabel="Previous route"
            endpoints={endpoints}
            pickMode={pickMode}
            onPick={onPick}
            onCursor={setCursor}
          />

          {pickMode && (
            <div className="pointer-events-none absolute left-1/2 top-[68px] z-[500] -translate-x-1/2 rounded-xl border border-[#22E5F0]/50 bg-[#05182B]/90 px-3.5 py-2 shadow-2xl backdrop-blur-xl">
              <span className="flex items-center gap-2 font-mono text-[12px] text-[#22E5F0]">
                <span className="h-2 w-2 animate-ping rounded-full bg-[#22E5F0]" />
                Set {pickMode === 'origin' ? 'origin' : 'destination'} — click on chart
              </span>
            </div>
          )}

          {sic.loading && (
            <div className="pointer-events-none absolute left-1/2 top-[68px] z-[500] -translate-x-1/2 rounded-xl border border-[#22E5F0]/40 bg-[#05182B]/90 px-3.5 py-2 shadow-2xl backdrop-blur-md">
              <span className="mono-label flex items-center gap-2 text-[#22E5F0]">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[#22E5F0]" />
                PROJECTING POLAR SIC FRAME (EPSG:3031)…
              </span>
            </div>
          )}
        </div>

        {/* RIGHT: ROUTE panel + FORECAST HORIZON panel */}
        <aside className="order-3 flex min-h-0 flex-col gap-2 overflow-y-auto scrollbar-thin">
          {/* ROUTE panel */}
          <FloatPanel
            title="ROUTE"
            action={
              <span
                className={cn(
                  'rounded px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider',
                  plan && plan.success
                    ? 'border border-emerald-500/40 bg-emerald-500/20 text-emerald-400'
                    : 'border border-red-500/40 bg-red-500/20 text-red-400'
                )}
              >
                {plan && plan.success ? 'OPTIMAL' : 'INFEASIBLE'}
              </span>
            }
          >
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[11px] border-b border-white/10 pb-2">
                <div className="text-mist">Run</div>
                <div className="text-right text-white/90">
                  {meta.data?.dates?.[timestep] ? `${meta.data.dates[timestep]} 06:30:00Z` : '2026-10-03 06:30:00Z'}
                </div>
                <div className="text-mist">Vessel</div>
                <div className="text-right text-white/90">1</div>
                <div className="text-mist">Candidates</div>
                <div className="text-right text-white/90">{plan ? (reroute ? 2 : 1) : 0}</div>
                <div className="text-mist">Peak risk</div>
                <div className="text-right text-white/90">
                  {plan?.max_sic != null ? `${(plan.max_sic * 100).toFixed(0)}%` : '—'}
                </div>
              </div>

              {!plan && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] leading-snug text-amber-300">
                  No route is marked recommended — compare the candidates below before committing.
                </div>
              )}

              {!plan && (
                <div className="py-2 text-center text-[11px] text-mist/60 italic">
                  No candidate routes in this run
                </div>
              )}

              {/* Existing PlannerForm for route optimization */}
              <div className="mt-2 border-t border-white/10 pt-2">
                <PlannerForm
                  metadata={meta.data}
                  layersData={layers.data}
                  layersLoading={layers.loading}
                  origin={origin}
                  originPreset={originPreset}
                  onOriginPreset={applyPreset('origin')}
                  goal={goal}
                  goalPreset={goalPreset}
                  onGoalPreset={applyPreset('goal')}
                  pickMode={pickMode}
                  setPickMode={setPickMode}
                  timestep={timestep}
                  setTimestep={setTimestep}
                  snap={snap}
                  setSnap={setSnap}
                  onPlan={handlePlan}
                  busy={busy}
                  planError={planError}
                  canPlan={canPlan}
                />
              </div>

              {plan && (
                <RouteResult plan={plan} limitations={limitations} layersData={layers.data} />
              )}

              {plan && (
                <RerouteFlow
                  plan={plan}
                  reroute={reroute}
                  busy={rerouteBusy}
                  error={rerouteError}
                  supported={supported === 'unavailable' ? 'unavailable' : 'ready'}
                  targetOptions={targetOptions}
                  target={target}
                  setTarget={setTarget}
                  frameOrigin={frames.origin}
                  frameTarget={frames.target}
                  costWeights={plan?.cost_weights ?? layers.data?.cost_weights ?? null}
                  onRun={handleReroute}
                />
              )}
            </div>
          </FloatPanel>

          {/* FORECAST HORIZON panel */}
          <FloatPanel title="FORECAST HORIZON">
            <div className="space-y-2">
              <input
                type="range"
                min="0"
                max={Math.max(2, (meta.data?.dates?.length ?? 3) - 1)}
                step="1"
                value={timestep}
                onChange={(e) => setTimestep(Number(e.target.value))}
                className="h-1.5 w-full cursor-pointer accent-[#22E5F0] bg-white/10 rounded"
              />
              <div className="flex justify-between font-mono text-[10px] text-mist">
                <span>D+1</span>
                <span>D+2</span>
                <span>D+3</span>
              </div>
              <p className="font-mono text-[11px] text-[#A9DFFF]">
                Valid for: {meta.data?.dates?.[timestep] ?? '2026-01-21'} · D+{timestep + 1}
              </p>
            </div>
          </FloatPanel>
        </aside>
      </div>
    </div>
  )
}

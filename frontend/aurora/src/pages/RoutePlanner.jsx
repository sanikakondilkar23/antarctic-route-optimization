import { useCallback, useEffect, useMemo, useState } from 'react'
import AntarcticMap from '../components/map/AntarcticMap'
import { CoordReadout, FloatPanel, LayerRow, LineLegend, SicLegend } from '../components/map/MapUi'
import PlannerForm from '../components/planner/PlannerForm'
import RouteResult from '../components/planner/RouteResult'
import RerouteFlow from '../components/planner/RerouteFlow'
import { ErrorState, LoadingState } from '../components/ui/Status'
import {
  ROUTE_POINTS,
  fetchLimitations,
  fetchRouteProfile,
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

  /* ---------------------------------------------------------- chart */
  const [show, setShow] = useState({ base: true, coast: true, stations: true, sic: true, unc: false })
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

  /* ------------------------------------------ route SIC profile */
  // GET /api/route/profile/<t> sampled at the exact cells the optimizer
  // returned, so the statistics below describe the route on the chart.
  const [profile, setProfile] = useState({ data: null, error: null, loading: false })
  useEffect(() => {
    let cancelled = false
    const startCell = plan?.start?.cell
    const goalCell = plan?.goal?.cell
    if (!Array.isArray(startCell) || !Array.isArray(goalCell)) {
      setProfile({ data: null, error: null, loading: false })
      return undefined
    }
    setProfile((p) => ({ ...p, loading: true }))
    fetchRouteProfile(plan.timestep, {
      startRow: startCell[0],
      startCol: startCell[1],
      goalRow: goalCell[0],
      goalCol: goalCell[1],
    })
      .then((d) => !cancelled && setProfile({ data: d, error: null, loading: false }))
      .catch((e) => !cancelled && setProfile({ data: null, error: e, loading: false }))
    return () => {
      cancelled = true
    }
  }, [plan])

  /* ---------------------------------------------------------- reroute */
  const [reroute, setReroute] = useState(null)
  const [rerouteBusy, setRerouteBusy] = useState(false)
  const [rerouteError, setRerouteError] = useState(null)
  const [supported, setSupported] = useState(null) // null | 'ok' | 'unavailable'
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

  /* ---------------------------------------------------------- lines */
  const planLine = useMemo(
    () => (plan?.path && meta.data ? pathToLatLngs(meta.data, plan.path) : null),
    [plan, meta.data]
  )
  const priorLine = useMemo(
    () => (reroute?.updated_route?.path && meta.data ? pathToLatLngs(meta.data, plan.path) : null),
    [reroute, plan, meta.data]
  )
  const newLine = useMemo(
    () =>
      reroute?.updated_route?.path && meta.data
        ? pathToLatLngs(meta.data, reroute.updated_route.path)
        : null,
    [reroute, meta.data]
  )

  const endpoints = useMemo(
    () => [
      { ...origin, kind: 'origin' },
      { ...goal, kind: 'destination' },
    ],
    [origin, goal]
  )

  const canPlan =
    Math.abs(origin.lat - goal.lat) > 1e-6 || Math.abs(origin.lon - goal.lon) > 1e-6

  return (
    <div className="flex h-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      {/* ------------------------------------------------ left rail */}
      <aside className="scrollbar-thin order-2 w-full shrink-0 space-y-2 border-t border-graphite-600 bg-graphite-900 p-2 lg:order-1 lg:w-[396px] lg:overflow-y-auto lg:border-r lg:border-t-0">
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

        {planError && !plan && (
          <ErrorState title="Route request rejected" message={planError} />
        )}

        <RouteResult plan={plan} limitations={limitations} layersData={layers.data} profile={profile} />

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

        <div className="border border-graphite-600 bg-graphite-850 px-3 py-2.5">
          <p className="mono-label">Source</p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-mist">
            Routing runs in the AURORA backend (A* over the real SIC field with the GEBCO land
            mask). This client only chooses inputs and renders what comes back.
          </p>
        </div>
      </aside>

      {/* ------------------------------------------------ chart */}
      <div className="relative order-1 flex-1 lg:order-2 lg:min-h-0">
        <div className="relative h-[54vh] w-full lg:absolute lg:inset-0 lg:h-full">
        <AntarcticMap
          className="absolute inset-0"
          meta={meta.data}
          coastline={show.coast ? coastline : null}
          showBaseTiles={show.base}
          showCoastline={show.coast}
          showStations={show.stations}
          sicRaster={show.sic ? sic : null}
          uncertaintyRaster={show.unc ? unc : null}
          uncertaintyOpacity={0.55}
          routeLine={newLine ?? planLine}
          routeLabel={reroute ? 'Re-planned route' : 'Recommended route'}
          priorLine={priorLine}
          priorLabel="Original route"
          endpoints={endpoints}
          pickMode={pickMode}
          onPick={onPick}
          onCursor={setCursor}
        />

        {pickMode && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-[500] -translate-x-1/2 border border-ice/50 bg-graphite-850 px-3 py-1.5">
            <span className="text-[12px] text-ice">
              Set {pickMode === 'origin' ? 'origin' : 'destination'} — click the chart
            </span>
          </div>
        )}

        {sic.loading && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-[500] -translate-x-1/2 border border-graphite-600 bg-graphite-850 px-3 py-1.5">
            <span className="mono-label">DECODING SIC FRAME…</span>
          </div>
        )}
        </div>

        <FloatPanel
          title="Chart layers"
          className="relative z-[500] mb-2 w-full lg:absolute lg:right-3 lg:top-3 lg:mb-0 lg:w-[236px]"
          bodyClass="px-3 py-2"
        >
          <LayerRow checked={show.base} onChange={(v) => setShow((s) => ({ ...s, base: v }))} label="Base map" />
          <LayerRow checked={show.coast} onChange={(v) => setShow((s) => ({ ...s, coast: v }))} label="Coastline" />
          <LayerRow
            checked={show.sic}
            onChange={(v) => setShow((s) => ({ ...s, sic: v }))}
            label="Sea-ice concentration"
            status="REAL"
          />
          <LayerRow
            checked={show.unc}
            onChange={(v) => setShow((s) => ({ ...s, unc: v }))}
            label="SIC forecast uncertainty"
            status="PARTIAL"
          />
          <LayerRow checked={show.stations} onChange={(v) => setShow((s) => ({ ...s, stations: v }))} label="Stations" />
          <div className="mt-1.5 border-t border-graphite-700 pt-1.5">
            <p className="text-[10.5px] leading-snug text-steel">
              Iceberg, wind, current and risk-zone layers are not served by this deployment and are
              therefore not offered.
            </p>
          </div>
        </FloatPanel>

        <div className="relative z-[500] mb-2 w-full border border-graphite-600 bg-graphite-850 px-3 py-2 shadow-overlay lg:absolute lg:bottom-10 lg:left-3 lg:mb-0 lg:w-[250px]">
          <LineLegend
            items={[
              { label: reroute ? 'Re-planned route' : 'Recommended route', color: '#A8CFE6' },
              ...(reroute ? [{ label: 'Original route', color: '#6E7881', dash: '6 5', width: 2 }] : []),
              { label: 'Origin', color: '#A8CFE6', width: 2 },
              { label: 'Destination', color: '#C39A4A', width: 2 },
            ]}
          />
          {show.sic && <SicLegend className="mt-2 border-t border-graphite-700 pt-2" />}
        </div>

        <div className="relative z-[500] mb-2 inline-block border border-graphite-600 bg-graphite-850 px-3 py-2 shadow-overlay lg:absolute lg:bottom-3 lg:right-3 lg:mb-0">
          <CoordReadout cursor={cursor} />
        </div>

        {meta.error && (
          <div className="relative z-[600] mx-auto my-3 w-[420px] max-w-full lg:absolute lg:left-1/2 lg:top-1/2 lg:my-0 lg:w-[420px] lg:-translate-x-1/2 lg:-translate-y-1/2">
            <ErrorState title="Grid metadata unavailable" message={meta.error.message} />
          </div>
        )}
        {meta.loading && !meta.data && (
          <div className="relative z-[600] mx-auto my-3 w-[320px] max-w-full lg:absolute lg:left-1/2 lg:top-1/2 lg:my-0 lg:w-[320px] lg:-translate-x-1/2 lg:-translate-y-1/2">
            <LoadingState label="Loading grid metadata" />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * MissionPlanner.jsx - the origin / destination / horizon / objective form
 * that drives POST /api/route/optimize and POST /api/route/reroute.
 *
 * Nothing here is computed locally: the form only picks inputs the backend
 * documents, and every number it echoes back comes from the response body.
 * The "routing objective" control is read-only against the profile the server
 * is actually running (SIH_W_* weights, reported by /api/layers/status), so
 * the UI can never claim a route was produced under a different objective.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Compass, Navigation, RefreshCw, Route as RouteIcon, Shuffle, AlertTriangle } from 'lucide-react'
import Card from '../ui/Card'
import Button from '../ui/Button'
import Badge from '../ui/Badge'
import {
  OBJECTIVES,
  ROUTE_POINTS,
  activeObjective,
  fetchLayersStatus,
  fetchMetadata,
  fetchRoutePreferences,
  optimizeRoute,
  rerouteRoute,
} from '../../lib/auroraApi'
import { cn } from '../../lib/utils'

const num = (v, d = 3) => (typeof v === 'number' ? v.toFixed(d) : null)

function ObjectiveReadout({ weights, loading }) {
  const active = useMemo(() => activeObjective(weights), [weights])
  if (loading && !weights) {
    return <p className="text-[11px] text-mist">Reading active cost weights…</p>
  }
  if (!weights) {
    return (
      <p className="text-[11px] text-warn">
        Active cost weights unavailable — the objective cannot be stated.
      </p>
    )
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge value={active ? 'Active profile' : 'Unlisted profile'} />
        <span className="text-xs font-semibold text-white/90">
          {active ? active.label : 'Custom server weights'}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-mist">
        {active ? active.hint : 'The backend reports weights that match no documented profile.'}
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px] text-mist">
        {Object.entries(weights)
          .filter(([k, v]) => k !== 'vessel_draft_m' && Number.isFinite(Number(v)))
          .map(([k, v]) => (
            <span key={k} className="flex items-center justify-between gap-2">
              <span className={Number(v) > 0 ? 'text-white/85' : 'text-mist/60'}>{k}</span>
              <span className={Number(v) > 0 ? 'text-ice' : 'text-mist/60'}>{v}</span>
            </span>
          ))}
      </div>
      <p className="text-[10px] leading-relaxed text-mist/80">
        Weights are server configuration (<span className="font-mono">SIH_W_*</span>). A profile is
        only available when the backend reports it as active.
      </p>
    </div>
  )
}

export default function MissionPlanner({ metadata: metadataProp = null, onPlan, onReroute, className = '' }) {
  const [metadata, setMetadata] = useState(metadataProp)
  const [weights, setWeights] = useState(null)
  const [weightsLoading, setWeightsLoading] = useState(true)

  const [preferences, setPreferences] = useState([])
  const [preferenceId, setPreferenceId] = useState(null)

  const [startId, setStartId] = useState('capetown')
  const [goalId, setGoalId] = useState('bharati')
  const [timestep, setTimestep] = useState(0)
  const [rerouteTimestep, setRerouteTimestep] = useState(null)
  const [snap, setSnap] = useState(true)

  const [plan, setPlan] = useState(null)
  const [reroute, setReroute] = useState(null)
  const [busy, setBusy] = useState(null) // 'optimize' | 'reroute' | null
  const [error, setError] = useState(null)

  useEffect(() => {
    if (metadataProp) setMetadata(metadataProp)
    else {
      fetchMetadata()
        .then(setMetadata)
        .catch(() => {})
    }
  }, [metadataProp])

  useEffect(() => {
    let cancelled = false
    fetchLayersStatus(0)
      .then((s) => {
        if (!cancelled) setWeights(s?.cost_weights ?? null)
      })
      .catch(() => {
        if (!cancelled) setWeights(null)
      })
      .finally(() => {
        if (!cancelled) setWeightsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchRoutePreferences()
      .then((r) => {
        if (cancelled) return
        const list = r?.preferences ?? []
        setPreferences(list)
        setPreferenceId(r?.default ?? list[0]?.id ?? null)
      })
      .catch(() => {
        if (!cancelled) setPreferences([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const points = ROUTE_POINTS
  const start = points.find((p) => p.id === startId) ?? points[0]
  const goal = points.find((p) => p.id === goalId) ?? points[1]
  const dates = metadata?.dates ?? []
  const nTimesteps = metadata?.n_timesteps ?? 0
  const sameEndpoint = startId === goalId
  const selectedPreference =
    preferences.find((p) => p.id === preferenceId) ?? null

  const handleOptimize = useCallback(async () => {
    if (sameEndpoint) {
      setError('Origin and destination must differ.')
      return
    }
    setBusy('optimize')
    setError(null)
    setReroute(null)
    try {
      const body = await optimizeRoute({
        start_lat: start.lat,
        start_lon: start.lon,
        goal_lat: goal.lat,
        goal_lon: goal.lon,
        timestep,
        snap,
        ...(preferenceId ? { preference: preferenceId } : {}),
      })
      setPlan(body)
      setRerouteTimestep(
        Math.min(timestep + 1, Math.max(0, nTimesteps - 1))
      )
      onPlan?.(body)
    } catch (err) {
      setPlan(null)
      setError(
        `${err?.message ?? 'Route request failed.'}` +
          (err?.detail?.reason ? ` (reason: ${err.detail.reason})` : ''),
      )
    } finally {
      setBusy(null)
    }
  }, [start, goal, timestep, snap, preferenceId, sameEndpoint, nTimesteps, onPlan])

  const handleReroute = useCallback(async () => {
    if (!plan || rerouteTimestep == null) return
    setBusy('reroute')
    setError(null)
    try {
      const body = await rerouteRoute({
        originalRoute: plan,
        newTimestep: rerouteTimestep,
      })
      setReroute(body)
      onReroute?.(body)
    } catch (err) {
      setError(
        `${err?.message ?? 'Reroute request failed.'}` +
          (err?.detail?.reason ? ` (reason: ${err.detail.reason})` : ''),
      )
    } finally {
      setBusy(null)
    }
  }, [plan, rerouteTimestep, onReroute])

  const forwardOptions = useMemo(() => {
    if (!plan || nTimesteps === 0) return []
    return dates
      .map((d, i) => ({ i, d }))
      .filter(({ i }) => i > plan.timestep)
  }, [plan, dates, nTimesteps])

  return (
    <Card className={className}>
      <Card.Header
        title="Mission planner"
        subtitle="Origin, destination, forecast horizon and routing objective"
        icon={Compass}
        action={
          metadata ? (
            <span className="font-mono text-[11px] text-mist">
              {nTimesteps} forecast days · {metadata.date_range?.[0]} → {metadata.date_range?.[1]}
            </span>
          ) : null
        }
      />
      <Card.Body className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="input-label">Origin</span>
            <select
              className="input"
              value={startId}
              onChange={(e) => setStartId(e.target.value)}
            >
              {points.map((p) => (
                <option key={p.id} value={p.id} className="bg-navy-mid">
                  {p.name}
                </option>
              ))}
            </select>
            <span className="mt-1 block font-mono text-[10px] text-mist">
              {start.lat.toFixed(2)}°, {start.lon.toFixed(2)}°
            </span>
          </label>

          <label className="block">
            <span className="input-label">Destination</span>
            <select className="input" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              {points
                .filter((p) => p.id !== startId)
                .map((p) => (
                  <option key={p.id} value={p.id} className="bg-navy-mid">
                    {p.name}
                  </option>
                ))}
            </select>
            <span className="mt-1 block font-mono text-[10px] text-mist">
              {goal.lat.toFixed(2)}°, {goal.lon.toFixed(2)}°
            </span>
          </label>
        </div>

        <label className="block">
          <span className="input-label">Forecast horizon (day index)</span>
          <select
            className="input font-mono"
            value={timestep}
            onChange={(e) => setTimestep(Number(e.target.value))}
            disabled={!dates.length}
          >
            {dates.length === 0 && <option value={0}>loading forecast calendar…</option>}
            {dates.map((d, i) => (
              <option key={d} value={i} className="bg-navy-mid">
                D+{i} · {d}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[10px] text-mist">
            SIC cost is taken from the committed forecast field for exactly this day.
          </span>
        </label>

        <div>
          <span className="input-label">Routing objective</span>
          <ObjectiveReadout weights={weights} loading={weightsLoading} />
        </div>

        <label className="flex items-center gap-2 text-xs text-mist">
          <input
            type="checkbox"
            checked={snap}
            onChange={(e) => setSnap(e.target.checked)}
            className="h-4 w-4 accent-ice"
          />
          Snap an endpoint that lands on non-navigable cells to the nearest navigable one
          (reported in the response, never hidden)
        </label>

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleOptimize} disabled={busy !== null || sameEndpoint}>
            {busy === 'optimize' ? <RefreshCw size={15} className="animate-spin" /> : <Navigation size={15} />}
            {busy === 'optimize' ? 'Optimising…' : 'Calculate route'}
          </Button>
          <Button
            variant="secondary"
            onClick={handleReroute}
            disabled={!plan || busy !== null || rerouteTimestep == null}
            title={plan ? 'Re-plan the same leg on a later forecast day' : 'Calculate a route first'}
          >
            <Shuffle size={15} />
            {busy === 'reroute' ? 'Re-planning…' : 'Reroute'}
          </Button>
          {plan && forwardOptions.length > 0 && (
          <>
        <div>
          <span className="input-label">Route option</span>
          {preferences.length > 1 ? (
            <>
              <select
                className="input"
                value={preferenceId ?? ''}
                onChange={(e) => setPreferenceId(e.target.value)}
              >
                {preferences.map((p) => (
                  <option key={p.id} value={p.id} className="bg-navy-mid">
                    {p.label}
                  </option>
                ))}
              </select>
              {selectedPreference && (
                <p className="mt-1.5 text-[11px] leading-relaxed text-mist">
                  {selectedPreference.hint}
                </p>
              )}
              {selectedPreference && (
                <div className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[10px] text-mist sm:grid-cols-3">
                  {Object.entries(selectedPreference.weights).map(([k, v]) => (
                    <span key={k} className="flex items-center justify-between gap-2">
                      <span className="text-mist/70">{k}</span>
                      <span className={Number(v) > 0 ? 'text-ice' : 'text-mist/50'}>{v}</span>
                    </span>
                  ))}
                </div>
              )}
              <p className="mt-1 text-[10px] leading-relaxed text-mist/80">
                Every option is priced by the same A* + CostMap engine over the real SIC field —
                only the weights change, and the labels come from{' '}
                <span className="font-mono">GET /api/route/preferences</span>.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-warn">
              Route options unavailable from the backend — the server objective is used as-is.
            </p>
          )}
        </div>

        <label className="flex items-center gap-2 text-xs text-mist">
              <span>Reroute target</span>
              <select
                className="rounded-lg border border-white/10 bg-navy-deep px-2 py-1.5 font-mono text-[11px] text-white/90"
                value={rerouteTimestep ?? ''}
                onChange={(e) => setRerouteTimestep(Number(e.target.value))}
              >
                {forwardOptions.map(({ i, d }) => (
                  <option key={d} value={i}>
                    D+{i} · {d}
                  </option>
                ))}
              </select>
            </label>
          </>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-xs text-danger">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        {plan && (
          <div className="rounded-xl border border-white/10 bg-navy-deep/50 px-3.5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-white">
                <RouteIcon size={13} className="text-ice" /> Route returned
                {plan.preference?.label && (
                  <Badge value={plan.preference.label} />
                )}
              </span>
              <span className="font-mono text-[11px] text-mist">
                {plan.date} · D+{plan.timestep} · {plan.waypoints} waypoints
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] text-mist sm:grid-cols-4">
              <span>
                length{' '}
                <span className="text-white/90">
                  {num(plan.route_length_km, 1) ?? '—'} km
                </span>
              </span>
              <span>
                mean SIC <span className="text-white/90">{num(plan.mean_sic) ?? '—'}</span>
              </span>
              <span>
                max SIC <span className="text-white/90">{num(plan.max_sic) ?? '—'}</span>
              </span>
              <span>
                cost <span className="text-white/90">{num(plan.total_cost, 3) ?? '—'}</span>
              </span>
            </div>
            {plan.goal?.snapped && (
              <p className="mt-2 text-[11px] text-warn">
                Destination snapped from ({plan.goal.requested?.lat}, {plan.goal.requested?.lon}) to a
                navigable cell {plan.goal.snap_radius_cells} cell(s) away — the API reports this
                rather than hiding it.
              </p>
            )}
            <p className={cn('mt-2 text-[11px]', plan.nan_cells === 0 ? 'text-safe' : 'text-danger')}>
              {plan.nan_cells === 0
                ? 'Validation: no non-navigable cell on the path.'
                : `Validation: ${plan.nan_cells} non-navigable cell(s) reported.`}
            </p>
          </div>
        )}

        {reroute && (
          <div className="rounded-xl border border-white/10 bg-navy-deep/50 px-3.5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white">Reroute result</span>
              <span className="font-mono text-[11px] text-mist">
                {reroute.origin_date} → {reroute.new_date} · D+{reroute.forecast_step_days}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[11px] text-mist sm:grid-cols-4">
              <span>
                changed cells{' '}
                <span className="text-white/90">{reroute.route_comparison?.changed_cells ?? '—'}</span>
              </span>
              <span>
                overlap{' '}
                <span className="text-white/90">
                  {typeof reroute.route_comparison?.jaccard_overlap === 'number'
                    ? reroute.route_comparison.jaccard_overlap.toFixed(3)
                    : '—'}
                </span>
              </span>
              <span>
                max SIC now{' '}
                <span className="text-white/90">{num(reroute.metrics?.updated?.max_sic) ?? '—'}</span>
              </span>
              <span>
                max SIC before{' '}
                <span className="text-white/90">{num(reroute.metrics?.original?.max_sic) ?? '—'}</span>
              </span>
            </div>
            {reroute.route_comparison?.identical_path ? (
              <p className="mt-2 text-[11px] text-safe">
                The corridor is byte-for-byte identical on this later day — reported as-is, not as a
                change.
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-mist">
                {reroute.changed_segments?.length ?? 0} segment(s) of the path changed on the later
                forecast field.
              </p>
            )}
          </div>
        )}
      </Card.Body>
    </Card>
  )
}

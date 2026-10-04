/**
 * RoutePlanning.jsx - the AURORA Route Optimizer.
 *
 * Every figure on this page comes from the backend's own response to
 * POST /api/route/optimize, POST /api/route/reroute or
 * GET /api/route/profile/<t>. Nothing is estimated client-side: distances are
 * the API's great-circle sums, SIC values are read from the real forecast
 * field along the returned path, and the cost profile is labelled with the
 * objective the server reports as active.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Info,
  LineChart as LineChartIcon,
  MapPin,
  Navigation,
  ServerCrash,
  XCircle,
} from 'lucide-react'
import PageHeader, { LiveChip } from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import AntarcticMap from '../components/map/AntarcticMap'
import MissionPlanner from '../components/mission/MissionPlanner'
import SicLegend from '../components/sic/SicLegend'
import useSicForecast from '../hooks/useSicForecast'
import { ChartCard, ChartTooltip } from '../components/charts'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip, ReferenceDot } from 'recharts'
import { fetchRouteProfile } from '../lib/auroraApi'

const num = (v, d = 3) => (typeof v === 'number' ? v.toFixed(d) : '—')
const km = (v) => (typeof v === 'number' ? `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })} km` : '—')

function Metric({ label, value, hint, tone }) {
  return (
    <div className="rounded-xl border border-white/5 bg-navy-deep/50 p-3">
      <p className="text-[10px] uppercase tracking-wider text-mist">{label}</p>
      <p
        className={`mt-1 font-display text-lg font-bold ${
          tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : 'text-white'
        }`}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[10px] leading-snug text-mist/80">{hint}</p>}
    </div>
  )
}

export default function RoutePlanning() {
  const [plan, setPlan] = useState(null)
  const [reroute, setReroute] = useState(null)
  const [profile, setProfile] = useState(null)
  const [profileError, setProfileError] = useState(null)

  const sic = useSicForecast()
  const sicRaster = sic.active?.available
    ? { url: sic.active.url, bounds: sic.active.bounds, label: `SIC ${sic.date}` }
    : null

  // Show the forecast day the route was planned against.
  useEffect(() => {
    if (typeof plan?.timestep === 'number') sic.setTimestep(plan.timestep)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan?.timestep])

  const loadProfile = useCallback(async (p) => {
    setProfileError(null)
    try {
      const body = await fetchRouteProfile(p.timestep, {
        startRow: p.start?.cell?.[0],
        startCol: p.start?.cell?.[1],
        goalRow: p.goal?.cell?.[0],
        goalCol: p.goal?.cell?.[1],
      })
      setProfile(body)
    } catch (err) {
      setProfile(null)
      setProfileError(err?.message ?? 'Route profile unavailable.')
    }
  }, [])

  const handlePlan = useCallback(
    (body) => {
      setReroute(null)
      setProfile(null)
      loadProfile(body)
    },
    [loadProfile],
  )

  const handleReroute = useCallback(
    (body) => {
      setReroute(body)
      if (body?.updated_route?.path) loadProfile({ ...plan, timestep: body.forecast_step_days + (plan?.timestep ?? 0) })
    },
    [plan, loadProfile],
  )

  const routeLatLngs = sic.metadata
    ? (plan?.path ?? [])
        .map(([r, c]) => {
          const lat = sic.metadata.lat?.[r]
          const lon = sic.metadata.lon?.[c]
          return lat == null || lon == null ? null : [Number(lat), Number(lon)]
        })
        .filter(Boolean)
    : []

  const endpoints = plan
    ? [
        { lat: plan.start.lat, lon: plan.start.lon, label: 'Origin', kind: 'origin' },
        { lat: plan.goal.lat, lon: plan.goal.lon, label: 'Destination', kind: 'goal' },
      ]
    : []

  const profileData = (profile?.samples ?? []).map((s) => ({
    x: s.cum_km,
    sic: typeof s.sic === 'number' ? Number((s.sic * 100).toFixed(1)) : null,
    km: s.cum_km,
  }))
  const maxPoint = profile?.max_sic_index >= 0 ? profileData[profile.max_sic_index] : null

  const v = plan?.validation ?? null
  const validationRows = v
    ? [
        ['Cells in bounds', v.all_cells_in_bounds],
        ['Starts at requested origin', v.starts_at_start],
        ['Reaches requested destination', v.reaches_goal],
        ['8-connected / contiguous', v.contiguous_8_connected],
        ['No non-navigable cell crossed', v.nan_cells === 0 && v.non_navigable_cells === 0],
      ]
    : []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Route Optimizer"
        subtitle="A* + CostMap over the real 2026 SIC forecast field (0.25° grid, 173 × 369). The backend owns the algorithm; this page only collects inputs and reports what came back."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <LiveChip label="Real routing engine" dot="safe" />
            <LiveChip label={sic.status === 'ready' ? `SIC ${sic.date}` : 'SIC unavailable'} dot={sic.status === 'ready' ? 'cyan' : 'warn'} />
          </div>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <MissionPlanner className="h-fit" onPlan={handlePlan} onReroute={handleReroute} metadata={sic.metadata} />

        <Card className="overflow-hidden">
          <Card.Header
            title="Planned corridor"
            subtitle={
              plan
                ? `${plan.start.lat.toFixed(2)}°, ${plan.start.lon.toFixed(2)}° → ${plan.goal.lat.toFixed(2)}°, ${plan.goal.lon.toFixed(2)}° · ${plan.date}`
                : 'No route yet — set a mission in the planner'
            }
            icon={Navigation}
            action={
              plan ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge value="Real A* route" />
                  <span className="font-mono text-[11px] text-mist">{plan.algorithm}</span>
                </div>
              ) : null
            }
          />
          <div className="p-3">
            <AntarcticMap
              center={[-60, 45]}
              zoom={3}
              height={520}
              sicRaster={sicRaster}
              sicRasterOpacity={0.8}
              showSeaIce={Boolean(sicRaster)}
              routeLine={routeLatLngs}
              endpoints={endpoints}
              className="!rounded-xl"
            />
          </div>
          <div className="border-t border-white/5 px-5 py-3">
            {sicRaster ? (
              <SicLegend legend={sic.active.legend} stats={sic.active.stats} />
            ) : (
              <p className="text-[11px] leading-relaxed text-warn">
                SIC raster unavailable{sic.error ? `: ${sic.error.message}` : '.'} The map shows the
                basemap and the returned route only — no concentration field is invented.
              </p>
            )}
          </div>
        </Card>
      </div>

      {!plan && (
        <Card>
          <Card.Body className="flex flex-col items-center gap-2 py-10 text-center">
            <Info size={22} className="text-mist" />
            <p className="text-sm font-semibold text-white/85">No route calculated yet</p>
            <p className="max-w-xl text-xs leading-relaxed text-mist">
              Choose an origin, destination and forecast day above and press <em>Calculate route</em>.
              The backend returns HTTP 400 (never a fabricated path) for endpoints outside the grid,
              endpoints that are not navigable, or a destination that cannot be reached.
            </p>
          </Card.Body>
        </Card>
      )}

      {plan && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Track length" value={km(plan.route_length_km)} hint={plan.route_length_km_note} />
            <Metric label="Straight-line distance" value={km(plan.direct_length_km)} hint="great-circle start → destination" />
            <Metric label="Mean SIC on path" value={num(plan.mean_sic)} hint="from the forecast field at this day" />
            <Metric
              label="Max SIC on path"
              value={num(plan.max_sic)}
              tone={plan.max_sic >= 0.7 ? 'warn' : undefined}
              hint="highest concentration the track passes through"
            />
            <Metric label="Waypoints" value={plan.waypoints} hint={`${plan.route_length} grid cells (route_length_units: ${plan.route_length_units})`} />
            <Metric label="Total cost" value={num(plan.total_cost)} hint={`A* cost under the active weights · ${plan.expanded_nodes} nodes expanded`} />
            <Metric label="Non-navigable cells" value={plan.nan_cells + plan.non_navigable_cells} tone={plan.nan_cells + plan.non_navigable_cells === 0 ? undefined : 'danger'} hint="NaN cells on the path — must be 0" />
            <Metric label="Forecast day" value={`D+${plan.timestep}`} hint={plan.date} />
          </div>

          <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
            <ChartCard
              title="Sea-ice concentration along the track"
              subtitle={
                profile
                  ? `${profile.waypoints} waypoints · ${profile.great_circle_length_km} km great-circle · ${profile.date}`
                  : profileError
                    ? 'profile unavailable'
                    : 'loading real profile…'
              }
              action={<span className="inline-flex items-center gap-1 font-mono text-xs text-ice"><LineChartIcon size={13} /> % SIC</span>}
              height={280}
            >
              {profileError ? (
                <p className="pt-6 text-center text-xs text-warn">{profileError}</p>
              ) : profileData.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={profileData} margin={{ top: 8, right: 12, left: -14, bottom: 0 }}>
                    <CartesianGrid stroke="rgba(148,163,184,0.08)" strokeDasharray="4 4" />
                    <XAxis
                      dataKey="km"
                      type="number"
                      domain={['dataMin', 'dataMax']}
                      stroke="rgba(148,163,184,0.4)"
                      tick={{ fill: '#7c8ea6', fontSize: 11 }}
                      tickFormatter={(v) => `${Math.round(v)}`}
                      label={{ value: 'km along track', position: 'insideBottom', offset: -2, fill: '#7c8ea6', fontSize: 10 }}
                    />
                    <YAxis
                      stroke="rgba(148,163,184,0.4)"
                      tick={{ fill: '#7c8ea6', fontSize: 11 }}
                      unit="%"
                      domain={[0, 100]}
                    />
                    <Tooltip content={<ChartTooltip unit="%" />} />
                    <Line
                      type="monotone"
                      dataKey="sic"
                      name="SIC"
                      stroke="#7DD3FC"
                      strokeWidth={2}
                      dot={false}
                      connectNulls={false}
                    />
                    {maxPoint && (
                      <ReferenceDot x={maxPoint.x} y={maxPoint.sic} r={4} fill="#F59E0B" stroke="none" />
                    )}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <p className="pt-6 text-center text-xs text-mist">Waiting for the route profile…</p>
              )}
            </ChartCard>

            <Card>
              <Card.Header title="Path validation" subtitle="reported by the backend" icon={CheckCircle2} />
              <Card.Body className="space-y-2">
                {validationRows.map(([label, ok]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between rounded-lg border border-white/5 bg-navy-deep/40 px-3 py-2 text-xs"
                  >
                    <span className="text-white/85">{label}</span>
                    {ok ? (
                      <span className="inline-flex items-center gap-1 font-mono text-safe">
                        <CheckCircle2 size={13} /> PASS
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-mono text-danger">
                        <XCircle size={13} /> FAIL
                      </span>
                    )}
                  </div>
                ))}
                <p className="pt-1 text-[11px] leading-relaxed text-mist">
                  Maximum step {v?.max_step_cells ?? '—'} cell(s). Endpoint cells:{' '}
                  <span className="font-mono">
                    {plan.start.cell[0]},{plan.start.cell[1]} → {plan.goal.cell[0]},{plan.goal.cell[1]}
                  </span>
                </p>
              </Card.Body>
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <Card.Header title="Cost breakdown" subtitle="weights are server configuration" icon={LineChartIcon} />
              <Card.Body className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {Object.entries(plan.cost_weights ?? {})
                    .filter(([k, val]) => k !== 'vessel_draft_m' && Number.isFinite(Number(val)))
                    .map(([k, val]) => (
                      <span
                        key={k}
                        className={`rounded-lg border px-2.5 py-1 font-mono text-[11px] ${
                          Number(val) > 0
                            ? 'border-ice/30 bg-ice/10 text-ice'
                            : 'border-white/10 bg-white/5 text-mist/60'
                        }`}
                      >
                        {k} = {val}
                      </span>
                    ))}
                </div>
                {plan.cost_breakdown && (
                  <div className="space-y-1.5 font-mono text-[11px] text-mist">
                    {Object.entries(plan.cost_breakdown)
                      .filter(([k]) => k !== 'layers_in_cost')
                      .map(([k, val]) => (
                        <div key={k} className="flex items-center justify-between border-b border-white/5 pb-1">
                          <span>{k}</span>
                          <span className="text-white/85">
                            {typeof val === 'number' ? num(val, 4) : JSON.stringify(val)}
                          </span>
                        </div>
                      ))}
                    <div className="flex items-center justify-between">
                      <span>layers in cost</span>
                      <span className="text-white/85">
                        {(plan.cost_breakdown.layers_in_cost ?? []).join(', ') || '—'}
                      </span>
                    </div>
                  </div>
                )}
                <p className="text-[11px] leading-relaxed text-mist">
                  Terms with weight 0 are not part of the objective. The UI never claims a route used
                  an unconfigured profile.
                </p>
              </Card.Body>
            </Card>

            <Card>
              <Card.Header title="Provenance" subtitle="what produced this route" icon={Database} />
              <Card.Body className="space-y-2">
                {Object.entries(plan.provenance ?? {}).map(([k, val]) => (
                  <div key={k} className="rounded-lg border border-white/5 bg-navy-deep/40 px-3 py-2">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-mist">{k}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-white/85">{String(val)}</p>
                  </div>
                ))}
              </Card.Body>
            </Card>
          </div>

          {reroute && (
            <Card>
              <Card.Header
                title="Reroute comparison"
                subtitle={`${reroute.origin_date} → ${reroute.new_date} (D+${reroute.forecast_step_days})`}
                icon={Navigation}
                action={<Badge value={reroute.status === 'SUCCESS' ? 'Recommended' : 'Warning'} />}
              />
              <Card.Body className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-4">
                  <Metric label="Original max SIC" value={num(reroute.metrics?.original?.max_sic)} />
                  <Metric label="Rerouted max SIC" value={num(reroute.metrics?.updated?.max_sic)} />
                  <Metric label="Changed cells" value={reroute.route_comparison?.changed_cells ?? '—'} />
                  <Metric
                    label="Overlap (Jaccard)"
                    value={
                      typeof reroute.route_comparison?.jaccard_overlap === 'number'
                        ? reroute.route_comparison.jaccard_overlap.toFixed(3)
                        : '—'
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  {(reroute.changed_segments ?? []).map((sg, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg border border-white/5 bg-navy-deep/40 px-3 py-2 font-mono text-[11px]"
                    >
                      <span className="text-white/85">
                        {sg.route} · {sg.from_cell?.join(',')} → {sg.to_cell?.join(',')}
                      </span>
                      <span className="text-mist">
                        {sg.cells} cells · {sg.length_grid_units} grid units
                      </span>
                    </div>
                  ))}
                  {(reroute.changed_segments ?? []).length === 0 && (
                    <p className="text-xs text-safe">
                      No segment changed on the later forecast day — an identical corridor is a real
                      result, not a missing one.
                    </p>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed text-mist">{reroute.reroute_logic}</p>
              </Card.Body>
            </Card>
          )}

          <Card>
            <Card.Header title="Documented limitations" subtitle="from /api/limitations, attached to this route" icon={AlertTriangle} />
            <Card.Body className="grid gap-2.5 sm:grid-cols-2">
              {Object.entries(plan.limitations ?? {}).map(([k, text]) => (
                <div key={k} className="rounded-xl border border-warn/20 bg-warn/5 px-3.5 py-2.5">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-warn">{k}</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-white/85">{text}</p>
                </div>
              ))}
            </Card.Body>
          </Card>
        </>
      )}

      {!sic.metadata && sic.status === 'error' && (
        <div className="flex items-start gap-3 rounded-2xl border border-danger/40 bg-danger/10 px-5 py-4 text-danger">
          <ServerCrash size={18} className="mt-0.5 shrink-0" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold">AURORA backend unreachable</p>
            <p className="text-xs leading-relaxed text-danger/90">{sic.error?.message}</p>
          </div>
        </div>
      )}

      <div className="flex items-start gap-2.5 rounded-xl border border-white/5 bg-navy-deep/40 px-4 py-3">
        <MapPin size={15} className="mt-0.5 shrink-0 text-mist" />
        <p className="text-[11px] leading-relaxed text-mist">
          This is a research prototype. A returned route is validated (in bounds, contiguous,
          goal-reaching, free of non-navigable cells) but is not a navigational product: real
          Antarctic transits require verified charting, ice-pilot judgement and vessel-specific
          limits that are not part of this system.
        </p>
      </div>
    </div>
  )
}

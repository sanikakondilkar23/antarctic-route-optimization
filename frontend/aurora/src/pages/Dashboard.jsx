/**
 * Dashboard.jsx - AURORA operations dashboard.
 *
 * Every tile on this page is either a value the API returned, a documented
 * limitation, or an empty state that says so. There are no simulated vessels,
 * alerts, efficiencies or telemetry readings anywhere in this file.
 */

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Compass,
  Database,
  Layers,
  RefreshCw,
  Route as RouteIcon,
  ServerCrash,
  Snowflake,
  Waves,
  XCircle,
} from 'lucide-react'
import PageHeader, { LiveChip } from '../components/ui/PageHeader'
import StatCard from '../components/ui/StatCard'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import AntarcticMap from '../components/map/AntarcticMap'
import MissionPlanner from '../components/mission/MissionPlanner'
import SicLegend from '../components/sic/SicLegend'
import { ChartCard, ChartTooltip } from '../components/charts'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts'
import useSicForecast from '../hooks/useSicForecast'
import {
  fetchHealth,
  fetchLimitations,
  fetchSystemStatus,
  fetchUncertaintySummary,
} from '../lib/auroraApi'
import { fmtTimestamp } from '../data'

const pct = (v) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—')

function AvailabilityRow({ label, ok, detail, okText = 'AVAILABLE', badText = 'UNAVAILABLE' }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/5 py-2 last:border-0">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-white/90">{label}</p>
        {detail && <p className="mt-0.5 text-[11px] leading-snug text-mist">{detail}</p>}
      </div>
      {ok ? (
        <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-safe">
          <CheckCircle2 size={13} /> {okText}
        </span>
      ) : (
        <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-warn">
          <XCircle size={13} /> {badText}
        </span>
      )}
    </div>
  )
}

export default function Dashboard() {
  const sic = useSicForecast()
  const [health, setHealth] = useState(null)
  const [system, setSystem] = useState(null)
  const [limitations, setLimitations] = useState(null)
  const [uncertainty, setUncertainty] = useState(null)
  const [refreshedAt, setRefreshedAt] = useState(fmtTimestamp())
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    const results = await Promise.allSettled([
      fetchHealth(),
      fetchSystemStatus(),
      fetchLimitations(),
      fetchUncertaintySummary(),
    ])
    const [h, s, l, u] = results
    if (h.status === 'fulfilled') setHealth(h.value)
    if (s.status === 'fulfilled') setSystem(s.value)
    if (l.status === 'fulfilled') setLimitations(l.value)
    if (u.status === 'fulfilled') setUncertainty(u.value)
    setRefreshedAt(fmtTimestamp())
    setBusy(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const sicRaster = sic.active?.available
    ? { url: sic.active.url, bounds: sic.active.bounds, label: `SIC ${sic.date}` }
    : null

  const histData = uncertainty?.available
    ? (uncertainty.histogram_counts ?? []).map((c, i) => ({
        bin: Number(((uncertainty.histogram_bins?.[i] ?? 0) * 100).toFixed(1)),
        count: c,
      }))
    : []

  const env = system?.environment ?? {}
  const models = system?.models ?? {}
  const offline = health === null && sic.status === 'error'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-ice" />
            <span className="font-mono text-xs font-bold uppercase tracking-widest text-mist">
              {system ? `${system.project} · ${system.system}` : 'AURORA'}
            </span>
          </div>
          <h1 className="mt-1 font-display text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            Antarctic operations dashboard
          </h1>
          <p className="mt-0.5 text-xs text-mist">
            Real SIC forecast field, real A* routing, honest availability reporting.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-abyssal-deck px-3.5 py-1.5 font-mono text-xs text-mist">
            <Clock size={13} className="text-ice" />
            <span>
              Sync: <strong className="text-white">{refreshedAt}</strong>
            </span>
          </div>
          <Button onClick={() => { sic.refresh(); load() }} disabled={busy} className="!py-1.5 !px-3.5 !text-xs font-bold">
            <RefreshCw size={13} className={busy || sic.status === 'loading' ? 'animate-spin' : ''} />
            {busy ? 'Loading…' : 'Refresh'}
          </Button>
        </div>
      </div>

      {offline && (
        <div className="flex items-start gap-3 rounded-2xl border border-danger/40 bg-danger/10 px-5 py-4 text-danger">
          <ServerCrash size={18} className="mt-0.5 shrink-0" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold">AURORA backend unreachable — no values are shown</p>
            <p className="text-xs leading-relaxed text-danger/90">
              Start it with <span className="font-mono">python backend/api/main.py</span> and reload.
              Nothing on this page is substituted from demo data.
            </p>
          </div>
        </div>
      )}

      {/* KPI tiles - API values only */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Forecast window"
          value={sic.metadata ? `${sic.nTimesteps} d` : '—'}
          subtitle={
            sic.metadata
              ? `${sic.metadata.date_range?.[0]} → ${sic.metadata.date_range?.[1]} (2026 SIC artifact)`
              : 'metadata unavailable'
          }
          icon={Database}
          tone="ocean"
          note={sic.metadata ? 'REAL FIELD' : 'UNAVAILABLE'}
        />
        <StatCard
          label="Mean SIC (selected day)"
          value={pct(sic.active?.stats?.mean)}
          subtitle={sic.date ? `valid cells on ${sic.date}` : 'no frame loaded'}
          icon={Waves}
          tone="cyan"
          note={sic.active?.available ? 'FORECAST' : 'UNAVAILABLE'}
        />
        <StatCard
          label="ConvLSTM checkpoints"
          value={
            sic.checkpointSummary
              ? `${sic.checkpointSummary.loaded}/${sic.checkpointSummary.expected}`
              : '—'
          }
          subtitle={
            sic.checkpointSummary
              ? `${sic.checkpointSummary.architecture ?? 'ensemble'} · ${sic.checkpointSummary.parameters?.toLocaleString()} params`
              : 'ensemble report unavailable'
          }
          icon={Snowflake}
          tone={sic.checkpointSummary?.loaded === sic.checkpointSummary?.expected ? 'safe' : 'warn'}
          note={sic.checkpointSummary?.inferenceRerunPossible ? 'INFERENCE LIVE' : 'COMMITTED OUTPUT'}
        />
        <StatCard
          label="Backend"
          value={health?.status === 'ok' ? 'ONLINE' : 'OFFLINE'}
          subtitle={
            health
              ? `SIC artifact ${health.sic_artifact ? 'present' : 'missing'} · route artifact ${
                  health.route_artifact ? 'present' : 'missing'
                }`
              : 'no response from /api/health'
          }
          icon={Activity}
          tone={health?.status === 'ok' ? 'safe' : 'danger'}
          note={health ? 'HEALTH ENDPOINT' : 'UNAVAILABLE'}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <Card className="overflow-hidden h-full">
            <Card.Header
              title="Southern Ocean theatre"
              subtitle={
                sicRaster
                  ? `Real SIC raster · ${sic.date} · ${sic.active.legend?.units ?? ''}`
                  : 'SIC raster not loaded'
              }
              icon={Compass}
              action={
                <div className="flex items-center gap-2">
                  <Link
                    to="/sea-ice"
                    className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-xs font-semibold text-white hover:border-ice/40 transition"
                  >
                    <Layers size={13} /> Forecast
                  </Link>
                  <Link
                    to="/route-planner"
                    className="inline-flex items-center gap-1 rounded-lg border border-ice/30 bg-ice/10 px-2.5 py-1 text-xs font-bold text-ice hover:bg-ice/20 transition"
                  >
                    <RouteIcon size={13} /> Route Optimizer
                  </Link>
                </div>
              }
            />
            <div className="p-3">
              <AntarcticMap
                height={440}
                sicRaster={sicRaster}
                showSeaIce={Boolean(sicRaster)}
                className="!rounded-xl border border-white/10"
              />
            </div>
            <div className="border-t border-white/5 px-5 py-3">
              {sicRaster ? (
                <SicLegend legend={sic.active.legend} stats={sic.active.stats} />
              ) : (
                <p className="text-[11px] leading-relaxed text-warn">
                  {sic.status === 'error'
                    ? `SIC unavailable: ${sic.error?.message}`
                    : 'Loading the real concentration field — no placeholder is drawn meanwhile.'}
                </p>
              )}
            </div>
          </Card>
        </div>

        <div className="xl:col-span-5 space-y-4">
          <MissionPlanner metadata={sic.metadata} />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <Card.Header
            title="Data & model availability"
            subtitle="exactly what this deployment can serve"
            icon={Database}
            action={
              system ? (
                <LiveChip label={system.retraining_performed ? 'retrained' : 'no retraining'} dot={system.retraining_performed ? 'warn' : 'safe'} />
              ) : null
            }
          />
          <Card.Body>
            {!system ? (
              <p className="text-xs text-mist">Waiting for /api/system/status…</p>
            ) : (
              <>
                <AvailabilityRow
                  label="Sea-ice concentration"
                  ok={env.sic?.available}
                  detail={`${env.sic?.label} · ${env.sic?.n_timesteps} steps · ${env.sic?.grid?.join('×')} @ ${env.sic?.resolution_deg}°`}
                />
                <AvailabilityRow
                  label="Forecast uncertainty"
                  ok={Boolean(env.sic?.uncertainty_shape) || Boolean(uncertainty?.available)}
                  detail={
                    env.sic?.uncertainty_shape
                      ? `shape ${env.sic.uncertainty_shape.join('×')} · ${env.sic.uncertainty_horizons} horizons · committed artifact`
                      : 'committed uncertainty artifact'
                  }
                />
                <AvailabilityRow
                  label="Ocean currents (CMEMS)"
                  ok={env.cmems?.available}
                  detail={env.cmems?.label}
                />
                <AvailabilityRow
                  label="Iceberg risk layer"
                  ok={env.iceberg?.available}
                  detail={env.iceberg?.label}
                />
                <AvailabilityRow
                  label="Route ML policy"
                  ok={Boolean(models.route_policy?.present)}
                  detail={
                    models.route_policy
                      ? `${models.route_policy.training_data} · used for final route: ${models.route_policy.used_for_final_route}`
                      : 'not discovered'
                  }
                />
                <div className="mt-2 rounded-xl border border-ice/20 bg-ice/5 px-3 py-2">
                  <p className="text-[11px] leading-relaxed text-white/85">
                    <span className="font-semibold">Retraining:</span>{' '}
                    {system.retraining_performed
                      ? 'retraining was performed for this run.'
                      : 'none — only the repository\'s pre-trained checkpoints are used, and no metric is re-computed.'}{' '}
                    <span className="text-mist">synthetic route data used: </span>
                    <span className={system.synthetic_route_data_used ? 'text-warn' : 'text-safe'}>
                      {String(system.synthetic_route_data_used)}
                    </span>
                    .
                  </p>
                </div>
              </>
            )}
          </Card.Body>
        </Card>

        <div className="space-y-4">
          <ChartCard
            title="Forecast uncertainty distribution"
            subtitle={
              uncertainty?.available
                ? `committed artifact · ${uncertainty.source}`
                : 'uncertainty summary unavailable'
            }
            action={<Badge value={uncertainty?.available ? 'Real output' : 'Unavailable'} />}
            height={200}
          >
            {histData.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={histData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(148,163,184,0.08)" strokeDasharray="4 4" />
                  <XAxis
                    dataKey="bin"
                    stroke="rgba(148,163,184,0.4)"
                    tick={{ fill: '#7c8ea6', fontSize: 10 }}
                    label={{ value: '1σ spread (SIC %)', position: 'insideBottom', offset: -2, fill: '#7c8ea6', fontSize: 10 }}
                  />
                  <YAxis stroke="rgba(148,163,184,0.4)" tick={{ fill: '#7c8ea6', fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="count" name="cells" fill="#7DD3FC" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="pt-6 text-center text-xs text-mist">
                DATA UNAVAILABLE — no uncertainty histogram is served.
              </p>
            )}
          </ChartCard>

          <Card>
            <Card.Header
              title="Documented limitations"
              subtitle="GET /api/limitations"
              icon={AlertTriangle}
              action={<Link to="/system-status" className="text-xs font-semibold text-ice hover:underline">Full status</Link>}
            />
            <Card.Body className="grid gap-2 sm:grid-cols-2">
              {limitations
                ? Object.entries(limitations).map(([k, text]) => (
                    <div key={k} className="rounded-xl border border-warn/20 bg-warn/5 px-3 py-2">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-warn">{k}</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-white/85">{text}</p>
                    </div>
                  ))
                : <p className="text-xs text-mist">Waiting for /api/limitations…</p>}
            </Card.Body>
          </Card>
        </div>
      </div>

      <div className="flex items-start gap-2.5 rounded-xl border border-white/5 bg-navy-deep/40 px-4 py-3">
        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-mist" />
        <p className="text-[11px] leading-relaxed text-mist">
          This prototype serves only what the repository actually contains: a committed 2026 SIC
          forecast field, its uncertainty artifact, and A* route optimisation over them. Vessel
          tracking, iceberg positions, wind and current fields are <strong>not</strong> served and are
          therefore not shown.
        </p>
      </div>
    </div>
  )
}

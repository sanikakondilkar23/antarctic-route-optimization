import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowRight,
  CheckCircle2,
  CircleSlash,
  Clock,
  Compass,
  Gauge,
  Layers,
  Navigation,
  RefreshCw,
  Route as RouteIcon,
  ServerCrash,
  ShieldAlert,
  Ship,
  Snowflake,
  Waves,
  Wind,
} from 'lucide-react'
import PageHeader, { MetaItem } from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { ErrorState, LoadingState } from '../components/ui/Status'
import { MetricCard, Notice, SectionHeader } from '../components/ui/Panels'
import AntarcticMap from '../components/map/AntarcticMap'
import SicLegend from '../components/sic/SicLegend'
import { useAuth } from '../context/AuthContext'
import useSicForecast from '../hooks/useSicForecast'
import {
  fetchAuroraStatus,
  fetchHealth,
  fetchIcebergStatus,
  fetchLayersStatus,
  fetchUncertaintySummary,
  fetchVerifiedRoute,
  pathToLatLngs,
} from '../lib/auroraApi'
import { useCoastline } from '../lib/hooks'
import { cn } from '../lib/utils'

/* ------------------------------------------------------------------ */
/* Status vocabulary - exactly the words the backend publishes.        */
/* ------------------------------------------------------------------ */

const DOT_TONE = {
  READY: 'bg-safe',
  'INTEGRATION READY': 'bg-ice',
  'DATA UNAVAILABLE': 'bg-warn',
  'GEOREFERENCING UNAVAILABLE': 'bg-warn',
  'MODEL UNAVAILABLE': 'bg-danger',
  ERROR: 'bg-danger',
}

const TEXT_TONE = {
  READY: 'text-safe',
  'INTEGRATION READY': 'text-ice',
  'DATA UNAVAILABLE': 'text-warn',
  'GEOREFERENCING UNAVAILABLE': 'text-warn',
  'MODEL UNAVAILABLE': 'text-danger',
  ERROR: 'text-danger',
}

function tone(status) {
  return TEXT_TONE[status] ?? 'text-mist'
}

function dot(status) {
  return DOT_TONE[status] ?? 'bg-steel'
}

/** One of the four intelligence groups shown on the status rail. */
function StatusDot({ label, status, detail }) {
  return (
    <div
      className="group flex min-w-0 flex-1 items-start gap-2.5 border border-graphite-600 bg-graphite-850 px-3.5 py-2.5"
      title={detail ?? status}
    >
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${dot(status)}`} />
      <div className="min-w-0">
        <p className="truncate text-[11.5px] font-semibold text-white/90">{label}</p>
        <p className={`truncate font-mono text-[10px] uppercase tracking-wider ${tone(status)}`}>
          {status ?? 'unknown'}
        </p>
      </div>
    </div>
  )
}

/** The compact intelligence card that sits under the hero. */
function IntelligenceCard({ icon: Icon, title, status, badge, lines, action, loading, error }) {
  return (
    <Card className="flex h-full flex-col">
      <Card.Header
        title={title}
        icon={Icon}
        action={badge ?? (status ? <Badge value={status} /> : null)}
      />
      <Card.Body className="flex flex-1 flex-col gap-2">
        {loading && <LoadingState label={`Reading ${title.toLowerCase()} status`} />}
        {error && <ErrorState title={`${title} unavailable`} message={error} compact />}
        {!loading && !error && (
          <dl className="space-y-1.5">
            {lines.map(([k, v, cls]) => (
              <div key={k} className="flex items-baseline justify-between gap-3">
                <dt className="shrink-0 text-[11.5px] text-mist">{k}</dt>
                <dd
                  className={`num truncate text-right text-[12px] ${cls ?? 'text-white/90'}`}
                  title={String(v ?? '')}
                >
                  {v ?? '—'}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <div className="mt-auto pt-2">{action}</div>
      </Card.Body>
    </Card>
  )
}

function QuickAction({ to, icon: Icon, title, hint }) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 border border-graphite-600 bg-graphite-850 px-4 py-3 transition hover:border-ice/50 hover:bg-graphite-800"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-graphite-600 bg-graphite-950 text-ice transition group-hover:border-ice/40">
        <Icon size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-white">{title}</span>
        <span className="block truncate text-[11px] text-mist">{hint}</span>
      </span>
      <ArrowRight size={15} className="shrink-0 text-steel transition group-hover:translate-x-0.5 group-hover:text-ice" />
    </Link>
  )
}

/** One block of the parallel-stream diagram. Decorative: it renders no value. */
function StreamNode({ icon: Icon, title, body, endpoint, tone = 'ok' }) {
  return (
    <div className="h-full border border-graphite-600 bg-graphite-900 px-4 py-3.5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-graphite-600 bg-graphite-950 text-ice">
          <Icon size={15} />
        </span>
        <p className="text-[13px] font-semibold text-white">{title}</p>
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-mist">{body}</p>
      <p
        className={cn(
          'mt-2 border-t border-graphite-700 pt-2 font-mono text-[10px] leading-relaxed',
          tone === 'warn' ? 'text-warn' : 'text-steel'
        )}
      >
        {endpoint}
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */

export default function Overview() {
  const { user } = useAuth()
  const sicR = useSicForecast()
  const meta = { data: sicR.metadata, loading: sicR.status === 'loading' }
  const sic = {
    active: sicR.active,
    date: sicR.date,
    loading: sicR.status === 'loading',
    error: sicR.error,
  }
  const timestep = sicR.timestep
  const setTimestep = sicR.setTimestep
  const dates = sicR.dates ?? []
  const coastline = useCoastline()

  const [status, setStatus] = useState({ data: null, error: null, loading: true })
  const [health, setHealth] = useState({ data: null, error: null, loading: true })
  const [verified, setVerified] = useState({ data: null, error: null, loading: true })
  const [iceberg, setIceberg] = useState({ data: null, error: null, loading: true })
  const [uncertainty, setUncertainty] = useState({ data: null, error: null, loading: true })
  const [layers, setLayers] = useState({ data: null, error: null, loading: true })
  const [refreshedAt, setRefreshedAt] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async (opts = {}) => {
    if (opts.withBusy) setBusy(true)
    const [s, h, v, i, u, l] = await Promise.allSettled([
      fetchAuroraStatus(),
      fetchHealth(),
      fetchVerifiedRoute(),
      fetchIcebergStatus(),
      fetchUncertaintySummary(),
      fetchLayersStatus(0),
    ])
    if (s.status === 'fulfilled') setStatus({ data: s.value, error: null, loading: false })
    else setStatus((p) => ({ ...p, error: s.reason?.message ?? String(s.reason), loading: false }))

    if (h.status === 'fulfilled') setHealth({ data: h.value, error: null, loading: false })
    else setHealth((p) => ({ ...p, error: h.reason?.message ?? String(h.reason), loading: false }))

    if (v.status === 'fulfilled') setVerified({ data: v.value, error: null, loading: false })
    else if (v.reason?.status === 404) setVerified({ data: null, error: null, loading: false })
    else setVerified((p) => ({ ...p, error: v.reason?.message ?? String(v.reason), loading: false }))

    if (i.status === 'fulfilled') setIceberg({ data: i.value, error: null, loading: false })
    else setIceberg((p) => ({ ...p, error: i.reason?.message ?? String(i.reason), loading: false }))

    if (u.status === 'fulfilled') setUncertainty({ data: u.value, error: null, loading: false })
    else setUncertainty((p) => ({ ...p, error: u.reason?.message ?? String(u.reason), loading: false }))

    if (l.status === 'fulfilled') setLayers({ data: l.value, error: null, loading: false })
    else setLayers((p) => ({ ...p, error: l.reason?.message ?? String(l.reason), loading: false }))

    setRefreshedAt(new Date().toISOString().slice(11, 19))
    if (opts.withBusy) setBusy(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const models = status.data?.models ?? {}
  const env = status.data?.data ?? {}
  const counts = status.data?.counts ?? null

  /* --- the four status-rail dots ---------------------------------- */
  const rail = [
    { label: 'Route Engine', status: models.route?.status, detail: models.route?.detail },
    { label: 'SIC', status: models.sic?.status, detail: models.sic?.detail },
    { label: 'Iceberg', status: models.iceberg?.status, detail: models.iceberg?.detail },
    {
      label: 'Environmental Data',
      status:
        env.wind?.available || env.current?.available || env.water?.available
          ? 'READY'
          : 'DATA UNAVAILABLE',
      detail: [env.wind?.detail, env.current?.detail, env.water?.detail]
        .filter(Boolean)
        .join(' · '),
    },
  ]

  const offline = !status.loading && !status.data && !health.loading && !health.data

  /* --- map layer -------------------------------------------------- */
  const sicRaster = sic.active?.available
    ? { url: sic.active.url, bounds: sic.active.bounds, label: `SIC ${sic.date}` }
    : null

  const routeLine = useMemo(() => {
    if (!verified.data?.path || !meta.data) return null
    return pathToLatLngs(meta.data, verified.data.path)
  }, [verified.data, meta.data])

  const endpoints = useMemo(() => {
    const leg = verified.data?.leg
    if (!leg?.start_latlon || !leg?.goal_latlon) return []
    return [
      { lat: leg.start_latlon[0], lon: leg.start_latlon[1], kind: 'origin', label: 'route start' },
      { lat: leg.goal_latlon[0], lon: leg.goal_latlon[1], kind: 'destination', label: 'route goal' },
    ]
  }, [verified.data])

  const anyLoading = status.loading || meta.loading

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-[1520px] space-y-5 p-4 md:p-6">
        {/* ---------------------------------------------------------- */}
        {/* Header                                                     */}
        {/* ---------------------------------------------------------- */}
        <PageHeader
          title="AURORA OVERVIEW"
          subtitle="Antarctic operational intelligence — component status, the theatre map, and a direct path into environment, ice, risk, routes and models."
          meta={
            <>
              <MetaItem label="OPERATOR" value={user?.name ?? '—'} />
              <MetaItem label="ORGANISATION" value={user?.organization ?? '—'} />
              <MetaItem label="STATUS" value={status.data?.status ?? '…'} />
              <MetaItem label="SYNC" value={refreshedAt ? `${refreshedAt} UTC` : '—'} />
            </>
          }
          actions={
            <Button
              onClick={() => load({ withBusy: true })}
              disabled={busy || anyLoading}
              variant="secondary"
            >
              <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
              {busy ? 'Refreshing…' : 'Refresh'}
            </Button>
          }
        />

        {/* ---------------------------------------------------------- */}
        {/* System status rail                                          */}
        {/* ---------------------------------------------------------- */}
        {offline ? (
          <div className="flex items-start gap-3 border border-danger/40 bg-danger/10 px-4 py-3 text-danger">
            <ServerCrash size={18} className="mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-semibold">AURORA backend unreachable — no values are shown</p>
              <p className="text-xs leading-relaxed text-danger/90">
                Start it with <span className="font-mono">python backend/api/main.py --port 8078</span>{' '}
                and reload. Nothing on this page is substituted from demo data.
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {rail.map((r) =>
              anyLoading ? (
                <div key={r.label} className="border border-graphite-600 bg-graphite-850 px-3.5 py-2.5">
                  <p className="text-[11.5px] font-semibold text-white/90">{r.label}</p>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-steel">probing…</p>
                </div>
              ) : (
                <StatusDot key={r.label} {...r} />
              )
            )}
          </div>
        )}

        {/* ---------------------------------------------------------- */}
        {/* Hero                                                        */}
        {/* ---------------------------------------------------------- */}
        <section className="relative overflow-hidden border border-graphite-600 bg-graphite-850 p-5 md:p-7">
          <div className="pointer-events-none absolute inset-0 bg-polar-grid opacity-60" />
          <div className="relative max-w-3xl">
            <p className="eyebrow">Antarctic operational intelligence</p>
            <h1 className="mt-2 font-display text-2xl font-bold leading-tight tracking-tight text-white md:text-[30px]">
              Uncertainty-Aware Maritime Route Optimization for Antarctic Waters
            </h1>
            <p className="mt-3 text-[13.5px] leading-relaxed text-mist">
              AURORA runs three independent intelligence streams — a ConvLSTM sea-ice concentration
              forecaster, a SAR YOLOv8 iceberg detector, and environmental layer probes — in
              parallel. They meet only as operational context for the deterministic A* route
              optimiser, which consumes exactly the layers the backend reports as available. Every
              figure below is reported by this repository's own backend, and every layer that is
              missing is named as missing.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
              {counts && (
                <>
                  <span className="mono-label">
                    COMPONENTS READY{' '}
                    <span className="text-white">
                      {counts.ready}/{counts.total}
                    </span>
                  </span>
                  <span className="mono-label">
                    UNAVAILABLE{' '}
                    <span className="text-warn">{counts.unavailable}</span>
                  </span>
                  <span className="mono-label">
                    ERRORS <span className="text-white">{counts.error}</span>
                  </span>
                </>
              )}
              <span className="mono-label text-warn">PROTOTYPE · NOT FOR NAVIGATION</span>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- */}
        {/* Environment · ice intelligence · route                      */}
        {/* ---------------------------------------------------------- */}
        <SectionHeader
          eyebrow="ENVIRONMENT · ICE INTELLIGENCE · ROUTE"
          title="The four intelligence groups AURORA reports on"
          description="Each card carries the status the backend assigned to that component, in the backend's own vocabulary, plus the values it returned for this frame."
        />

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
          {/* Route */}
          <IntelligenceCard
            icon={RouteIcon}
            title="Route"
            status={models.route?.status}
            loading={anyLoading}
            error={status.error}
            lines={[
              ['Algorithm', models.route?.detail ?? '—'],
              [
                'Baseline waypoints',
                verified.loading ? '…' : verified.data?.waypoints ?? '—',
              ],
              [
                'Baseline length',
                verified.data?.route_length_grid_units != null
                  ? `${verified.data.route_length_grid_units.toFixed(1)} grid units`
                  : '—',
              ],
              [
                'Cost terms in force',
                models.route?.active_weights
                  ? Object.entries(models.route.active_weights)
                      .filter(([k, v]) => k !== 'vessel_draft_m' && Number(v) > 0)
                      .map(([k]) => k)
                      .join(', ') || 'none'
                  : '—',
                models.route?.active_weights ? 'text-ice' : '',
              ],
            ]}
            action={
              <Link
                to="/routes"
                className="inline-flex items-center gap-1.5 border border-graphite-500 bg-graphite-750 px-2.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-graphite-700"
              >
                <Navigation size={13} className="text-ice" /> Plan a route
              </Link>
            }
          />

          {/* SIC */}
          <IntelligenceCard
            icon={Waves}
            title="Sea-ice concentration"
            status={models.sic?.status}
            loading={anyLoading}
            error={status.error}
            lines={[
              ['Serving mode', models.sic?.detail ?? '—'],
              ['Frame date', sic.date ?? '—'],
              [
                'Mean SIC (frame)',
                sic.active?.stats?.mean != null
                  ? `${(sic.active.stats.mean * 100).toFixed(1)}%`
                  : '—',
              ],
              [
                'Max SIC (frame)',
                sic.active?.stats?.max != null
                  ? `${(sic.active.stats.max * 100).toFixed(1)}%`
                  : '—',
              ],
            ]}
            action={
              <Link
                to="/sea-ice"
                className="inline-flex items-center gap-1.5 border border-graphite-500 bg-graphite-750 px-2.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-graphite-700"
              >
                <Waves size={13} className="text-ice" /> View forecast
              </Link>
            }
          />

          {/* Iceberg */}
          <IntelligenceCard
            icon={Snowflake}
            title="Iceberg detection"
            status={models.iceberg?.status}
            loading={anyLoading}
            error={status.error}
            lines={[
              ['Detector', iceberg.data?.model ?? '—'],
              [
                'Georeferencing',
                iceberg.data?.georeferencing?.status ?? '—',
                'text-warn',
              ],
              [
                'Risk to route',
                iceberg.data?.route_consumes_iceberg_risk ? 'consumed' : 'not consumed',
                iceberg.data?.route_consumes_iceberg_risk ? 'text-safe' : 'text-warn',
              ],
              ['Coordinate space', iceberg.data?.coordinate_space ?? '—'],
            ]}
            action={
              <Link
                to="/icebergs"
                className="inline-flex items-center gap-1.5 border border-graphite-500 bg-graphite-750 px-2.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-graphite-700"
              >
                <Snowflake size={13} className="text-ice" /> Analyze icebergs
              </Link>
            }
          />

          {/* Environment */}
          <IntelligenceCard
            icon={Wind}
            title="Environment"
            status={
              env.wind?.available || env.current?.available || env.water?.available
                ? 'READY'
                : 'DATA UNAVAILABLE'
            }
            loading={anyLoading}
            error={status.error}
            lines={[
              ['Wind', env.wind?.status ?? '—', env.wind?.available ? 'text-safe' : 'text-warn'],
              [
                'Ocean current',
                env.current?.status ?? '—',
                env.current?.available ? 'text-safe' : 'text-warn',
              ],
              ['Sea ice', env.sic?.status ?? '—', env.sic?.available ? 'text-safe' : 'text-warn'],
              [
                'Water / bathymetry',
                env.water?.status ?? '—',
                env.water?.available ? 'text-safe' : 'text-warn',
              ],
            ]}
            action={
              <Link
                to="/environment"
                className="inline-flex items-center gap-1.5 border border-graphite-500 bg-graphite-750 px-2.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-graphite-700"
              >
                <Layers size={13} className="text-ice" /> View environment
              </Link>
            }
          />
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Parallel intelligence streams                               */}
        {/* ---------------------------------------------------------- */}
        <SectionHeader
          eyebrow="INTELLIGENCE ARCHITECTURE"
          title="Parallel streams, not a pipeline"
          description="Sea-ice and iceberg detection are independent modules: neither feeds the other. They become operational context for the optimiser, which consumes only the layers the backend reports as available."
        />

        <div className="border border-graphite-600 bg-graphite-850 p-4 md:p-5">
          <div className="grid gap-3 lg:grid-cols-[1.1fr_auto_1fr_1fr] lg:items-stretch">
            <StreamNode
              icon={Wind}
              title="Environmental Intelligence"
              body="Wind, current, sea ice and bathymetry, each probed for what is really reachable."
              endpoint="GET /api/aurora/status"
              tone="warn"
            />
            <div className="hidden items-center justify-center lg:flex" aria-hidden="true">
              <ArrowRight size={18} className="text-steel" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <StreamNode
                icon={Waves}
                title="Sea-Ice / SIC"
                body="Concentration, forecast and uncertainty — a standalone module."
                endpoint="GET /api/sic/*"
              />
              <StreamNode
                icon={Snowflake}
                title="Iceberg Detection"
                body="SAR YOLOv8 detections in pixel space — a standalone module."
                endpoint="GET /api/icebergs/*"
              />
            </div>
          </div>

          <div className="my-2 flex items-center justify-center gap-2" aria-hidden="true">
            <ArrowDown size={16} className="text-steel" />
            <span className="mono-label">OPERATIONAL CONTEXT</span>
            <ArrowDown size={16} className="text-steel" />
          </div>

          <div className="mx-auto max-w-2xl">
            <StreamNode
              icon={RouteIcon}
              title="Route Optimization"
              body={
                models.route?.active_weights
                  ? `Consumes only the layers with a non-zero weight: ${Object.entries(
                      models.route.active_weights
                    )
                      .filter(([k, v]) => k !== 'vessel_draft_m' && Number(v) > 0)
                      .map(([k]) => k)
                      .join(', ') || 'none'}.`
                  : 'Consumes only the layers the backend reports with a non-zero weight.'
              }
              endpoint="POST /api/route/optimize · POST /api/route/reroute"
            />
          </div>
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Map + quick actions                                         */}
        {/* ---------------------------------------------------------- */}
        <div className="grid gap-4 xl:grid-cols-12">
          <div className="xl:col-span-8">
            <Card className="overflow-hidden">
              <Card.Header
                title="Southern Ocean theatre"
                subtitle={
                  sicRaster
                    ? `Real SIC raster · ${sic.date} · ${sic.active?.legend?.units ?? ''}`
                    : 'SIC raster not loaded'
                }
                icon={Compass}
                action={
                  <div className="flex items-center gap-2">
                    <select
                      className="select w-auto font-mono text-[11px]"
                      value={timestep}
                      onChange={(e) => setTimestep(Number(e.target.value))}
                      disabled={!dates.length}
                      aria-label="Forecast date"
                    >
                      {!dates.length && <option value={0}>loading…</option>}
                      {dates.map((d, i) => (
                        <option key={d} value={i}>
                          D+{i} · {d}
                        </option>
                      ))}
                    </select>
                    <Badge value={sic.loading ? 'LOADING' : sicRaster ? 'REAL' : 'UNAVAILABLE'} />
                  </div>
                }
              />
              <div className="p-3">
                <AntarcticMap
                  height={460}
                  meta={meta.data}
                  coastline={coastline}
                  showBaseTiles
                  showCoastline
                  showGraticule
                  showStations
                  sicRaster={sicRaster}
                  routeLine={routeLine}
                  routeLabel="Committed baseline route (artifact)"
                  endpoints={endpoints}
                  className="border border-graphite-600"
                />
              </div>
              <div className="border-t border-graphite-600 px-4 py-3">
                {sicRaster ? (
                  <SicLegend legend={sic.active?.legend} stats={sic.active?.stats} />
                ) : (
                  <p className="text-[11px] leading-relaxed text-warn">
                    {sic.error
                      ? `SIC unavailable: ${sic.error.message}`
                      : 'Loading the real concentration field — no placeholder is drawn meanwhile.'}
                  </p>
                )}
              </div>
            </Card>
          </div>

          <div className="space-y-4 xl:col-span-4">
            <Card>
              <Card.Header title="Quick actions" icon={Activity} />
              <Card.Body className="space-y-2.5">
                <QuickAction to="/routes" icon={RouteIcon} title="Plan New Route" hint="Origin, destination and cost weights" />
                <QuickAction to="/ship-details" icon={Ship} title="Ship Details" hint="Vessel context, AIS integration status" />
                <QuickAction to="/sea-ice" icon={Waves} title="View SIC Forecast" hint="Day slider, maps and horizon metrics" />
                <QuickAction to="/icebergs" icon={Snowflake} title="Analyze Icebergs" hint="Run the SAR YOLOv8 detector on a tile" />
                <QuickAction to="/environment" icon={Wind} title="View Environment" hint="Wind, current, sea ice and bathymetry" />
              </Card.Body>
            </Card>

            <Card>
              <Card.Header
                title="Baseline route"
                subtitle="GET /api/route"
                icon={Gauge}
                action={
                  verified.data ? (
                    <Badge value={verified.data.success ? 'RESOLVED' : 'FAILED'} />
                  ) : null
                }
              />
              <Card.Body>
                {verified.loading && <LoadingState label="Reading route artifact" />}
                {verified.error && (
                  <ErrorState title="Baseline route unavailable" message={verified.error.message} />
                )}
                {verified.data && (
                  <dl className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-[11.5px] text-mist">Leg</dt>
                      <dd className="num truncate text-right text-[12px] text-white/90">
                        {verified.data.leg?.name ?? '—'}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-[11.5px] text-mist">Waypoints</dt>
                      <dd className="num text-right text-[12px] text-white/90">
                        {verified.data.waypoints}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-[11.5px] text-mist">Total cost</dt>
                      <dd className="num text-right text-[12px] text-white/90">
                        {verified.data.total_cost?.toFixed?.(3) ?? '—'}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-[11.5px] text-mist">Source</dt>
                      <dd className="truncate text-right font-mono text-[11px] text-steel" title={verified.data.source}>
                        {verified.data.source}
                      </dd>
                    </div>
                  </dl>
                )}
                {!verified.loading && !verified.error && !verified.data && (
                  <p className="text-[12px] leading-relaxed text-mist">
                    No baseline route is published by this deployment.
                  </p>
                )}
              </Card.Body>
            </Card>

            <Card>
              <Card.Header
                title="Dynamic rerouting"
                subtitle="GET /api/route → dynamic_rerouting"
                icon={RefreshCw}
                action={
                  verified.data?.dynamic_rerouting ? (
                    <Badge
                      value={
                        verified.data.dynamic_rerouting.reroute_replan_success
                          ? 'REPLAN OK'
                          : 'FAILED'
                      }
                    />
                  ) : null
                }
              />
              <Card.Body>
                {verified.loading && <LoadingState label="Reading re-plan report" compact />}
                {verified.error && (
                  <ErrorState
                    title="Re-plan status unavailable"
                    message={verified.error.message}
                    compact
                  />
                )}
                {verified.data?.dynamic_rerouting ? (
                  <dl className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-[11.5px] text-mist">Forecast step</dt>
                      <dd className="num text-right text-[12px] text-white/90">
                        D+{verified.data.dynamic_rerouting.reroute_forecast_step}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-[11.5px] text-mist">Jaccard overlap</dt>
                      <dd className="num text-right text-[12px] text-white/90">
                        {verified.data.dynamic_rerouting.divergence?.jaccard_overlap?.toFixed(3) ??
                          '—'}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-[11.5px] text-mist">Waypoints</dt>
                      <dd className="num text-right text-[12px] text-white/90">
                        {verified.data.dynamic_rerouting.waypoints_before} →{' '}
                        {verified.data.dynamic_rerouting.waypoints_after}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-[11.5px] text-mist">Decision source</dt>
                      <dd className="truncate text-right font-mono text-[11px] text-steel">
                        {verified.data.dynamic_rerouting.decision_source}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  !verified.loading &&
                  !verified.error && (
                    <p className="text-[12px] leading-relaxed text-mist">
                      No re-plan report is published with the baseline route.
                    </p>
                  )
                )}
                <p className="mt-2.5 border-t border-graphite-700 pt-2 text-[11px] leading-relaxed text-steel">
                  Re-planning runs on the server against a later forecast timestep
                  (<span className="font-mono">POST /api/route/reroute</span>). This deployment
                  reports its committed re-plan artifact as synthetic, so it is shown as a report —
                  not as live tracking.
                </p>
                <Link
                  to="/routes"
                  className="mt-2 inline-flex items-center gap-1.5 border border-graphite-500 bg-graphite-750 px-2.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-graphite-700"
                >
                  <RefreshCw size={13} className="text-ice" /> Run a re-plan
                </Link>
              </Card.Body>
            </Card>

            <Card>
              <Card.Header
                title="Ship / vessel status"
                subtitle="GET /api/layers/status → datasets.ais"
                icon={Ship}
                action={<Badge value={layers.data?.datasets?.ais?.configured ? 'CONFIGURED' : 'NOT CONNECTED'} />}
              />
              <Card.Body>
                {layers.loading && <LoadingState label="Reading vessel dataset status" compact />}
                {layers.error && (
                  <ErrorState title="Layer status unavailable" message={layers.error.message} compact />
                )}
                {layers.data && (
                  <dl className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-[11.5px] text-mist">AIS dataset</dt>
                      <dd className="num text-right text-[12px] text-warn">
                        {layers.data.datasets?.ais?.configured ? 'configured' : 'not configured'}
                      </dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-[11.5px] text-mist">Vessel position</dt>
                      <dd className="num text-right text-[12px] text-warn">Data unavailable</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-[11.5px] text-mist">Registry / IMO</dt>
                      <dd className="num text-right text-[12px] text-warn">Data unavailable</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <dt className="text-[11.5px] text-mist">Vessel draft (cost map)</dt>
                      <dd className="num text-right text-[12px] text-white/90">
                        {layers.data.cost_weights?.vessel_draft_m != null
                          ? `${layers.data.cost_weights.vessel_draft_m} m`
                          : '—'}
                      </dd>
                    </div>
                  </dl>
                )}
                <Link
                  to="/ship-details"
                  className="mt-2.5 inline-flex items-center gap-1.5 border border-graphite-500 bg-graphite-750 px-2.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-graphite-700"
                >
                  <Ship size={13} className="text-ice" /> Open Ship Details
                </Link>
              </Card.Body>
            </Card>

            <div className="flex items-start gap-2.5 border border-graphite-600 bg-graphite-850 px-3.5 py-3">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
              <p className="text-[11px] leading-relaxed text-mist">
                Wind, ocean current and bathymetry are reported as{' '}
                <span className="font-semibold text-warn">DATA UNAVAILABLE</span> in this deployment
                because no dataset root is configured. Their cost weights are therefore 0 and they
                are not used in any route shown here.
              </p>
            </div>
          </div>
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Risk                                                        */}
        {/* ---------------------------------------------------------- */}
        <SectionHeader
          eyebrow="RISK"
          title="Forecast uncertainty — the factors this build can actually measure"
          description="GET /api/uncertainty/summary · spread of the committed 2026 forecast, in SIC fraction. AURORA does not compute a composite risk score: the backend publishes none, so none is shown."
          action={
            <Link
              to="/risk"
              className="inline-flex items-center gap-1.5 border border-graphite-500 bg-graphite-750 px-3 py-1.5 text-[12px] font-medium text-white transition hover:bg-graphite-700"
            >
              <ShieldAlert size={13} className="text-ice" /> Full risk analysis
            </Link>
          }
        />

        {uncertainty.loading ? (
          <div className="border border-graphite-600 bg-graphite-850 p-5">
            <LoadingState label="Reading uncertainty summary" />
          </div>
        ) : uncertainty.error ? (
          <ErrorState
            title="Uncertainty summary unavailable"
            message={uncertainty.error?.message ?? String(uncertainty.error)}
          />
        ) : uncertainty.data?.available ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Full-field mean σ"
                value={uncertainty.data.full_mean_std?.toFixed(4)}
                note="mean forecast spread over the whole grid"
              />
              <MetricCard
                label="MIZ mean σ"
                value={uncertainty.data.miz_mean_std?.toFixed(4)}
                note="marginal ice zone · where routing decisions matter"
              />
              <MetricCard
                label="MIZ median σ"
                value={uncertainty.data.miz_median_std?.toFixed(4)}
                note={uncertainty.data.units ?? undefined}
              />
              <MetricCard
                label="MIZ p10 – p90 σ"
                value={
                  uncertainty.data.miz_p10_std != null && uncertainty.data.miz_p90_std != null
                    ? `${uncertainty.data.miz_p10_std.toFixed(4)} – ${uncertainty.data.miz_p90_std.toFixed(4)}`
                    : null
                }
                note="spread across the marginal ice zone"
              />
            </div>

            <Notice tone="warn" icon={ShieldAlert} title="No composite risk score is produced">
              This deployment has no endpoint that combines forecast spread, ice concentration,
              iceberg presence and environmental layers into a single risk number, so none is
              displayed. What you see above are the individual, measurable factors the backend does
              publish — each one shown with its own units and its own source artifact{' '}
              <span className="font-mono text-white">{uncertainty.data.source}</span>.
            </Notice>
          </>
        ) : (
          <div className="border border-graphite-600 bg-graphite-850 px-4 py-3">
            <p className="text-[12.5px] leading-relaxed text-warn">
              Uncertainty summary unavailable in this deployment.
            </p>
          </div>
        )}

        {/* ---------------------------------------------------------- */}
        {/* Model status table                                          */}
        {/* ---------------------------------------------------------- */}
        <SectionHeader
          eyebrow="MODELS"
          title="Models and data status"
          description="GET /api/aurora/status — seven components, reported exactly as the backend words them."
        />
        <Card>
          <Card.Header
            title="Component status"
            subtitle="GET /api/aurora/status — seven components, reported exactly as the backend words them"
            icon={CheckCircle2}
            action={
              status.data ? (
                <Badge value={status.data.status} />
              ) : (
                <Badge value={status.error ? 'ERROR' : '…'} />
              )
            }
          />
          <Card.Body className="scrollbar-thin overflow-x-auto">
            {status.loading && <LoadingState label="Reading component status" />}
            {status.error && <ErrorState title="Status unavailable" message={status.error} />}
            {status.data && (
              <table className="w-full min-w-[680px] border-collapse">
                <thead>
                  <tr className="border-b border-graphite-600">
                    <th className="th">Component</th>
                    <th className="th">Status</th>
                    <th className="th">Reported detail</th>
                  </tr>
                </thead>
                <tbody>
                  {status.data.rows.map((row) => {
                    const Icon =
                      row.status === 'READY'
                        ? CheckCircle2
                        : row.status === 'ERROR' || row.status === 'MODEL UNAVAILABLE'
                          ? AlertTriangle
                          : CircleSlash
                    return (
                      <tr key={row.label} className="border-b border-graphite-700 last:border-0">
                        <td className="td text-[13px] font-medium text-white">{row.label}</td>
                        <td className="td">
                          <span
                            className={`inline-flex items-center gap-1.5 text-[11.5px] font-semibold ${tone(row.status)}`}
                          >
                            <Icon size={13} /> {row.status}
                          </span>
                        </td>
                        <td className="td text-[11.5px] text-mist">{row.detail}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
            {status.data && (
              <p className="mt-3 border-t border-graphite-700 pt-2.5 text-[11px] leading-relaxed text-steel">
                Vocabulary in use: {status.data.vocabulary.join(' · ')}.{' '}
                <span className="font-mono">{status.data.generated_at}</span>
              </p>
            )}
          </Card.Body>
        </Card>

        <div className="flex items-center gap-2 pb-2 font-mono text-[11px] text-steel">
          <Clock size={12} />
          {refreshedAt ? `last refreshed ${refreshedAt} UTC` : 'not yet refreshed'}
          {health.data && (
            <span className="text-safe">
              · /api/health {health.data.status} (SIC artifact{' '}
              {health.data.sic_artifact ? 'present' : 'missing'})
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

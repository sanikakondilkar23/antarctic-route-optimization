import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Droplets,
  Layers,
  RefreshCw,
  Waves,
  Wind,
} from 'lucide-react'
import PageHeader, { MetaItem } from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import StatCard from '../components/ui/StatCard'
import { ErrorState, LoadingState, Unavailable } from '../components/ui/Status'
import { ChartCard, ChartTooltip } from '../components/charts'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  fetchAuroraStatus,
  fetchCurrent,
  fetchLayersStatus,
  fetchLimitations,
  fetchMetadata,
  fetchUncertaintySummary,
  sicPredict,
} from '../lib/auroraApi'

const STATUS_TEXT = {
  READY: 'text-safe',
  'INTEGRATION READY': 'text-ice',
  'DATA UNAVAILABLE': 'text-warn',
  'GEOREFERENCING UNAVAILABLE': 'text-warn',
  'MODEL UNAVAILABLE': 'text-danger',
  ERROR: 'text-danger',
}

const statusCls = (s) => STATUS_TEXT[s] ?? 'text-mist'

/** One environmental layer, exactly as the backend words its availability. */
function LayerCard({ icon: Icon, title, state, weight, inCost }) {
  if (!state) {
    return (
      <Card>
        <Card.Header title={title} icon={Icon} />
        <Card.Body>
          <LoadingState label="Reading layer status" />
        </Card.Body>
      </Card>
    )
  }

  const unavailable = !state.available

  return (
    <Card>
      <Card.Header
        title={title}
        icon={Icon}
        action={<Badge value={state.status ?? '—'} />}
      />
      <Card.Body className="space-y-2.5">
        <p className={`font-mono text-[11px] uppercase tracking-wider ${statusCls(state.status)}`}>
          {state.status}
        </p>

        {unavailable ? (
          <Unavailable
            label="Data unavailable"
            reason={state.detail ?? 'No dataset was reachable for this layer.'}
          />
        ) : (
          <p className="text-[12px] leading-relaxed text-mist">{state.detail ?? 'Available.'}</p>
        )}

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-graphite-700 pt-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-[11px] text-mist">Cost weight</dt>
            <dd className={`num text-[12px] ${Number(weight) > 0 ? 'text-safe' : 'text-steel'}`}>
              {weight ?? '—'}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-[11px] text-mist">In cost</dt>
            <dd
              className={`num text-[12px] ${inCost ? 'text-safe' : 'text-warn'}`}
            >
              {inCost ? 'yes' : 'no'}
            </dd>
          </div>
        </dl>

        {inCost && (
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-safe">
            <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
            Actively used for route optimisation in this deployment.
          </p>
        )}
        {!inCost && unavailable && (
          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-warn">
            <CircleSlash size={13} className="mt-0.5 shrink-0" />
            Not used for routes — the data is absent, so its weight stays at zero.
          </p>
        )}
      </Card.Body>
    </Card>
  )
}

export default function Environment() {
  const [aurora, setAurora] = useState({ data: null, error: null, loading: true })
  const [layers, setLayers] = useState({ data: null, error: null, loading: true })
  const [current, setCurrent] = useState({ data: null, error: null, loading: true })
  const [lims, setLims] = useState({ data: null, error: null, loading: true })
  const [unc, setUnc] = useState({ data: null, error: null, loading: true })
  const [meta, setMeta] = useState({ data: null, error: null, loading: true })
  const [timeline, setTimeline] = useState({ rows: [], error: null, loading: true })
  const [busy, setBusy] = useState(false)

  const load = async (withBusy = false) => {
    if (withBusy) setBusy(true)

    const [a, l, c, li, u, m] = await Promise.allSettled([
      fetchAuroraStatus(),
      fetchLayersStatus(0),
      fetchCurrent(0),
      fetchLimitations(),
      fetchUncertaintySummary(),
      fetchMetadata(),
    ])
    const put = (r, set, notFoundAsNull = false) => {
      if (r.status === 'fulfilled') set({ data: r.value, error: null, loading: false })
      else if (notFoundAsNull && r.reason?.status === 404) set({ data: null, error: null, loading: false })
      else set((p) => ({ ...p, error: r.reason?.message ?? String(r.reason), loading: false }))
    }
    put(a, setAurora)
    put(l, setLayers)
    put(c, setCurrent, true)
    put(li, setLims)
    put(u, setUnc)
    put(m, setMeta)

    // Environmental timeline: real per-day statistics from the forecast artifact.
    try {
      const dates = m.status === 'fulfilled' ? (m.value?.dates ?? []) : []
      if (!dates.length) throw new Error('forecast window unknown')
      const idx = [0, 30, 60, 90, 120, 166].filter((i) => i < dates.length)
      const results = await Promise.all(
        idx.map((t) => sicPredict({ timestep: t, horizon: 0, format: 'stats' }))
      )
      setTimeline({
        rows: results.map((r) => ({
          date: r.date,
          timestep: r.timestep,
          sicMean: r.prediction?.stats?.mean ?? null,
          sicMax: r.prediction?.stats?.max ?? null,
          uncMean: r.uncertainty?.stats?.mean ?? null,
        })),
        error: null,
        loading: false,
      })
    } catch (err) {
      setTimeline((p) => ({ ...p, error: err?.message ?? String(err), loading: false }))
    }

    if (withBusy) setBusy(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const env = aurora.data?.data ?? {}
  const weights = layers.data?.cost_weights ?? {}
  const layerRows = layers.data?.layers ?? []
  const breakdown = layers.data?.cost_breakdown ?? null
  const limitations = lims.data ?? {}

  const coverage = useMemo(
    () =>
      layerRows
        .filter((l) => l.required_cells)
        .map((l) => ({
          name: l.name,
          pct: Math.round((l.covered_required_cells / l.required_cells) * 100),
          status: l.status,
        })),
    [layerRows]
  )

  const uncBars = useMemo(
    () =>
      unc.data?.available
        ? (unc.data.histogram_counts ?? []).map((c, i) => ({
            bin: Number(((unc.data.histogram_bins?.[i] ?? 0) * 100).toFixed(1)),
            count: c,
          }))
        : [],
    [unc.data]
  )

  const timelinePct = timeline.rows.map((r) => ({
    ...r,
    sicPct: r.sicMean != null ? Number((r.sicMean * 100).toFixed(2)) : null,
    uncPct: r.uncMean != null ? Number((r.uncMean * 100).toFixed(2)) : null,
  }))

  const anyLoading = aurora.loading || layers.loading || meta.loading

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-[1520px] space-y-5 p-4 md:p-6">
        <PageHeader
          title="Environmental Data"
          subtitle="Wind, ocean current, sea ice and bathymetry as this deployment can actually serve them. Every layer that is missing is shown as missing, with the backend's own reason, and is excluded from the routing cost."
          meta={
            <>
              <MetaItem label="LAYERS IN COST" value={(breakdown?.terms ?? []).join(', ') || 'none'} />
              <MetaItem label="SIC WEIGHT" value={weights.w_sic ?? '—'} />
              <MetaItem label="WIND WEIGHT" value={weights.w_wind ?? '—'} />
              <MetaItem label="CURRENT WEIGHT" value={weights.w_curr ?? '—'} />
              <MetaItem label="WINDOW" value={meta.data ? `${meta.data.n_timesteps} days` : '—'} />
            </>
          }
          actions={
            <Button onClick={() => load(true)} disabled={busy} variant="secondary">
              <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
              {busy ? 'Refreshing…' : 'Refresh'}
            </Button>
          }
        />

        {/* ---------------------------------------------------------- */}
        {/* The four environmental layers                              */}
        {/* ---------------------------------------------------------- */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <LayerCard
            icon={Wind}
            title="Wind"
            state={env.wind}
            weight={weights.w_wind}
            inCost={Boolean(env.wind?.in_cost)}
          />
          <LayerCard
            icon={Layers}
            title="Ocean current"
            state={env.current}
            weight={weights.w_curr}
            inCost={Boolean(env.current?.in_cost)}
          />
          <LayerCard
            icon={Waves}
            title="Sea ice"
            state={env.sic}
            weight={weights.w_sic}
            inCost={Boolean(env.sic?.in_cost)}
          />
          <LayerCard
            icon={Droplets}
            title="Water / bathymetry"
            state={env.water}
            weight={weights.w_depth}
            inCost={Boolean(env.water?.in_cost)}
          />
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Timeline + uncertainty                                      */}
        {/* ---------------------------------------------------------- */}
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard
            title="Environmental timeline — sea ice and forecast uncertainty"
            subtitle={
              timeline.error
                ? timeline.error
                : 'mean SIC and mean 1σ spread on six sampled forecast days, read from GET /api/sic/predict'
            }
            action={<Badge value={timeline.error ? 'UNAVAILABLE' : 'REAL OUTPUT'} />}
            height={240}
          >
            {timeline.loading ? (
              <LoadingState label="Sampling forecast days" />
            ) : timeline.error || !timelinePct.length ? (
              <p className="pt-8 text-center text-xs text-mist">
                DATA UNAVAILABLE — {timeline.error ?? 'no forecast days returned.'}
              </p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timelinePct} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(148,163,184,0.08)" strokeDasharray="4 4" />
                  <XAxis
                    dataKey="date"
                    stroke="rgba(148,163,184,0.4)"
                    tick={{ fill: '#7c8ea6', fontSize: 10 }}
                  />
                  <YAxis
                    stroke="rgba(148,163,184,0.4)"
                    tick={{ fill: '#7c8ea6', fontSize: 10 }}
                    unit="%"
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="sicPct"
                    name="mean SIC"
                    stroke="#7FB4D4"
                    fill="#7FB4D4"
                    fillOpacity={0.18}
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="uncPct"
                    name="mean uncertainty"
                    stroke="#C39A4A"
                    fill="#C39A4A"
                    fillOpacity={0.12}
                    strokeWidth={1.5}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard
            title="Forecast uncertainty distribution"
            subtitle={unc.data?.available ? `committed artifact · ${unc.data.source}` : 'uncertainty summary unavailable'}
            action={<Badge value={unc.data?.available ? 'REAL OUTPUT' : 'UNAVAILABLE'} />}
            height={240}
          >
            {unc.loading ? (
              <LoadingState label="Reading uncertainty summary" />
            ) : uncBars.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={uncBars} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(148,163,184,0.08)" strokeDasharray="4 4" />
                  <XAxis
                    dataKey="bin"
                    stroke="rgba(148,163,184,0.4)"
                    tick={{ fill: '#7c8ea6', fontSize: 10 }}
                    label={{
                      value: '1σ spread (SIC %)',
                      position: 'insideBottom',
                      offset: -2,
                      fill: '#7c8ea6',
                      fontSize: 10,
                    }}
                  />
                  <YAxis stroke="rgba(148,163,184,0.4)" tick={{ fill: '#7c8ea6', fontSize: 10 }} />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="count" name="cells" fill="#7FB4D4" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="pt-8 text-center text-xs text-mist">
                DATA UNAVAILABLE — no uncertainty histogram is served.
              </p>
            )}
          </ChartCard>
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Layer coverage                                              */}
        {/* ---------------------------------------------------------- */}
        <div className="grid gap-4 xl:grid-cols-2">
          <ChartCard
            title="Layer coverage on the routing grid"
            subtitle="share of required cells each layer actually covers"
            action={<Badge value={layers.error ? 'UNAVAILABLE' : 'LIVE'} />}
            height={220}
          >
            {layers.loading ? (
              <LoadingState label="Reading layer status" />
            ) : coverage.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={coverage} margin={{ top: 8, right: 8, left: -22, bottom: 4 }}>
                  <CartesianGrid stroke="rgba(148,163,184,0.08)" strokeDasharray="4 4" />
                  <XAxis
                    dataKey="name"
                    stroke="rgba(148,163,184,0.4)"
                    tick={{ fill: '#7c8ea6', fontSize: 9 }}
                  />
                  <YAxis
                    stroke="rgba(148,163,184,0.4)"
                    tick={{ fill: '#7c8ea6', fontSize: 10 }}
                    unit="%"
                    domain={[0, 100]}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="pct" name="coverage" fill="#7FB4D4" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="pt-8 text-center text-xs text-mist">
                DATA UNAVAILABLE — no layer reports a required-cell coverage.
              </p>
            )}
          </ChartCard>

          <Card>
            <Card.Header
              title="Documented limitations"
              subtitle="GET /api/limitations — the backend's own wording"
              icon={AlertTriangle}
              action={<Badge value={lims.error ? 'ERROR' : 'REAL'} />}
            />
            <Card.Body className="scrollbar-thin max-h-[240px] overflow-y-auto">
              {lims.loading && <LoadingState label="Reading limitations" />}
              {lims.error && <ErrorState title="Unavailable" message={lims.error.message} />}
              {!lims.loading && !lims.error && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {Object.entries(limitations).map(([k, text]) => (
                    <div key={k} className="border border-warn/20 bg-warn/5 px-3 py-2">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-warn">{k}</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-white/85">{text}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card.Body>
          </Card>
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Per-layer status table                                      */}
        {/* ---------------------------------------------------------- */}
        <Card>
          <Card.Header
            title="Cost layers in force"
            subtitle="GET /api/layers/status — which layers reach the A* cost map, and why the rest do not"
            icon={Layers}
            action={
              <div className="flex items-center gap-2">
                {layers.data && (
                  <>
                    <Badge value="REAL" />
                    <Badge value="PARTIAL" />
                    <Badge value="NOT_AVAILABLE" />
                  </>
                )}
              </div>
            }
          />
          <Card.Body className="scrollbar-thin overflow-x-auto">
            {layers.loading && <LoadingState label="Reading cost configuration" />}
            {layers.error && <ErrorState title="Layer status unavailable" message={layers.error.message} />}
            {!layers.loading && !layers.error && layerRows.length > 0 && (
              <table className="w-full min-w-[720px] border-collapse">
                <thead>
                  <tr className="border-b border-graphite-600">
                    <th className="th">Layer</th>
                    <th className="th">Status</th>
                    <th className="th">In cost</th>
                    <th className="th">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {layerRows.map((l) => (
                    <tr key={l.name} className="border-b border-graphite-700 last:border-0">
                      <td className="td num text-[12px] text-white">{l.name}</td>
                      <td className="td">
                        <span
                          className={`inline-flex items-center gap-1.5 text-[11.5px] font-semibold ${
                            l.status === 'REAL'
                              ? 'text-safe'
                              : l.status === 'PARTIAL'
                                ? 'text-warn'
                                : 'text-steel'
                          }`}
                        >
                          {l.status === 'REAL' ? (
                            <CheckCircle2 size={13} />
                          ) : (
                            <CircleSlash size={13} />
                          )}
                          {l.status}
                        </span>
                      </td>
                      <td className="td">
                        <span className={l.in_cost ? 'text-safe' : 'text-steel'}>
                          {String(l.in_cost)}
                        </span>
                      </td>
                      <td className="td text-[11.5px] text-mist">{l.reason ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {layers.data && (
              <div className="mt-3 grid gap-2 border-t border-graphite-700 pt-2.5 sm:grid-cols-2">
                <p className="text-[11px] leading-relaxed text-steel">
                  <span className="font-semibold text-white/80">NOT_AVAILABLE:</span>{' '}
                  {layers.data.status_semantics?.NOT_AVAILABLE}
                </p>
                <p className="text-[11px] leading-relaxed text-steel">
                  <span className="font-semibold text-white/80">PARTIAL:</span>{' '}
                  {layers.data.status_semantics?.PARTIAL}
                </p>
              </div>
            )}
          </Card.Body>
        </Card>

        {/* ---------------------------------------------------------- */}
        {/* Honest state of the environment feeds                       */}
        {/* ---------------------------------------------------------- */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <Card.Header title="Ocean current feed" icon={Layers} />
            <Card.Body className="space-y-2">
              {current.loading && <LoadingState label="Reading current status" />}
              {current.error && <ErrorState title="Unavailable" message={current.error.message} />}
              {current.data && (
                <>
                  <Badge value={current.data.available ? 'AVAILABLE' : 'UNAVAILABLE'} />
                  <p className="text-[12px] leading-relaxed text-mist">{current.data.note}</p>
                  <p className="mono-label break-all">{current.data.label}</p>
                </>
              )}
              {!current.loading && !current.error && !current.data && (
                <Unavailable
                  label="Data unavailable"
                  reason="GET /api/current/0 published no record for this deployment."
                />
              )}
            </Card.Body>
          </Card>

          <Card>
            <Card.Header title="Iceberg risk feed" icon={AlertTriangle} />
            <Card.Body className="space-y-2">
              <Badge value="GEOREFERENCING UNAVAILABLE" />
              <p className="text-[12px] leading-relaxed text-mist">
                The SAR detector runs, but its detections carry no coordinates, so no iceberg risk
                field is computed for the cost map and none is invented. The route therefore never
                consumes an iceberg term.
              </p>
              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-warn">
                <CircleSlash size={13} className="mt-0.5 shrink-0" />
                Detections are pixel-space only.
              </p>
            </Card.Body>
          </Card>

          <Card>
            <Card.Header title="Cost function in force" icon={CheckCircle2} />
            <Card.Body className="space-y-2">
              {breakdown ? (
                <>
                  <p className="mono-label">formula</p>
                  <pre className="scrollbar-thin overflow-x-auto whitespace-pre-wrap break-words border border-graphite-700 bg-graphite-950 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-ice-dim">
{breakdown.formula}
                  </pre>
                  <p className="text-[11px] leading-relaxed text-steel">
                    {env.sic?.note ?? ''}
                  </p>
                </>
              ) : layers.loading ? (
                <LoadingState label="Reading cost configuration" />
              ) : (
                <Unavailable label="Data unavailable" reason="No cost breakdown was returned." />
              )}
            </Card.Body>
          </Card>
        </div>

        {anyLoading && (
          <p className="pb-2 font-mono text-[11px] text-steel">reading environment…</p>
        )}
        {!anyLoading && Object.keys(limitations).length === 0 && !lims.loading && (
          <p className="pb-2 font-mono text-[11px] text-steel">no limitations published</p>
        )}
      </div>
    </div>
  )
}

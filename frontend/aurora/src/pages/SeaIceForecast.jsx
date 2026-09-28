import { useMemo } from 'react'
import {
  Waves,
  Percent,
  CalendarDays,
  Activity,
  AlertTriangle,
  RefreshCw,
  Gauge,
  Shield,
  Layers,
  ServerCrash,
} from 'lucide-react'
import PageHeader, { LiveChip } from '../components/ui/PageHeader'
import StatCard from '../components/ui/StatCard'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { LoadingState } from '../components/ui/Status'
import AntarcticMap from '../components/map/AntarcticMap'
import SicLegend from '../components/sic/SicLegend'
import SicModelStatus from '../components/sic/SicModelStatus'
import { ChartCard, ChartTooltip } from '../components/charts'
import useSicForecast, { HORIZONS, SIC_LAYERS, HORIZON_OBSERVED } from '../hooks/useSicForecast'
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts'
import { cn } from '../lib/utils'

const pct = (v, digits = 1) => (typeof v === 'number' ? `${(v * 100).toFixed(digits)}%` : '—')
const num = (v) => (typeof v === 'number' ? v.toLocaleString() : '—')

/** Confidence-class counts, used for the confidence KPI. */
function confidencePct(stats) {
  if (!stats?.counts) return null
  const high = stats.counts.high ?? 0
  const medium = stats.counts.medium ?? 0
  const low = stats.counts.low ?? 0
  const total = high + medium + low
  if (!total) return null
  return {
    highPct: (high / total) * 100,
    mediumPct: (medium / total) * 100,
    lowPct: (low / total) * 100,
    total,
  }
}

export default function SeaIceForecast() {
  const sic = useSicForecast()
  const {
    status,
    error,
    forecast,
    timeseries,
    horizon,
    setHorizon,
    layer,
    setLayer,
    active,
    notice,
    date,
    setDate,
    dates,
    refresh,
    generatedAt,
    checkpointSummary,
  } = sic

  const loading = status === 'loading'
  const horizonMeta = HORIZONS.find((h) => h.id === horizon)
  const confidenceKey = horizon === HORIZON_OBSERVED ? null : String(horizon)
  const confidenceEntry = confidenceKey ? forecast?.confidence?.[confidenceKey] : null
  const confidenceStats = confidenceEntry?.available ? confidenceEntry.stats : null
  const confPct = confidencePct(confidenceStats)

  // Uncertainty for the selected horizon; the reference view has none, so it
  // falls back to the day-1 spread and says so.
  const uncertaintyEntry =
    horizon === HORIZON_OBSERVED ? forecast?.uncertainty?.['1'] : forecast?.uncertainty?.[String(horizon)]
  const uncertaintyIsFallback = horizon === HORIZON_OBSERVED

  const series = useMemo(() => {
    const rows = timeseries?.series ?? []
    return rows.map((r) => ({
      t: r.date?.slice(5) ?? '',
      forecast: typeof r.forecast === 'number' ? r.forecast * 100 : null,
      observed: typeof r.observed === 'number' ? r.observed * 100 : null,
      uncertainty: typeof r.uncertainty === 'number' ? r.uncertainty * 100 : null,
      iceExtent: typeof r.ice_extent_km2 === 'number' ? r.ice_extent_km2 : null,
      observedIceExtent: typeof r.observed_ice_extent_km2 === 'number' ? r.observed_ice_extent_km2 : null,
    }))
  }, [timeseries])

  const stats = active?.stats ?? null
  const extentStat = stats?.ice_extent_km2

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sea-Ice Concentration & Outlook"
        subtitle={`ConvLSTM ensemble forecast over the ${forecast?.grid?.lat_range?.join('° … ')}° lat, ${forecast?.grid?.lon_range?.join('° … ')}° lon region.`}
        actions={
          <div className="flex items-center gap-2">
            {forecast ? (
              <LiveChip
                label={forecast.source === 'live-inference' ? 'Live inference' : 'Model inference output'}
                dot="safe"
              />
            ) : (
              <LiveChip label={loading ? 'Loading model' : 'API offline'} dot={loading ? 'warn' : 'danger'} />
            )}
            <Button variant="secondary" onClick={refresh} disabled={loading} className="!px-4">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              {loading ? 'Loading forecast…' : 'Refresh forecast'}
            </Button>
          </div>
        }
      />

      {status === 'error' && (
        <div className="rounded-2xl border border-danger/40 bg-danger/10 px-5 py-4 text-danger text-sm">
          <div className="flex items-start gap-3">
            <ServerCrash size={18} className="mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="font-semibold">SIC API unavailable — no forecast shown</p>
              <p className="text-xs leading-relaxed text-danger/90">
                {error?.message ?? 'Unknown error.'}
              </p>
              <p className="text-xs text-danger/80">
                Start the service from <span className="font-mono">Sea-Ice-Concentration/backend</span> with{' '}
                <span className="font-mono">uvicorn app.main:app --port 8000</span>, then reload.
                The map below is falling back to the illustrative patch layer — it is not model output.
              </p>
            </div>
          </div>
        </div>
      )}

      {notice && (
        <div className="rounded-2xl border border-warn/30 bg-warn/10 px-5 py-3 text-warn text-sm flex items-start gap-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            <p className="font-semibold">
              {notice.requested} is not available for {horizonMeta?.label}
            </p>
            <p className="text-xs leading-relaxed text-warn/90">{notice.reason}</p>
            <p className="text-xs text-warn/80">
              Showing the real <span className="font-semibold">{notice.showing}</span> field for this
              horizon instead. No value is substituted.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {/* Horizon switcher, field layer switcher, date scrubber */}
        <div className="grid gap-3 lg:grid-cols-[auto_1fr]">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-mist font-semibold mr-1 flex items-center gap-1.5">
                <CalendarDays size={13} className="text-cyan" /> Forecast Horizon:
              </span>
              {HORIZONS.map((h) => {
                const disabled = forecast && !sic.availableHorizons.includes(h.id)
                return (
                  <button
                    key={h.id}
                    onClick={() => setHorizon(h.id)}
                    disabled={disabled}
                    title={disabled ? 'The API serves no data for this horizon' : h.label}
                    className={cn(
                      'rounded-xl border px-3.5 py-2 text-xs font-semibold transition',
                      horizon === h.id
                        ? 'border-cyan/60 bg-cyan/15 text-cyan shadow-glow ring-1 ring-cyan/30'
                        : 'border-white/10 bg-white/5 text-mist hover:text-white',
                      disabled && 'cursor-not-allowed opacity-40 hover:text-mist',
                    )}
                  >
                    {h.short}
                  </button>
                )
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-mist font-semibold mr-1 flex items-center gap-1.5">
                <Layers size={13} className="text-cyan" /> Map Layer:
              </span>
              {SIC_LAYERS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLayer(l.id)}
                  title={l.hint}
                  className={cn(
                    'rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition',
                    layer === l.id
                      ? 'border-ice-cyan/50 bg-ice-cyan/15 text-ice-cyan'
                      : 'border-white/10 bg-white/5 text-mist hover:text-white',
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>

          <Card className="flex flex-wrap items-center justify-end gap-3 py-2 px-4">
            {forecast && (
              <label className="flex items-center gap-2 text-xs text-mist">
                <span className="font-semibold">Target date</span>
                <select
                  value={date ?? ''}
                  onChange={(e) => setDate(e.target.value)}
                  className="rounded-lg border border-white/10 bg-navy-deep px-2 py-1 font-mono text-[11px] text-white/90"
                >
                  {dates.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <SicLegend legend={active?.legend} stats={stats} />
          </Card>
        </div>

        {/* KPI cards — all values come from the API response */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Observed Concentration"
            value={forecast?.observed?.available ? pct(forecast.observed.stats?.mean) : '—'}
            subtitle="NSIDC CDR v6, mean over valid cells"
            icon={Percent}
            tone="cyan"
            note={forecast?.observed?.available ? 'Real observation' : 'Unavailable'}
          />
          <StatCard
            label={`Forecast — ${horizonMeta?.label ?? ''}`}
            value={
              horizon === HORIZON_OBSERVED
                ? pct(forecast?.observed?.stats?.mean)
                : pct(forecast?.forecast?.[String(horizon)]?.mean?.stats?.mean)
            }
            subtitle={
              horizon === HORIZON_OBSERVED
                ? 'Reference day, not a prediction'
                : 'ConvLSTM 3-seed ensemble mean'
            }
            icon={Gauge}
            tone="ocean"
            note={
              horizon === HORIZON_OBSERVED
                ? 'Observed'
                : forecast?.forecast?.[String(horizon)]?.mean?.available
                  ? 'Real model output'
                  : 'Unavailable'
            }
          />
          <StatCard
            label="Modelled Ice Extent"
            value={extentStat ? `${(extentStat / 1e6).toFixed(2)}M km²` : '—'}
            subtitle="Area with SIC > 15% inside the model ROI"
            icon={CalendarDays}
            tone="safe"
            note={extentStat ? 'Computed from grid' : 'Unavailable'}
          />
          <StatCard
            label="Prediction Confidence"
            value={confPct ? `${confPct.highPct.toFixed(1)}%` : '—'}
            subtitle={
              confPct
                ? `High-confidence cells · ${num(confPct.total)} classified`
                : 'Confidence class map is served for the forecast horizons only'
            }
            icon={Activity}
            tone={!confPct ? 'muted' : confPct.highPct > 90 ? 'safe' : confPct.highPct > 75 ? 'warn' : 'danger'}
            note={confPct ? 'Real class map' : 'n/a'}
          />
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
        <Card className="overflow-hidden">
          <Card.Header
            title="Spatial Concentration Field"
            subtitle={`${SIC_LAYERS.find((l) => l.id === (active?.field === 'forecast_mean' ? 'sic' : active?.field))?.label ?? 'SIC'} · ${
              horizonMeta?.label ?? ''
            } · ${date ?? '—'}`}
            icon={Waves}
            action={<Badge value={horizonMeta?.label ?? ''} />}
          />
          <div className="p-3">
            {loading && !forecast ? (
              <LoadingState label="Loading ConvLSTM forecast" className="!h-[500px]" />
            ) : (
              <AntarcticMap
                center={[-63, 40]}
                zoom={3}
                height={500}
                layers={{ vessels: true, icebergs: true, stations: true, routes: true, seaIce: true, wind: false, oceanCurrents: false, trajectories: false }}
                activeRoute="opt-lowice"
                sicRaster={
                  active?.available
                    ? { url: active.url, bounds: active.bounds, label: horizonMeta?.label }
                    : null
                }
                sicRasterOpacity={layer === 'uncertainty' ? 0.75 : 0.9}
                className="!rounded-xl"
              />
            )}
          </div>
          <div className="border-t border-white/5 px-5 py-3 space-y-1.5">
            <p className="flex items-start gap-2 text-[11px] text-mist leading-relaxed">
              <AlertTriangle size={13} className="shrink-0 mt-0.5 text-warn" />
              {active?.available ? (
                <>
                  Raster is rasterised on the server from the {checkpointSummary?.architecture} ensemble output
                  at {forecast?.grid?.height}×{forecast?.grid?.width} / {forecast?.grid?.resolution_deg}° and
                  placed by Leaflet over its true bounds. Cells outside the model valid mask are transparent.
                  {uncertaintyIsFallback && uncertaintyEntry?.available && (
                    <> Uncertainty shown is the day-1 spread, since the observed reference has none.</>
                  )}
                </>
              ) : (
                <>
                  No real raster is available for this selection
                  {active?.reason ? `: ${active.reason}` : '.'} The map is showing the
                  illustrative patch layer, which is not model output.
                </>
              )}
            </p>
            {generatedAt && (
              <p className="text-[10px] font-mono text-mist/70">
                forecast generated {generatedAt} · source {forecast?.source}
              </p>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <Card.Body>
              <SicModelStatus forecast={forecast} checkpointSummary={checkpointSummary} />
            </Card.Body>
          </Card>

          {/* Icebreaker Escort Advisory — editorial guidance, not model output */}
          <Card>
            <Card.Header title="Icebreaker Escort Advisory" subtitle="Polar operational guidelines" icon={Shield} />
            <Card.Body className="space-y-2.5 text-xs text-mist">
              <div className="rounded-xl border border-white/5 bg-navy-deep/50 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-white">Bharati Approach (Prydz Bay)</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-danger/15 text-danger">Escort Advised</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Concentration exceeding 75% with embedded pressure ridges. Ice class PC-5 or escorted convoy required poleward of 68°S.
                </p>
              </div>

              <div className="rounded-xl border border-white/5 bg-navy-deep/50 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-white">Maitri Approach (Princess Astrid)</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-warn/15 text-warn">Cautionary</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  Fast-ice belt stable; coastal leads open for standard polar research vessels during calm synoptic windows.
                </p>
              </div>

              <p className="text-[10px] leading-relaxed text-mist/70">
                Advisory thresholds are static operational guidance and are not derived from the
                forecast field shown above.
              </p>
            </Card.Body>
          </Card>
        </div>
      </div>

      {/* Charts — every point is computed by the backend from real arrays */}
      <div className="grid gap-4 xl:grid-cols-3">
        <ChartCard
          title="Model vs Observation (2026 test window)"
          subtitle={`Day-1 ensemble mean vs NSIDC observed SIC · ${series.length} days`}
          action={<Badge value="Real output" />}
        >
          {series.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="rgba(148,163,184,0.08)" strokeDasharray="4 4" />
                <XAxis dataKey="t" stroke="rgba(148,163,184,0.4)" tick={{ fill: '#7c8ea6', fontSize: 11 }} minTickGap={28} />
                <YAxis stroke="rgba(148,163,184,0.4)" tick={{ fill: '#7c8ea6', fontSize: 11 }} unit="%" />
                <Tooltip content={<ChartTooltip unit="%" />} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                <Line type="monotone" dataKey="observed" name="Observed" stroke="#22D3EE" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                <Line type="monotone" dataKey="forecast" name="ConvLSTM forecast" stroke="#38BDF8" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <LoadingState label="Loading series" className="!py-8" />
          )}
        </ChartCard>

        <ChartCard
          title="Forecast Uncertainty (1σ)"
          subtitle="Ensemble + MC-dropout spread, day-1"
          action={<Badge value="Real output" />}
        >
          {series.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="rgba(148,163,184,0.08)" strokeDasharray="4 4" />
                <XAxis dataKey="t" stroke="rgba(148,163,184,0.4)" tick={{ fill: '#7c8ea6', fontSize: 11 }} minTickGap={28} />
                <YAxis stroke="rgba(148,163,184,0.4)" tick={{ fill: '#7c8ea6', fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="uncertainty" name="1σ spread" stroke="#F59E0B" strokeWidth={2} fill="#F59E0B22" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <LoadingState label="Loading series" className="!py-8" />
          )}
        </ChartCard>

        <ChartCard
          title="Modelled Ice Extent"
          subtitle="Area with SIC > 15% inside the model ROI"
          action={<Badge value="Real output" />}
        >
          {series.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 8, right: 8, left: -4, bottom: 0 }}>
                <CartesianGrid stroke="rgba(148,163,184,0.08)" strokeDasharray="4 4" />
                <XAxis dataKey="t" stroke="rgba(148,163,184,0.4)" tick={{ fill: '#7c8ea6', fontSize: 11 }} minTickGap={28} />
                <YAxis stroke="rgba(148,163,184,0.4)" tick={{ fill: '#7c8ea6', fontSize: 10 }} tickFormatter={(v) => `${(v / 1e6).toFixed(1)}M`} />
                <Tooltip content={<ChartTooltip unit=" km²" />} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                <Area type="monotone" dataKey="observedIceExtent" name="Observed" stroke="#22D3EE" strokeWidth={2} fill="#22D3EE18" dot={false} />
                <Area type="monotone" dataKey="iceExtent" name="Forecast" stroke="#00F2C3" strokeWidth={2.5} fill="#00F2C318" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <LoadingState label="Loading series" className="!py-8" />
          )}
        </ChartCard>
      </div>
    </div>
  )
}

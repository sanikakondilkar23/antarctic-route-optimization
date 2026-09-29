/**
 * RiskUncertainty.jsx - what "risk" actually means in this deployment.
 *
 * Three honest sources only:
 *   1. GET /api/uncertainty/summary   the committed 1σ distribution
 *   2. GET /api/uncertainty/<t>       the spatial spread for a lead time
 *   3. GET /api/layers/status         which layers reach the routing cost at all
 *
 * CVaR, wind, current, depth and iceberg-standoff risk are reported as
 * unavailable because the API reports them as unavailable.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Layers,
  ShieldAlert,
  Waves,
  XCircle,
} from 'lucide-react'
import PageHeader, { LiveChip } from '../components/ui/PageHeader'
import StatCard from '../components/ui/StatCard'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import AntarcticMap from '../components/map/AntarcticMap'
import SicLegend from '../components/sic/SicLegend'
import useSicForecast, { UNCERTAINTY_HORIZONS } from '../hooks/useSicForecast'
import { ChartCard, ChartTooltip } from '../components/charts'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts'
import { fetchLayersStatus, fetchLimitations, fetchSystemStatus, fetchUncertaintySummary } from '../lib/auroraApi'
import { cn } from '../lib/utils'

const num = (v, d = 4) => (typeof v === 'number' ? v.toFixed(d) : '—')
const n = (v) => (typeof v === 'number' ? v.toLocaleString() : '—')

const STATUS_TONE = {
  REAL: 'text-safe',
  PARTIAL: 'text-warn',
  NOT_AVAILABLE: 'text-mist',
}

function LayerRow({ layer, semantics }) {
  const coverage =
    layer.n_cells && layer.required_cells
      ? `${n(layer.covered_required_cells)}/${n(layer.required_cells)} required cells covered`
      : null
  return (
    <div className="rounded-xl border border-white/5 bg-navy-deep/45 px-3.5 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-white/90">{layer.name}</span>
        <span className="flex items-center gap-2">
          <span className={cn('font-mono text-[10px] font-bold', STATUS_TONE[layer.status] ?? 'text-mist')}>
            {layer.status}
          </span>
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 font-mono text-[10px]',
              layer.in_cost ? 'border-ice/30 bg-ice/10 text-ice' : 'border-white/10 bg-white/5 text-mist',
            )}
          >
            {layer.in_cost ? 'in cost' : 'not in cost'}
          </span>
        </span>
      </div>
      {coverage && <p className="mt-1 font-mono text-[10px] text-mist">{coverage}</p>}
      {layer.reason && <p className="mt-1 text-[11px] leading-relaxed text-mist">{layer.reason}</p>}
      {semantics && layer.status && (
        <p className="mt-1 text-[10px] leading-relaxed text-mist/70">{semantics[layer.status]}</p>
      )}
    </div>
  )
}

export default function RiskUncertainty() {
  const sic = useSicForecast()
  const [summary, setSummary] = useState(null)
  const [layers, setLayers] = useState(null)
  const [system, setSystem] = useState(null)
  const [limitations, setLimitations] = useState(null)
  const [layerError, setLayerError] = useState(null)

  useEffect(() => {
    sic.setLayer('uncertainty')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    fetchUncertaintySummary().then(setSummary).catch(() => setSummary(null))
    fetchSystemStatus().then(setSystem).catch(() => setSystem(null))
    fetchLimitations().then(setLimitations).catch(() => setLimitations(null))
  }, [])

  useEffect(() => {
    fetchLayersStatus(sic.timestep)
      .then((b) => {
        setLayers(b)
        setLayerError(null)
      })
      .catch((err) => {
        setLayers(null)
        setLayerError(err?.message ?? 'layer status unavailable')
      })
  }, [sic.timestep])

  const histData = useMemo(() => {
    if (!summary?.available) return []
    return (summary.histogram_counts ?? []).map((c, i) => ({
      bin: Number((((summary.histogram_bins?.[i] ?? 0) * 100).toFixed(2))),
      count: c,
    }))
  }, [summary])

  const sicRaster = sic.active?.available
    ? { url: sic.active.url, bounds: sic.active.bounds, label: `uncertainty ${sic.date}` }
    : null

  const cvar = system?.environment?.cvar
  const stats = sic.active?.stats ?? null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Risk & uncertainty"
        subtitle="Forecast spread, per-layer availability and the exact terms that reach (or do not reach) the routing cost."
        actions={
          <LiveChip
            label={summary?.available ? 'committed uncertainty artifact' : 'uncertainty unavailable'}
            dot={summary?.available ? 'safe' : 'danger'}
          />
        }
      />

      {/* KPIs from the committed summary */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="MIZ mean 1σ"
          value={num(summary?.miz_mean_std)}
          subtitle="marginal ice zone spread (SIC fraction)"
          icon={ShieldAlert}
          tone="ocean"
          note={summary?.available ? 'REAL ARTIFACT' : 'UNAVAILABLE'}
        />
        <StatCard
          label="MIZ p90 1σ"
          value={num(summary?.miz_p90_std)}
          subtitle={`p10 ${num(summary?.miz_p10_std)} · median ${num(summary?.miz_median_std)}`}
          icon={AlertTriangle}
          tone="warn"
          note={summary?.available ? 'REAL ARTIFACT' : 'UNAVAILABLE'}
        />
        <StatCard
          label="Full-domain mean 1σ"
          value={num(summary?.full_mean_std)}
          subtitle="mean spread over every modelled cell"
          icon={Layers}
          tone="cyan"
          note={summary?.available ? 'REAL ARTIFACT' : 'UNAVAILABLE'}
        />
        <StatCard
          label="CVaR"
          value={cvar?.computed ? 'computed' : '—'}
          subtitle={cvar?.label ?? 'CVaR status unknown'}
          icon={ShieldAlert}
          tone="warn"
          note={cvar?.computed ? 'COMPUTED' : 'NOT COMPUTED'}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <ChartCard
          title="Uncertainty distribution"
          subtitle={summary?.available ? `${summary.source} · ${summary.histogram_counts?.length ?? 0} bins` : 'DATA UNAVAILABLE'}
          action={<Badge value={summary?.available ? 'Real output' : 'Unavailable'} />}
          height={260}
        >
          {histData.length ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={histData} margin={{ top: 8, right: 8, left: -14, bottom: 4 }}>
                <CartesianGrid stroke="rgba(148,163,184,0.08)" strokeDasharray="4 4" />
                <XAxis
                  dataKey="bin"
                  stroke="rgba(148,163,184,0.4)"
                  tick={{ fill: '#7c8ea6', fontSize: 10 }}
                  label={{ value: '1σ (SIC %)', position: 'insideBottom', offset: -2, fill: '#7c8ea6', fontSize: 10 }}
                />
                <YAxis stroke="rgba(148,163,184,0.4)" tick={{ fill: '#7c8ea6', fontSize: 10 }} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" name="cells" fill="#7DD3FC" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="pt-10 text-center text-xs text-mist">
              DATA UNAVAILABLE — the API serves no histogram for this deployment.
            </p>
          )}
        </ChartCard>

        <Card className="overflow-hidden">
          <Card.Header
            title="Spatial spread"
            subtitle={sic.active?.available ? `${sic.date} · lead time frame` : 'no frame'}
            icon={Waves}
            action={
              <div className="flex flex-wrap gap-1.5">
                {UNCERTAINTY_HORIZONS.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => sic.setHorizon(h.id)}
                    className={cn(
                      'rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition',
                      sic.horizon === h.id
                        ? 'border-ice/50 bg-ice/10 text-ice'
                        : 'border-white/10 bg-white/5 text-mist hover:text-white',
                    )}
                  >
                    {h.short}
                  </button>
                ))}
              </div>
            }
          />
          <div className="p-3">
            <AntarcticMap
              center={[-63, 40]}
              zoom={3}
              height={360}
              sicRaster={sicRaster}
              sicRasterOpacity={0.75}
              showSeaIce={Boolean(sicRaster)}
              className="!rounded-xl"
            />
          </div>
          <div className="border-t border-white/5 px-5 py-3">
            {sicRaster ? (
              <SicLegend legend={sic.active.legend} stats={stats} kind="uncertainty" />
            ) : (
              <p className="text-[11px] text-warn">
                Uncertainty frame unavailable{sic.unavailableReason ? `: ${sic.unavailableReason}` : '.'}
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* Risk inputs that reach the cost */}
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <Card>
          <Card.Header
            title="Risk inputs per layer"
            subtitle={
              layers
                ? `GET /api/layers/status?timestep=${layers.timestep} · ${layers.date}`
                : 'waiting for the API'
            }
            icon={Layers}
            action={layers ? <Badge value={`${layers.real?.length ?? 0} real`} /> : null}
          />
          <Card.Body className="space-y-2">
            {layerError && (
              <div className="rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-xs text-danger">
                {layerError}
              </div>
            )}
            {!layers && !layerError && <p className="text-xs text-mist">Loading layer status…</p>}
            {layers?.layers?.map((l) => (
              <LayerRow key={l.name} layer={l} semantics={layers.status_semantics} />
            ))}
            {layers && (
              <div className="rounded-xl border border-white/10 bg-navy-deep/40 px-3.5 py-2.5">
                <p className="font-mono text-[10px] uppercase tracking-wider text-mist">cost formula</p>
                <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-white/85">
                  {layers.cost_breakdown?.formula}
                </p>
                <p className="mt-1.5 font-mono text-[11px] text-ice">
                  terms active: {(layers.cost_breakdown?.terms ?? []).join(', ') || 'none'}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-mist">
                  {layers.cost_breakdown?.omitted_cells
                    ? `${n(
                        Object.values(layers.cost_breakdown.omitted_cells).reduce((a, b) => a + b, 0),
                      )} cells omitted from SIC cost (non-navigable).`
                    : 'No cells omitted.'}
                </p>
              </div>
            )}
          </Card.Body>
        </Card>

        <div className="space-y-4">
          <Card>
            <Card.Header title="Cost weights (active)" subtitle="server configuration" icon={Database} />
            <Card.Body className="space-y-1.5">
              {layers
                ? Object.entries(layers.cost_weights ?? {}).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between border-b border-white/5 pb-1 font-mono text-[11px] last:border-0">
                      <span className={Number(v) > 0 ? 'text-white/90' : 'text-mist/60'}>{k}</span>
                      <span className={Number(v) > 0 ? 'text-ice' : 'text-mist/60'}>{v}</span>
                    </div>
                  ))
                : <p className="text-xs text-mist">Loading…</p>}
            </Card.Body>
          </Card>

          <Card>
            <Card.Header
              title="Risk terms NOT computed"
              subtitle="reported by the API itself"
              icon={AlertTriangle}
            />
            <Card.Body className="space-y-2">
              {[
                ['Ocean currents', system?.environment?.cmems?.label, system?.environment?.cmems?.note],
                ['Iceberg standoff', system?.environment?.iceberg?.label, system?.environment?.iceberg?.note],
                ['CVaR', cvar?.label, cvar?.note],
                ['Wind', 'NOT AVAILABLE', limitations?.wind],
                ['Depth penalty', 'NOT AVAILABLE', limitations?.depth],
              ].map(([k, label, note]) => (
                <div key={k} className="rounded-xl border border-white/5 bg-navy-deep/45 px-3.5 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white/90">{k}</span>
                    <span className="inline-flex items-center gap-1 font-mono text-[10px] text-warn">
                      <XCircle size={12} /> UNAVAILABLE
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-mist">{label}</p>
                  {note && <p className="mt-1 text-[11px] leading-relaxed text-mist/80">{note}</p>}
                </div>
              ))}
            </Card.Body>
          </Card>
        </div>
      </div>

      <Card>
        <Card.Header
          title="What IS available"
          subtitle="the layers that carry real data in this deployment"
          icon={CheckCircle2}
        />
        <Card.Body className="grid gap-2.5 sm:grid-cols-2">
          {[
            ['Sea-ice concentration', limitations?.sic],
            ['Forecast uncertainty', limitations?.uncertainty],
            ['Land mask', limitations?.land_mask],
            ['Ice-class multiplier', limitations?.ice_multiplier],
            ['Routing algorithm', limitations?.route],
          ].map(([k, text]) => (
            <div key={k} className="rounded-xl border border-safe/20 bg-safe/5 px-3.5 py-2.5">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-safe">
                <CheckCircle2 size={13} /> {k}
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-white/85">{text}</p>
            </div>
          ))}
        </Card.Body>
      </Card>
    </div>
  )
}

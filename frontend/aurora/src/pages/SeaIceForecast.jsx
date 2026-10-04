/**
 * SeaIceForecast.jsx - real sea-ice concentration forecast explorer.
 *
 * The field, its statistics, its validity mask and the uncertainty spread all
 * come from GET /api/sic/<t>, GET /api/uncertainty/<t> and
 * GET /api/uncertainty/summary. What this deployment does not serve (observed
 * SIC comparison, per-day time series, confidence-class maps) is stated as
 * unavailable rather than replaced with an illustration.
 */

import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  CalendarDays,
  Layers,
  Percent,
  RefreshCw,
  ServerCrash,
  Snowflake,
  Waves,
} from 'lucide-react'
import PageHeader, { LiveChip } from '../components/ui/PageHeader'
import StatCard from '../components/ui/StatCard'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import AntarcticMap from '../components/map/AntarcticMap'
import SicLegend from '../components/sic/SicLegend'
import SicModelStatus from '../components/sic/SicModelStatus'
import useSicForecast, { SIC_LAYERS, UNCERTAINTY_HORIZONS } from '../hooks/useSicForecast'
import { fetchLimitations, fetchUncertaintySummary } from '../lib/auroraApi'
import { cn } from '../lib/utils'

const pct = (v) => (typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '—')
const num = (v, d = 3) => (typeof v === 'number' ? v.toFixed(d) : '—')
const n = (v) => (typeof v === 'number' ? v.toLocaleString() : '—')

export default function SeaIceForecast() {
  const sic = useSicForecast()
  const [summary, setSummary] = useState(null)
  const [limitations, setLimitations] = useState(null)

  useEffect(() => {
    fetchUncertaintySummary()
      .then(setSummary)
      .catch(() => setSummary(null))
    fetchLimitations()
      .then(setLimitations)
      .catch(() => setLimitations(null))
  }, [])

  const stats = sic.active?.stats ?? null
  const sicRaster = sic.active?.available
    ? { url: sic.active.url, bounds: sic.active.bounds, label: `SIC ${sic.date}` }
    : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sea-ice concentration forecast"
        subtitle={
          sic.metadata
            ? `Committed 2026 forecast field · ${sic.metadata.n_rows} × ${sic.metadata.n_cols} grid @ ${sic.metadata.resolution_deg}° · ${sic.metadata.lat_range[0]}° to ${sic.metadata.lat_range[1]}° lat, ${sic.metadata.lon_range[0]}° to ${sic.metadata.lon_range[1]}° lon`
            : 'Reading grid metadata from the AURORA API…'
        }
        actions={
          <div className="flex items-center gap-2">
            {sic.active?.available ? (
              <LiveChip label={`frame ${sic.date}`} dot="safe" />
            ) : (
              <LiveChip label={sic.status === 'loading' ? 'Loading frame' : 'SIC unavailable'} dot={sic.status === 'loading' ? 'warn' : 'danger'} />
            )}
            <Button variant="secondary" onClick={sic.refresh} disabled={sic.status === 'loading'} className="!px-4">
              <RefreshCw size={15} className={sic.status === 'loading' ? 'animate-spin' : ''} />
              Reload frame
            </Button>
          </div>
        }
      />

      {sic.status === 'error' && (
        <div className="flex items-start gap-3 rounded-2xl border border-danger/40 bg-danger/10 px-5 py-4 text-danger">
          <ServerCrash size={18} className="mt-0.5 shrink-0" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold">SIC API unavailable — no field shown</p>
            <p className="text-xs leading-relaxed text-danger/90">{sic.error?.message}</p>
            <p className="text-xs text-danger/80">
              Start the backend with <span className="font-mono">python backend/api/main.py</span>,
              then reload. No placeholder field is drawn in the meantime.
            </p>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-white/10 bg-abyssal-card/70 p-4">
        <label className="block min-w-[240px]">
          <span className="input-label inline-flex items-center gap-1.5">
            <CalendarDays size={13} className="text-ice" /> Forecast day
          </span>
          <select
            className="input font-mono"
            value={sic.timestep}
            onChange={(e) => sic.setTimestep(Number(e.target.value))}
            disabled={!sic.nTimesteps}
          >
            {sic.nTimesteps === 0 && <option value={0}>loading calendar…</option>}
            {sic.dates.map((d, i) => (
              <option key={d} value={i}>
                D+{i} · {d}
              </option>
            ))}
          </select>
        </label>

        <div>
          <span className="input-label inline-flex items-center gap-1.5">
            <Layers size={13} className="text-ice" /> Layer
          </span>
          <div className="flex flex-wrap gap-2">
            {SIC_LAYERS.map((l) => (
              <button
                key={l.id}
                onClick={() => sic.setLayer(l.id)}
                title={l.hint}
                className={cn(
                  'rounded-xl border px-3.5 py-2 text-xs font-semibold transition',
                  sic.layer === l.id
                    ? 'border-ice/60 bg-ice/10 text-ice ring-1 ring-ice/30'
                    : 'border-white/10 bg-white/5 text-mist hover:text-white',
                )}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        {sic.layer === 'uncertainty' && (
          <div>
            <span className="input-label">Uncertainty horizon</span>
            <div className="flex flex-wrap gap-2">
              {UNCERTAINTY_HORIZONS.map((h) => (
                <button
                  key={h.id}
                  onClick={() => sic.setHorizon(h.id)}
                  className={cn(
                    'rounded-xl border px-3.5 py-2 text-xs font-semibold transition',
                    sic.horizon === h.id
                      ? 'border-ice/60 bg-ice/10 text-ice ring-1 ring-ice/30'
                      : 'border-white/10 bg-white/5 text-mist hover:text-white',
                  )}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="ml-auto w-full max-w-sm lg:w-auto">
          <SicLegend legend={sic.active?.legend} stats={stats} kind={sic.layer} />
        </div>
      </div>

      {/* KPIs - frame statistics straight from the API */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={sic.layer === 'sic' ? 'Mean concentration' : 'Mean spread (1σ)'}
          value={pct(stats?.mean)}
          subtitle={sic.date ? `valid cells on ${sic.date}` : 'no frame'}
          icon={Percent}
          tone="cyan"
          note={sic.active?.available ? 'REAL FRAME' : 'UNAVAILABLE'}
        />
        <StatCard
          label={sic.layer === 'sic' ? 'Peak concentration' : 'Peak spread'}
          value={pct(stats?.max)}
          subtitle={sic.layer === 'sic' ? `minimum on frame ${pct(stats?.min)}` : `p90 ${pct(stats?.p90)}`}
          icon={Waves}
          tone="ocean"
          note={sic.active?.available ? 'REAL FRAME' : 'UNAVAILABLE'}
        />
        <StatCard
          label="Navigable cells"
          value={n(stats?.n_navigable ?? stats?.n_within_model_domain)}
          subtitle={
            stats?.n_non_navigable != null
              ? `${n(stats.n_non_navigable)} non-navigable (NaN = never routed, never open water)`
              : stats?.n_outside_model_domain != null
                ? `${n(stats.n_outside_model_domain)} cells outside the model domain`
                : 'validity mask from the API'
          }
          icon={Layers}
          tone="safe"
          note="VALIDITY MASK"
        />
        <StatCard
          label="Confidence class map"
          value="—"
          subtitle="confidence_class_2026.npy is not served by this API, so no confidence figure is shown"
          icon={AlertTriangle}
          tone="warn"
          note="NOT SERVED"
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden">
          <Card.Header
            title={sic.layer === 'sic' ? 'Concentration field' : 'Forecast uncertainty field'}
            subtitle={
              sic.active?.available
                ? `${sic.date} · ${SIC_LAYERS.find((l) => l.id === sic.layer)?.label}${
                    sic.layer === 'uncertainty' ? ` · ${(UNCERTAINTY_HORIZONS.find((h) => h.id === sic.horizon) ?? {}).label}` : ''
                  }`
                : 'no frame available'
            }
            icon={Waves}
            action={<Badge value={sic.active?.available ? 'Real output' : 'Unavailable'} />}
          />
          <div className="p-3">
            <AntarcticMap
              center={[-63, 40]}
              zoom={3}
              height={520}
              sicRaster={sicRaster}
              sicRasterOpacity={sic.layer === 'uncertainty' ? 0.75 : 0.88}
              showSeaIce={Boolean(sicRaster)}
              className="!rounded-xl"
            />
          </div>
          <div className="border-t border-white/5 px-5 py-3 text-[11px] leading-relaxed text-mist">
            {sic.active?.available ? (
              <p>
                Raster is generated from the API's uint8 encoding with the validity bitmask as the
                alpha channel: cells marked invalid are fully transparent and are never rendered as
                open water. Bounds come from the grid metadata, so placement is the server's own.
              </p>
            ) : (
              <p className="text-warn">
                No raster for this selection{sic.unavailableReason ? `: ${sic.unavailableReason}` : '.'}{' '}
                The basemap is shown alone — nothing is substituted.
              </p>
            )}
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <Card.Body>
              <SicModelStatus ensemble={sic.ensemble} metadata={sic.metadata} />
            </Card.Body>
          </Card>

          <Card>
            <Card.Header
              title="Uncertainty summary"
              subtitle={summary?.available ? summary.source : 'GET /api/uncertainty/summary'}
              icon={Snowflake}
              action={<Badge value={summary?.available ? 'Real output' : 'Unavailable'} />}
            />
            <Card.Body className="space-y-2">
              {summary?.available ? (
                <>
                  {[
                    ['MIZ mean 1σ', summary.miz_mean_std],
                    ['MIZ median 1σ', summary.miz_median_std],
                    ['MIZ p10 / p90 1σ', `${num(summary.miz_p10_std)} / ${num(summary.miz_p90_std)}`],
                    ['Full-domain mean 1σ', summary.full_mean_std],
                  ].map(([k, val]) => (
                    <div key={k} className="flex items-center justify-between border-b border-white/5 pb-1.5 text-xs last:border-0">
                      <span className="text-mist">{k}</span>
                      <span className="font-mono text-white/90">{typeof val === 'number' ? num(val, 4) : val}</span>
                    </div>
                  ))}
                  <p className="pt-1 text-[11px] leading-relaxed text-mist">{summary.units}</p>
                </>
              ) : (
                <p className="text-xs text-mist">DATA UNAVAILABLE — no uncertainty summary is served.</p>
              )}
            </Card.Body>
          </Card>
        </div>
      </div>

      <Card>
        <Card.Header
          title="Not served by this API"
          subtitle="stated explicitly rather than filled with an illustration"
          icon={AlertTriangle}
        />
        <Card.Body className="grid gap-2.5 sm:grid-cols-2">
          {[
            ['Observed / analysed SIC comparison', 'There is no observation endpoint in this deployment, so model-vs-observation charts are not drawn.'],
            ['Per-day SIC time series', 'Only one timestep per request is served; a 167-day series would mean downloading every frame, so no chart is shown.'],
            ['Ice extent (SIC > 15%)', 'Not computed by the API — no extent figure is displayed.'],
            ['Confidence classes', 'The confidence-class artifact is not exposed by any endpoint.'],
          ].map(([k, why]) => (
            <div key={k} className="rounded-xl border border-white/10 bg-navy-deep/45 px-3.5 py-2.5">
              <p className="text-xs font-semibold text-white/90">{k}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-mist">{why}</p>
            </div>
          ))}
        </Card.Body>
      </Card>

      {limitations && (
        <Card>
          <Card.Header title="Documented limitations" subtitle="GET /api/limitations" icon={AlertTriangle} />
          <Card.Body className="grid gap-2.5 sm:grid-cols-2">
            {Object.entries(limitations).map(([k, text]) => (
              <div key={k} className="rounded-xl border border-warn/20 bg-warn/5 px-3.5 py-2.5">
                <p className="font-mono text-[10px] uppercase tracking-wider text-warn">{k}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-white/85">{text}</p>
              </div>
            ))}
          </Card.Body>
        </Card>
      )}
    </div>
  )
}

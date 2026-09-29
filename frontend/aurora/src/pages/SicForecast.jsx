import { useEffect, useMemo, useState } from 'react'
import { Waves } from 'lucide-react'
import AntarcticMap from '../components/map/AntarcticMap'
import { CoordReadout, FloatPanel, LayerRow, SicLegend, UncertaintyLegend } from '../components/map/MapUi'
import RouteSicProfile from '../components/sic/RouteSicProfile'
import Badge from '../components/ui/Badge'
import { ErrorState, LoadingState } from '../components/ui/Status'
import { fetchEnsemble, fetchRouteProfile, fetchSicStatus, fetchUncertaintySummary } from '../lib/auroraApi'
import { useCoastline, useMetadata, useSicRaster, useUncertaintyRaster } from '../lib/hooks'

const HORIZONS = [
  { value: 0, label: 'D+1 (horizon 0)' },
  { value: 1, label: 'D+2 (horizon 1)' },
  { value: 2, label: 'D+3 (horizon 2)' },
]

function Row({ k, v, tone = '' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-graphite-700 py-[5px] last:border-0">
      <dt className="text-[11.5px] text-mist">{k}</dt>
      <dd className={`num text-right text-[12px] ${tone || 'text-white/90'}`}>{v ?? '—'}</dd>
    </div>
  )
}

function Histogram({ bins, counts }) {
  const max = Math.max(...counts, 1)
  return (
    <div className="flex h-16 items-end gap-[2px]">
      {counts.map((c, i) => (
        <div
          key={i}
          className="flex-1 bg-ice-dim/70"
          style={{ height: `${Math.max(2, (c / max) * 100)}%` }}
          title={`${bins[i]?.toFixed?.(3) ?? bins[i]} – ${bins[i + 1]?.toFixed?.(3) ?? bins[i + 1]}: ${c}`}
        />
      ))}
    </div>
  )
}

export default function SicForecast() {
  const meta = useMetadata()
  const coastline = useCoastline()

  const [timestep, setTimestep] = useState(0)
  const [horizon, setHorizon] = useState(0)
  const [show, setShow] = useState({ base: true, coast: true, sic: true, unc: true, graticule: true, route: true })
  const [cursor, setCursor] = useState(null)

  const sic = useSicRaster(timestep, meta.data, { enabled: show.sic })
  const unc = useUncertaintyRaster(timestep, horizon, meta.data, { enabled: show.unc })

  const [summary, setSummary] = useState({ data: null, error: null })
  const [ensemble, setEnsemble] = useState({ data: null, error: null })
  const [sicStatus, setSicStatus] = useState({ data: null, error: null })
  useEffect(() => {
    let cancelled = false
    fetchUncertaintySummary()
      .then((d) => !cancelled && setSummary({ data: d, error: null }))
      .catch((e) => !cancelled && setSummary({ data: null, error: e }))
    fetchEnsemble()
      .then((d) => !cancelled && setEnsemble({ data: d, error: null }))
      .catch((e) => !cancelled && setEnsemble({ data: null, error: e }))
    fetchSicStatus()
      .then((d) => !cancelled && setSicStatus({ data: d, error: null }))
      .catch((e) => !cancelled && setSicStatus({ data: null, error: e }))
    return () => {
      cancelled = true
    }
  }, [])

  const dates = meta.data?.dates ?? []

  /* ------------------------------------- baseline route SIC profile */
  // GET /api/route/profile/<timestep> with no start/goal runs the backend's
  // own A* over the same field, so what is drawn here is the route the
  // optimizer actually produces for the committed baseline leg.
  const [profile, setProfile] = useState({ data: null, error: null, loading: true })
  useEffect(() => {
    let cancelled = false
    setProfile((p) => ({ ...p, loading: true }))
    fetchRouteProfile(timestep)
      .then((d) => !cancelled && setProfile({ data: d, error: null, loading: false }))
      .catch((e) => !cancelled && setProfile({ data: null, error: e, loading: false }))
    return () => {
      cancelled = true
    }
  }, [timestep])

  const routeLine = useMemo(
    () =>
      profile.data?.samples?.length
        ? profile.data.samples.map((s) => [Number(s.lat), Number(s.lon)])
        : null,
    [profile.data]
  )

  const routeEndpoints = useMemo(() => {
    const s = profile.data?.samples
    if (!s?.length) return []
    return [
      { lat: Number(s[0].lat), lon: Number(s[0].lon), kind: 'origin' },
      { lat: Number(s[s.length - 1].lat), lon: Number(s[s.length - 1].lon), kind: 'destination' },
    ]
  }, [profile.data])

  const bands = useMemo(() => {
    const m = meta.data
    if (!m) return null
    return {
      modelRows: m.model_band_rows,
      modelCols: m.model_band_cols,
      extRows: m.extension_band_rows,
      extCols: m.lon_extension_cols,
    }
  }, [meta.data])

  return (
    <div className="flex h-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <aside className="scrollbar-thin order-2 w-full shrink-0 space-y-2 border-t border-graphite-600 bg-graphite-900 p-2 lg:order-1 lg:w-[404px] lg:overflow-y-auto lg:border-r lg:border-t-0">
        {/* ---------------------------------------------- controls */}
        <FloatPanel title="Forecast controls" bodyClass="px-3 py-3 space-y-3">
          <label className="block">
            <span className="input-label">Forecast horizon (validity date)</span>
            <select
              className="select font-mono text-[12.5px]"
              value={timestep}
              onChange={(e) => setTimestep(Number(e.target.value))}
              disabled={!dates.length}
            >
              {!dates.length && <option value={0}>loading…</option>}
              {dates.map((d, i) => (
                <option key={d} value={i}>
                  D+{i} · {d}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[10.5px] leading-snug text-steel">
              167 daily frames from the committed forecast artifact
              {meta.data ? ` (${meta.data.date_range?.[0]} → ${meta.data.date_range?.[1]})` : ''}.
            </span>
          </label>

          <label className="block">
            <span className="input-label">Uncertainty lead time</span>
            <select
              className="select text-[13px]"
              value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))}
              disabled={!show.unc}
            >
              {HORIZONS.map((h) => (
                <option key={h.value} value={h.value}>
                  {h.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block text-[10.5px] leading-snug text-steel">
              The only horizon selector the API exposes (<span className="font-mono">horizon=0|1|2</span>).
              SIC frames themselves are day-1 only.
            </span>
          </label>

          <div className="border-t border-graphite-700 pt-2.5">
            <p className="input-label">Chart layers</p>
            <LayerRow checked={show.base} onChange={(v) => setShow((s) => ({ ...s, base: v }))} label="Base map" />
            <LayerRow checked={show.coast} onChange={(v) => setShow((s) => ({ ...s, coast: v }))} label="Coastline" />
            <LayerRow checked={show.graticule} onChange={(v) => setShow((s) => ({ ...s, graticule: v }))} label="Graticule 10°" />
            <LayerRow checked={show.sic} onChange={(v) => setShow((s) => ({ ...s, sic: v }))} label="Sea-ice concentration" status="REAL" />
            <LayerRow
              checked={show.route}
              onChange={(v) => setShow((s) => ({ ...s, route: v }))}
              label="Baseline route + SIC profile"
              status={profile.error ? 'UNAVAILABLE' : 'REAL'}
              disabled={!!profile.error}
            />
            <LayerRow checked={show.unc} onChange={(v) => setShow((s) => ({ ...s, unc: v }))} label="Forecast uncertainty" status="PARTIAL" />
          </div>
        </FloatPanel>

        {/* ---------------------------------------------- SIC frame */}
        <FloatPanel title="SIC frame" action={<Waves size={13} className="text-steel" />} bodyClass="px-3 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge value="REAL" />
            <span className="num text-[12.5px] text-white">{sic.date ?? '—'}</span>
            <span className="mono-label">timestep {timestep}</span>
          </div>
          {sic.error && <ErrorState title="Frame unavailable" message={sic.error.message} />}
          {sic.loading && <LoadingState label="Decoding frame" />}
          {sic.stats && (
            <dl>
              <Row k="min" v={sic.stats.min?.toFixed(4)} />
              <Row k="mean" v={sic.stats.mean?.toFixed(4)} />
              <Row k="max" v={sic.stats.max?.toFixed(4)} />
              <Row k="cells" v={sic.stats.n_cells} />
              <Row k="navigable cells" v={sic.stats.n_navigable} tone="text-safe" />
              <Row k="non-navigable cells" v={sic.stats.n_non_navigable} tone="text-warn" />
            </dl>
          )}
          {show.sic && <SicLegend className="mt-3 border-t border-graphite-700 pt-2.5" />}
        </FloatPanel>

        {/* ---------------------------------------------- uncertainty */}
        <FloatPanel title="SIC uncertainty" bodyClass="px-3 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge value="PARTIAL" />
            <span className="num text-[12.5px] text-white">{unc.date ?? '—'}</span>
            <span className="mono-label">{unc.horizonDays != null ? `lead ${unc.horizonDays} d` : '—'}</span>
          </div>
          {unc.error && <ErrorState title="Uncertainty frame unavailable" message={unc.error.message} />}
          {unc.loading && <LoadingState label="Decoding uncertainty" />}
          {unc.stats && (
            <dl>
              <Row k="cells" v={unc.stats.n_cells} />
              <Row k="within model domain" v={unc.stats.n_within_model_domain} />
              <Row k="outside model domain" v={unc.stats.n_outside_model_domain} tone="text-warn" />
              <Row k="mean (1σ)" v={unc.stats.mean?.toFixed(4)} />
              <Row k="median (1σ)" v={unc.stats.median?.toFixed(4)} />
              <Row k="p90 (1σ)" v={unc.stats.p90?.toFixed(4)} />
              <Row k="max (1σ)" v={unc.stats.max?.toFixed(4)} />
            </dl>
          )}
          {show.unc && <UncertaintyLegend className="mt-3 border-t border-graphite-700 pt-2.5" />}

          <div className="mt-3 border-t border-graphite-700 pt-2.5">
            <p className="input-label">Committed distribution summary</p>
            {summary.data?.available ? (
              <>
                <dl>
                  <Row k="MIZ mean σ" v={summary.data.miz_mean_std?.toFixed(4)} />
                  <Row k="MIZ median σ" v={summary.data.miz_median_std?.toFixed(4)} />
                  <Row k="MIZ p10 σ" v={summary.data.miz_p10_std?.toFixed(4)} />
                  <Row k="MIZ p90 σ" v={summary.data.miz_p90_std?.toFixed(4)} />
                  <Row k="Full-field mean σ" v={summary.data.full_mean_std?.toFixed(4)} />
                </dl>
                {summary.data.histogram_counts?.length > 1 && (
                  <div className="mt-2">
                    <Histogram
                      bins={summary.data.histogram_bins}
                      counts={summary.data.histogram_counts}
                    />
                    <p className="mono-label mt-1">σ distribution · {summary.data.units}</p>
                  </div>
                )}
                <p className="mono-label mt-2 truncate" title={summary.data.source}>
                  source: {summary.data.source}
                </p>
              </>
            ) : (
              <p className="text-[11.5px] text-mist">
                {summary.error ? summary.error.message : 'reading…'}
              </p>
            )}
          </div>
        </FloatPanel>

        {/* ---------------------------------------------- valid domain */}
        <FloatPanel title="Valid data area" bodyClass="px-3 py-3">
          <dl>
            <Row k="Grid" v={meta.data ? `${meta.data.n_rows} × ${meta.data.n_cols}` : '—'} />
            <Row k="Resolution" v={meta.data ? `${meta.data.resolution_deg}°` : '—'} />
            <Row k="Latitude" v={meta.data ? `${meta.data.lat_range[0]}° → ${meta.data.lat_range[1]}°` : '—'} />
            <Row k="Longitude" v={meta.data ? `${meta.data.lon_range[0]}° → ${meta.data.lon_range[1]}°` : '—'} />
            {bands && (
              <>
                <Row k="Model band rows" v={`${bands.modelRows[0]}–${bands.modelRows[1]}`} />
                <Row k="Model band cols" v={`${bands.modelCols[0]}–${bands.modelCols[1]}`} />
                <Row k="Extension rows" v={`${bands.extRows[0]}–${bands.extRows[1]}`} />
                <Row k="Extension cols" v={`${bands.extCols[0]}–${bands.extCols[1]}`} />
              </>
            )}
            <Row k="Uncertainty shape" v={meta.data ? meta.data.uncertainty_shape.join(' × ') : '—'} />
            <Row k="Uncertainty horizons" v={meta.data?.uncertainty_horizons ?? '—'} />
          </dl>
          <p className="mt-2 text-[11px] leading-relaxed text-steel">{meta.data?.nan_policy}</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-steel">
            The uncertainty product exists only inside the model band; cells outside it render
            transparent and are reported as <span className="font-mono">outside model domain</span>.
          </p>
        </FloatPanel>

        {/* ---------------------------------------------- model */}
        <FloatPanel title="Forecast model" bodyClass="px-3 py-3">
          {ensemble.data?.available ? (
            <>
              <dl>
                <Row k="Architecture" v={ensemble.data.architecture} />
                <Row k="Members" v={ensemble.data.n_members} />
                <Row k="Parameters / checkpoint" v={ensemble.data.param_count} />
                <Row k="Horizons" v={ensemble.data.horizons} />
                <Row
                  k="Inference re-run"
                  v={ensemble.data.inference_rerun_possible ? 'possible' : 'not possible'}
                  tone={ensemble.data.inference_rerun_possible ? 'text-safe' : 'text-warn'}
                />
              </dl>
              <div className="mt-2 space-y-1.5">
                {ensemble.data.members?.map((m) => (
                  <div key={m.run} className="border border-graphite-700 bg-graphite-900 px-2.5 py-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="num text-[11.5px] text-white">{m.run}</span>
                      <Badge
                        value={m.checkpoint_present ? 'CHECKPOINT PRESENT' : 'CHECKPOINT MISSING'}
                        tone={m.checkpoint_present ? 'ok' : 'bad'}
                        dot={false}
                      />
                    </div>
                    <p className="mono-label mt-1">seed {m.seed}</p>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[10.5px] leading-relaxed text-steel">
                Values are the metrics recorded by each training run. Nothing is recomputed here.
              </p>
            </>
          ) : (
            <p className="text-[11.5px] text-mist">
              {ensemble.error ? ensemble.error.message : 'reading…'}
            </p>
          )}
        </FloatPanel>
        {/* ---------------------------------------------- forecast source */}
        <FloatPanel
          title="Forecast source"
          action={
            sicStatus.data ? (
              <Badge value={sicStatus.data.status} tone={sicStatus.data.status === 'READY' ? 'ok' : 'warn'} />
            ) : (
              <Badge value={sicStatus.error ? 'ERROR' : '…'} />
            )
          }
          bodyClass="px-3 py-3"
        >
          {sicStatus.data ? (
            <>
              <dl>
                <Row k="Serving mode" v={sicStatus.data.serving_mode} tone="text-safe" />
                <Row k="Model" v={sicStatus.data.model} />
                <Row k="Date range" v={sicStatus.data.date_range ? sicStatus.data.date_range.join(' → ') : null} />
                <Row k="Frames" v={sicStatus.data.n_timesteps} />
                <Row
                  k="Forecast artifact"
                  v={sicStatus.data.artifact?.present ? sicStatus.data.artifact.path : null}
                  tone={sicStatus.data.artifact?.present ? '' : 'text-warn'}
                />
                <Row
                  k="Artifact shape"
                  v={sicStatus.data.artifact?.shape ? sicStatus.data.artifact.shape.join(' × ') : null}
                />
                <Row
                  k="Uncertainty artifact"
                  v={sicStatus.data.uncertainty_artifact?.present ? sicStatus.data.uncertainty_artifact.path : null}
                  tone={sicStatus.data.uncertainty_artifact?.present ? '' : 'text-warn'}
                />
                <Row
                  k="Checkpoints"
                  v={
                    sicStatus.data.checkpoints
                      ? `${sicStatus.data.checkpoints.n_present}/${sicStatus.data.checkpoints.n_members} present`
                      : null
                  }
                />
                <Row
                  k="Inference re-run"
                  v={sicStatus.data.inference_rerun_possible ? 'possible' : 'not possible'}
                  tone={sicStatus.data.inference_rerun_possible ? 'text-safe' : 'text-warn'}
                />
              </dl>
              {sicStatus.data.inference_blocker && (
                <p className="mt-2 border-t border-graphite-700 pt-2 text-[11px] leading-relaxed text-mist">
                  {sicStatus.data.inference_blocker}
                </p>
              )}
              <p className="mono-label mt-2">GET /api/sic/status</p>
            </>
          ) : (
            <p className="text-[11.5px] text-mist">
              {sicStatus.error ? sicStatus.error.message : 'reading…'}
            </p>
          )}
        </FloatPanel>
      </aside>

      {/* ------------------------------------------------ chart */}
      <div className="scrollbar-thin relative order-1 flex-1 overflow-y-auto lg:order-2 lg:min-h-0">
        <div className="relative h-[54vh] w-full lg:h-[clamp(400px,56vh,660px)]">
        <AntarcticMap
          className="absolute inset-0"
          meta={meta.data}
          coastline={show.coast ? coastline : null}
          showBaseTiles={show.base}
          showCoastline={show.coast}
          showGraticule={show.graticule}
          showStations={false}
          sicRaster={show.sic ? sic : null}
          sicOpacity={0.78}
          uncertaintyRaster={show.unc ? unc : null}
          uncertaintyOpacity={0.55}
          routeLine={show.route ? routeLine : null}
          routeLabel="Baseline A* route"
          endpoints={show.route ? routeEndpoints : []}
          onCursor={setCursor}
        />

        <div className="absolute right-3 top-3 z-[500] border border-graphite-600 bg-graphite-850 px-3 py-2 shadow-overlay">
          <p className="mono-label">SIC forecast</p>
          <p className="num mt-0.5 text-[15px] text-white">{sic.date ?? '—'}</p>
          <p className="mono-label mt-1">
            validity D+{timestep} · lead {unc.horizonDays ?? '—'} d
          </p>
        </div>

        <div className="absolute bottom-3 right-3 z-[500] border border-graphite-600 bg-graphite-850 px-3 py-2 shadow-overlay">
          <CoordReadout cursor={cursor} />
        </div>
        </div>

        {/* ------------------------------------- route SIC profile */}
        <div className="border-t border-graphite-600 bg-graphite-900 p-3">
          {show.route ? (
            <RouteSicProfile
              profile={profile.data}
              loading={profile.loading}
              error={profile.error}
              title="Baseline route · SIC along the path"
            />
          ) : (
            <p className="text-[11.5px] text-steel">
              Route layer switched off. Enable <span className="text-mist">Baseline route + SIC profile</span> to
              sample sea-ice concentration along the optimised path.
            </p>
          )}
        </div>

        {meta.error && (
          <div className="relative z-[600] mx-auto my-3 w-[420px] max-w-full lg:w-[420px]">
            <ErrorState title="Grid metadata unavailable" message={meta.error.message} />
          </div>
        )}
      </div>
    </div>
  )
}

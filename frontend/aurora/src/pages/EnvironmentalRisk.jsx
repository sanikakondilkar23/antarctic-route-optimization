import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, CircleSlash } from 'lucide-react'
import Badge from '../components/ui/Badge'
import PageHeader, { MetaItem } from '../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../components/ui/Status'
import { Notice } from '../components/ui/Panels'
import {
  fetchCurrent,
  fetchIcebergStatus,
  fetchLayersStatus,
  fetchLimitations,
  fetchSystemStatus,
} from '../lib/auroraApi'

const FACTORS = [
  { id: 'sic', label: 'Sea-ice concentration', weight: 'w_sic', lim: 'sic', note: 'Primary hazard term' },
  { id: 'distance', label: 'Distance (great-circle)', weight: 'w_distance', alwaysActive: true, note: 'Always present' },
  { id: 'unc', label: 'Forecast uncertainty (σ)', weight: 'w_unc', lim: 'uncertainty', note: 'Committed 3-horizon artifact' },
  { id: 'wind', label: 'Wind loading', weight: 'w_wind', lim: 'wind', note: 'ERA5 / ECMWF dataset' },
  { id: 'curr', label: 'Ocean currents', weight: 'w_curr', lim: 'cmems', note: 'CMEMS U/V' },
  { id: 'ice', label: 'Iceberg standoff', weight: 'w_ice', lim: 'iceberg', note: 'Risk field + standoff term' },
  { id: 'depth', label: 'Under-keel clearance', weight: 'w_depth', lim: 'depth', note: 'GEBCO depth penalty' },
  { id: 'iceClass', label: 'Ice-class multiplier', weight: 'w_ice_class', lim: 'ice_multiplier', note: 'POLARIS-style multiplier' },
  { id: 'cvar', label: 'Tail risk (CVaR)', lim: 'cvar', note: 'Scenario robust routing' },
  { id: 'land', label: 'Land mask', alwaysActive: true, lim: 'land_mask', note: 'Committed GEBCO mask' },
]

function statusOf(factor, weights, limitations) {
  const text = String(limitations?.[factor.lim] ?? '')
  if (/^(NOT AVAILABLE|UNAVAILABLE|Unavailable)/i.test(text.trim())) {
    return { label: 'NOT AVAILABLE', tone: 'bad', icon: CircleSlash }
  }
  const w = factor.weight ? Number(weights?.[factor.weight] ?? 0) : null
  if (factor.alwaysActive || (w !== null && w > 0)) {
    return { label: 'IN COST', tone: 'ok', icon: CheckCircle2 }
  }
  return { label: 'WEIGHT 0', tone: 'warn', icon: AlertTriangle }
}

function Row({ k, v, tone = '' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-graphite-700 py-[5px] last:border-0">
      <dt className="text-[11.5px] text-mist">{k}</dt>
      <dd className={`num text-right text-[12px] ${tone || 'text-white/90'}`}>{v}</dd>
    </div>
  )
}

function Panel({ title, children, action, className = '' }) {
  return (
    <section className={`border border-graphite-600 bg-graphite-850 ${className}`}>
      <header className="flex items-center justify-between gap-2 border-b border-graphite-600 px-4 py-2.5">
        <h2 className="eyebrow">{title}</h2>
        {action}
      </header>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  )
}

export default function EnvironmentalRisk() {
  const [layers, setLayers] = useState({ data: null, error: null, loading: true })
  const [lims, setLims] = useState({ data: null, error: null, loading: true })
  const [current, setCurrent] = useState({ data: null, error: null, loading: true })
  const [ice, setIce] = useState({ data: null, error: null, loading: true })
  const [sys, setSys] = useState({ data: null, error: null, loading: true })

  useEffect(() => {
    let alive = true
    const load = (fn, setter) =>
      fn()
        .then((d) => alive && setter({ data: d, error: null, loading: false }))
        .catch((e) => alive && setter({ data: null, error: e, loading: false }))
    load(() => fetchLayersStatus(0), setLayers)
    load(() => fetchLimitations(), setLims)
    load(() => fetchCurrent(0), setCurrent)
    load(() => fetchIcebergStatus(), setIce)
    load(() => fetchSystemStatus(), setSys)
    return () => {
      alive = false
    }
  }, [])

  const weights = layers.data?.cost_weights ?? layers.data?.cost_breakdown?.weights ?? null
  const breakdown = layers.data?.cost_breakdown ?? null
  const limitations = lims.data ?? {}
  const datasets = sys.data?.datasets ?? {}

  const anyLoading = layers.loading || lims.loading

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-[1440px] space-y-4 p-5">
        <PageHeader
          title="Risk Analytics"
          subtitle="Which environmental factors actually shape an AURORA route in this deployment, and which ones are absent. Every status below is derived from the live cost weights, layer availability and the backend's own limitation report."
          meta={
            <>
              <MetaItem label="TERMS IN COST" value={breakdown?.terms?.length != null ? breakdown.terms.join(', ') : '—'} />
              <MetaItem label="SIC WEIGHT" value={weights?.w_sic ?? '—'} />
              <MetaItem label="DISTANCE WEIGHT" value={weights?.w_distance ?? '—'} />
              <MetaItem label="GRID" value={sys.data?.environment?.sic?.grid ? sys.data.environment.sic.grid.join(' × ') : '—'} />
            </>
          }
        />

        <Notice tone="warn" icon={AlertTriangle} title="AURORA reports risk factors — it does not compute a composite risk score">
          This deployment has no endpoint that merges sea-ice concentration, forecast spread,
          iceberg presence, wind, currents and under-keel clearance into a single number, so no
          composite score is shown anywhere in the product. What follows are the individual
          factors: their live cost weight, whether a dataset backs them, and the backend's own
          statement about each. A weight of 0.0 means the factor has no effect on any route drawn
          by this system — it does not mean the hazard is absent.
        </Notice>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
          {/* --------------------------------------- main */}
          <div className="space-y-4">
            <Panel
              title="Cost function in force"
              action={<Badge value={layers.error ? 'UNAVAILABLE' : 'LIVE'} tone={layers.error ? 'bad' : 'ok'} />}
            >
              {anyLoading && <LoadingState label="Reading cost configuration" />}
              {layers.error && <ErrorState title="Layer status unavailable" message={layers.error.message} />}
              {breakdown && (
                <>
                  <p className="mono-label mb-2">formula</p>
                  <pre className="scrollbar-thin overflow-x-auto whitespace-pre-wrap break-words border border-graphite-700 bg-graphite-950 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-ice-dim">
{breakdown.formula}
                  </pre>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="input-label">Active weights</p>
                      <dl>
                        {Object.entries(weights ?? {})
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([k, v]) => (
                            <Row
                              key={k}
                              k={k}
                              v={v}
                              tone={Number(v) > 0 ? 'text-safe' : 'text-steel'}
                            />
                          ))}
                      </dl>
                    </div>
                    <div>
                      <p className="input-label">Cost accounting</p>
                      <dl>
                        <Row k="terms in cost" v={(breakdown.terms ?? []).join(', ') || 'none'} />
                        <Row k="finite cells" v={breakdown.total_cost_finite_cells} />
                        <Row k="non-finite cells" v={breakdown.total_cost_nonfinite_cells} tone={breakdown.total_cost_nonfinite_cells ? 'text-warn' : ''} />
                        <Row k="cells omitted (SIC NaN)" v={breakdown.omitted_cells?.sic} tone="text-warn" />
                      </dl>
                    </div>
                  </div>
                </>
              )}
            </Panel>

            <Panel title="Environmental factors">
              {lims.error && <ErrorState title="Limitations unavailable" message={lims.error.message} />}
              {!lims.error && !lims.loading && (
                <div className="scrollbar-thin overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse">
                    <thead>
                      <tr className="border-b border-graphite-600">
                        <th className="th">Factor</th>
                        <th className="th">Status</th>
                        <th className="th text-right">Weight</th>
                        <th className="th">Role</th>
                      </tr>
                    </thead>
                    <tbody>
                      {FACTORS.map((f) => {
                        const st = statusOf(f, weights, limitations)
                        const Icon = st.icon
                        return (
                          <tr key={f.id} className="border-b border-graphite-700 last:border-0">
                            <td className="td">
                              <span className="text-[13px] font-medium text-white">{f.label}</span>
                            </td>
                            <td className="td">
                              <span className={`inline-flex items-center gap-1.5 text-[11.5px] font-semibold ${
                                st.tone === 'ok' ? 'text-safe' : st.tone === 'warn' ? 'text-warn' : 'text-danger'
                              }`}>
                                <Icon size={13} /> {st.label}
                              </span>
                            </td>
                            <td className="td num text-right">
                              {f.weight ? (weights?.[f.weight] ?? '—') : '—'}
                            </td>
                            <td className="td text-[11.5px] text-mist">{f.note}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-3 border-t border-graphite-700 pt-2.5 text-[11px] leading-relaxed text-steel">
                “NOT AVAILABLE” is the backend's own wording in <span className="font-mono">/api/limitations</span>.
                AURORA does not substitute a proxy value for a missing factor.
              </p>
            </Panel>

            <Panel title="Dataset availability">
              {sys.loading && <LoadingState label="Reading dataset registry" />}
              {sys.error && <ErrorState title="System status unavailable" message={sys.error.message} />}
              {sys.data && (
                <div className="scrollbar-thin overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse">
                    <thead>
                      <tr className="border-b border-graphite-600">
                        <th className="th">Layer</th>
                        <th className="th">Configured</th>
                        <th className="th">Exists</th>
                        <th className="th">Lookup</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(datasets).map(([name, d]) => (
                        <tr key={name} className="border-b border-graphite-700 last:border-0">
                          <td className="td num text-[12px] text-white">{name}</td>
                          <td className="td">
                            <span className={d.configured ? 'text-safe' : 'text-steel'}>
                              {String(d.configured)}
                            </span>
                          </td>
                          <td className="td">
                            <span className={d.exists ? 'text-safe' : 'text-warn'}>
                              {String(d.exists)}
                            </span>
                          </td>
                          <td className="td truncate font-mono text-[11px] text-steel" title={(d.searched ?? []).join('\n')}>
                            {(d.searched ?? [])[0] ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          {/* --------------------------------------- aside */}
          <div className="space-y-4">
            <Panel title="Ocean currents" action={<Badge value={current.data?.available ? 'AVAILABLE' : 'UNAVAILABLE'} tone={current.data?.available ? 'ok' : 'bad'} />}>
              {current.loading && <LoadingState label="Reading current status" />}
              {current.error && <ErrorState title="Unavailable" message={current.error.message} />}
              {current.data && (
                <>
                  <dl>
                    <Row k="Label" v={current.data.label} tone={current.data.available ? '' : 'text-danger'} />
                    <Row k="date" v={current.data.date} />
                    <Row k="timestep" v={current.data.timestep} />
                    <Row k="uo / vo" v={`${current.data.uo ?? 'null'} / ${current.data.vo ?? 'null'}`} tone="text-warn" />
                    <Row k="integration" v={current.data.integration} />
                  </dl>
                  <p className="mt-2 border-t border-graphite-700 pt-2 text-[11.5px] leading-relaxed text-mist">
                    {current.data.note}
                  </p>
                  <p className="mono-label mt-2 break-all">{current.data.root}</p>
                </>
              )}
            </Panel>

            <Panel title="Iceberg risk" action={<Badge value={ice.data?.risk_status ?? '—'} tone="bad" />}>
              {ice.loading && <LoadingState label="Reading iceberg status" />}
              {ice.error && <ErrorState title="Unavailable" message={ice.error.message} />}
              {ice.data && (
                <>
                  <dl>
                    <Row k="Georeferencing" v={ice.data.georeferencing?.status ?? '—'} tone="text-warn" />
                    <Row k="Risk status" v={ice.data.risk_status} tone="text-danger" />
                    <Row
                      k="Route consumes iceberg risk"
                      v={String(ice.data.route_consumes_iceberg_risk)}
                      tone={ice.data.route_consumes_iceberg_risk ? 'text-safe' : 'text-warn'}
                    />
                  </dl>
                  {ice.data.route_note && (
                    <p className="mt-2 border-t border-graphite-700 pt-2 text-[11.5px] leading-relaxed text-mist">
                      {ice.data.route_note}
                    </p>
                  )}
                </>
              )}
            </Panel>

            <Panel title="Provenance flags">
              <dl>
                <Row k="Project" v={sys.data?.project ?? '—'} />
                <Row k="System" v={sys.data?.system ?? '—'} />
                <Row k="Retraining performed" v={String(sys.data?.retraining_performed ?? '—')} tone="text-safe" />
                <Row k="Synthetic route data" v={String(sys.data?.synthetic_route_data_used ?? '—')} tone="text-safe" />
                <Row k="Generated (UTC)" v={sys.data?.generated_utc ?? '—'} />
              </dl>
              <p className="mt-2 border-t border-graphite-700 pt-2 text-[11.5px] leading-relaxed text-steel">
                No model was retrained for this interface and no synthetic route data was used to
                produce the routes shown in AURORA.
              </p>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  )
}

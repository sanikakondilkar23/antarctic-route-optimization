import { useEffect, useState } from 'react'
import {
  ArrowUpRight,
  Boxes,
  CheckCircle2,
  CircleSlash,
  Cpu,
  Database,
  RefreshCw,
  Route as RouteIcon,
  ShieldCheck,
  Snowflake,
  Waves,
} from 'lucide-react'
import PageHeader, { MetaItem } from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { ErrorState, LoadingState } from '../components/ui/Status'
import { MetricCard, ModelCard, Notice, Row, SectionHeader } from '../components/ui/Panels'
import {
  fetchAuroraStatus,
  fetchEnsemble,
  fetchIcebergStatus,
  fetchLayersStatus,
  fetchSicStatus,
} from '../lib/auroraApi'
import { cn } from '../lib/utils'

/**
 * /models - the three intelligence components, described by the backend.
 *
 * Nothing on this page is authored here: every status word, metric, checkpoint
 * path, test count and warning comes from /api/sic/status, /api/icebergs/status,
 * /api/layers/status and /api/models/ensemble. The recorded training metrics
 * are labelled as such - they are not live inference scores, because the API
 * states that re-running inference is not possible in this deployment.
 */

const fn = (v, digits = 4) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : null)

export default function Models() {
  const [ensemble, setEnsemble] = useState({ data: null, error: null, loading: true })
  const [sic, setSic] = useState({ data: null, error: null, loading: true })
  const [iceberg, setIceberg] = useState({ data: null, error: null, loading: true })
  const [layers, setLayers] = useState({ data: null, error: null, loading: true })
  const [status, setStatus] = useState({ data: null, error: null, loading: true })

  const load = async () => {
    const [e, s, i, l, st] = await Promise.allSettled([
      fetchEnsemble(),
      fetchSicStatus(),
      fetchIcebergStatus(),
      fetchLayersStatus(0),
      fetchAuroraStatus(),
    ])
    const apply = (setter) => (r) =>
      setter(
        r.status === 'fulfilled'
          ? { data: r.value, error: null, loading: false }
          : { data: null, error: r.reason, loading: false }
      )
    apply(setEnsemble)(e)
    apply(setSic)(s)
    apply(setIceberg)(i)
    apply(setLayers)(l)
    apply(setStatus)(st)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const anyLoading = ensemble.loading || sic.loading || iceberg.loading || layers.loading
  const aurora = status.data
  const rows = aurora?.rows ?? []
  const rowFor = (label) => rows.find((r) => r.label === label)

  const sicRow = rowFor('SIC Model')
  const iceRow = rowFor('Iceberg Model')
  const routeRow = rowFor('Route Model')

  const members = ensemble.data?.members ?? []
  const verification = ensemble.data?.verification ?? null
  const artifact = sic.data?.artifact ?? null
  const uncArtifact = sic.data?.uncertainty_artifact ?? null

  const meanMiz =
    members.length > 0
      ? members.reduce((a, m) => a + (m.metrics?.miz_mean ?? 0), 0) / members.filter((m) => m.metrics).length
      : null

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-5 p-4 md:p-6">
        <PageHeader
          title="Models"
          subtitle="The three intelligence components AURORA runs, described exactly as the backend reports them: architecture, checkpoints, recorded metrics, and every limitation each component declares about itself."
          meta={
            <>
              <MetaItem label="COMPONENTS" value={aurora ? `${aurora.counts.ready}/${aurora.counts.total} ready` : '—'} />
              <MetaItem label="ENSEMBLE" value={ensemble.data ? `${ensemble.data.n_members} members` : '—'} />
              <MetaItem label="PARAMETERS" value={ensemble.data?.param_count?.toLocaleString() ?? '—'} />
              <MetaItem label="REPORTED" value={aurora?.generated_at?.slice(0, 19).replace('T', ' ') ?? '—'} />
            </>
          }
          actions={
            <Button variant="secondary" onClick={load}>
              <RefreshCw size={14} /> Refresh
            </Button>
          }
        />

        {/* ---------------------------------------------------------- */}
        {/* The three components                                       */}
        {/* ---------------------------------------------------------- */}
        <SectionHeader
          eyebrow="AURORA COMPONENTS"
          title="Three separate intelligence modules under one platform"
          description="Route optimization, sea-ice intelligence and iceberg intelligence are independent components of AURORA. They share no data path with each other: the sea-ice module does not feed the iceberg detector, the iceberg detector does not feed the sea-ice module, and iceberg detections reach the route cost only if the backend reports that it consumes them."
        />

        {anyLoading && status.loading ? (
          <div className="border border-graphite-600 bg-graphite-850 p-6">
            <LoadingState label="Reading model status" />
          </div>
        ) : !aurora ? (
          <ErrorState
            title="Model status unavailable"
            message={status.error?.message ?? 'The backend did not report component status.'}
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <ModelCard
              index="01"
              name="Route Optimization"
              purpose="Operational route planning and optimisation: A* over a multi-layer environmental cost map, with a re-planning endpoint that replans on a later forecast timestep when conditions change."
              input="Environmental cost grid (SIC mean, optional wind/current/depth/iceberg terms)"
              output="Waypoint path, cost breakdown, expanded-node count"
              status={routeRow?.status ?? 'unknown'}
              integration={routeRow?.status ?? '—'}
              endpoint="GET /api/layers/status"
              to="/routes"
              loading={layers.loading}
            >
              <dl className="border-t border-graphite-700 pt-3">
                <Row k="Algorithm" v={routeRow?.detail} />
                <Row
                  k="Terms in the cost"
                  v={layers.data?.cost_breakdown?.terms?.length ? layers.data.cost_breakdown.terms.join(', ') : 'none'}
                  tone={layers.data?.cost_breakdown?.terms?.length ? 'text-safe' : 'text-warn'}
                />
                <Row k="Requested layers" v={layers.data?.cost_layers_requested?.join(', ')} />
                <Row k="Finite cost cells" v={layers.data?.cost_breakdown?.total_cost_finite_cells?.toLocaleString()} />
                <Row k="Omitted (sic)" v={layers.data?.cost_breakdown?.omitted_cells?.sic?.toLocaleString()} />
              </dl>
              {layers.data?.cost_breakdown?.formula && (
                <p className="overflow-x-auto whitespace-nowrap border-t border-graphite-700 pt-2 font-mono text-[10px] text-steel" title={layers.data.cost_breakdown.formula}>
                  {layers.data.cost_breakdown.formula}
                </p>
              )}
            </ModelCard>

            <ModelCard
              index="02"
              name="Sea-Ice / SIC Intelligence"
              purpose="Sea-ice concentration, forecast and uncertainty: predicts concentration up to three days ahead over the 0.25° routing grid, and publishes the forecast-spread field the routing cost map can consume."
              input="10-channel, 3-frame ConvLSTM input window (committed 2026 test inputs)"
              output="3 forecast horizons · committed artifact backend/cache/routing_sic_2026.npy"
              status={sicRow?.status ?? sic.data?.status ?? 'unknown'}
              integration={sicRow?.status ?? '—'}
              endpoint="GET /api/sic/status"
              to="/sea-ice"
              loading={sic.loading}
            >
              <dl className="border-t border-graphite-700 pt-3">
                <Row k="Architecture" v={sic.data?.model} />
                <Row k="Serving mode" v={sic.data?.serving_mode} />
                <Row k="Checkpoints" v={sic.data?.checkpoints ? `${sic.data.checkpoints.n_present}/${sic.data.checkpoints.n_members} present` : null} />
                <Row k="Forecast window" v={sic.data?.date_range?.join(' → ')} />
                <Row k="Timesteps" v={sic.data?.n_timesteps} />
                <Row
                  k="Inference re-run"
                  v={sic.data?.inference_rerun_possible ? 'possible' : 'not possible'}
                  tone={sic.data?.inference_rerun_possible ? 'text-safe' : 'text-warn'}
                />
              </dl>
              {sic.data?.inference_blocker && (
                <p className="border-t border-graphite-700 pt-2 text-[11px] leading-relaxed text-mist">
                  {sic.data.inference_blocker}
                </p>
              )}
            </ModelCard>

            <ModelCard
              index="03"
              name="Iceberg Intelligence"
              purpose="SAR-based iceberg detection: finds icebergs in Sentinel-1 SAR tiles with a YOLOv8 detector and reports each detection's confidence and pixel-space extent. It is a standalone module and is not an input to the sea-ice model."
              input="Uploaded SAR tile (PNG) · YOLOv8 weights"
              output="Detections in pixel space · confidence · bbox"
              status={iceRow?.status ?? iceberg.data?.risk_status ?? 'unknown'}
              integration={iceRow?.status ?? '—'}
              endpoint="GET /api/icebergs/status"
              to="/icebergs"
              loading={iceberg.loading}
            >
              <dl className="border-t border-graphite-700 pt-3">
                <Row k="Checkpoint" v={iceberg.data?.checkpoint_present ? 'present' : 'missing'} tone={iceberg.data?.checkpoint_present ? 'text-safe' : 'text-warn'} />
                <Row k="SHA-256" v={iceberg.data?.checkpoint_sha256 ? `${iceberg.data.checkpoint_sha256.slice(0, 16)}…` : null} />
                <Row k="Coordinate space" v={iceberg.data?.georeferencing?.unit} tone="text-warn" />
                <Row k="Georeferencing" v={iceberg.data?.georeferencing?.status} tone="text-warn" />
                <Row
                  k="Route consumes risk"
                  v={iceberg.data?.route_consumes_iceberg_risk ? 'yes' : 'no'}
                  tone={iceberg.data?.route_consumes_iceberg_risk ? 'text-safe' : 'text-warn'}
                />
                <Row k="Dataset" v={iceberg.data?.dataset_status} />
              </dl>
              {iceberg.data?.route_note && (
                <p className="border-t border-graphite-700 pt-2 text-[11px] leading-relaxed text-mist">
                  {iceberg.data.route_note}
                </p>
              )}
            </ModelCard>
          </div>
        )}

        {/* ---------------------------------------------------------- */}
        {/* Ensemble metrics                                            */}
        {/* ---------------------------------------------------------- */}
        <Card>
          <Card.Header
            title="ConvLSTM ensemble — recorded training metrics"
            subtitle="GET /api/models/ensemble · these are the checkpoints' own recorded metrics from training, not live inference scores"
            icon={Cpu}
            action={
              <Badge
                value={ensemble.data ? `${members.length} MEMBERS` : ensemble.error ? 'ERROR' : '…'}
                tone={ensemble.data ? 'ok' : ensemble.error ? 'bad' : 'neutral'}
              />
            }
          />
          <Card.Body className="scrollbar-thin overflow-x-auto">
            {ensemble.loading && <LoadingState label="Reading ensemble" />}
            {ensemble.error && <ErrorState title="Ensemble unavailable" message={ensemble.error.message} />}
            {ensemble.data && (
              <>
                <div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricCard label="Members" value={ensemble.data.n_members} note={ensemble.data.architecture} />
                  <MetricCard label="Parameters" value={ensemble.data.param_count?.toLocaleString()} note={ensemble.data.param_count_source} />
                  <MetricCard
                    label="Mean MIZ error (3 seeds)"
                    value={fn(meanMiz, 4)}
                    note="mean of miz_mean across members — recorded at training"
                  />
                  <MetricCard
                    label="Inference re-run"
                    value={ensemble.data.inference_rerun_possible ? 'possible' : null}
                    state={ensemble.data.inference_rerun_possible ? 'ok' : 'unavailable'}
                    note={ensemble.data.inference_rerun_possible ? null : 'raw 2026 multi-channel inputs absent'}
                  />
                </div>

                <table className="w-full min-w-[900px] border-collapse">
                  <thead>
                    <tr className="border-b border-graphite-600">
                      <th className="th">Run</th>
                      <th className="th">Seed</th>
                      <th className="th">Checkpoint</th>
                      <th className="th th-right">Best epoch</th>
                      <th className="th th-right">Val loss</th>
                      <th className="th th-right">MIZ D+1</th>
                      <th className="th th-right">MIZ D+2</th>
                      <th className="th th-right">MIZ D+3</th>
                      <th className="th th-right">MIZ mean</th>
                      <th className="th th-right">Wall time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.run} className="border-b border-graphite-700 last:border-0">
                        <td className="td font-mono text-[11.5px] text-white">{m.run}</td>
                        <td className="td text-[12px] text-mist">{m.seed}</td>
                        <td className="td">
                          <span className="inline-flex items-center gap-1.5 text-[11.5px]">
                            <CheckCircle2 size={12} className={m.checkpoint_present ? 'text-safe' : 'text-danger'} />
                            <span className="font-mono text-[10.5px] text-mist">
                              {m.checkpoint_present ? 'present' : 'missing'}
                            </span>
                          </span>
                        </td>
                        <td className="td num text-right text-[12px] text-white/90">{m.metrics?.best_epoch ?? '—'}</td>
                        <td className="td num text-right text-[12px] text-white/90">{fn(m.metrics?.val_loss, 6)}</td>
                        <td className="td num text-right text-[12px] text-white/90">{fn(m.metrics?.miz_day1)}</td>
                        <td className="td num text-right text-[12px] text-white/90">{fn(m.metrics?.miz_day2)}</td>
                        <td className="td num text-right text-[12px] text-white/90">{fn(m.metrics?.miz_day3)}</td>
                        <td className="td num text-right text-[12px] text-ice">{fn(m.metrics?.miz_mean)}</td>
                        <td className="td num text-right text-[12px] text-mist">
                          {m.metrics?.total_wall_s != null ? `${Math.round(m.metrics.total_wall_s)} s` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <p className="mt-3 border-t border-graphite-700 pt-2.5 text-[11px] leading-relaxed text-mist">
                  {ensemble.data.note}
                </p>
              </>
            )}
          </Card.Body>
        </Card>

        {/* ---------------------------------------------------------- */}
        {/* Artifacts + verification                                   */}
        {/* ---------------------------------------------------------- */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <Card.Header title="Committed artifacts" subtitle="What the pipeline actually consumes at runtime" icon={Database} />
            <Card.Body>
              {sic.loading && <LoadingState label="Reading artifact inventory" compact />}
              {sic.error && <ErrorState title="Artifacts unavailable" message={sic.error.message} compact />}
              {sic.data && (
                <dl>
                  <Row k="Forecast artifact" v={artifact?.path} />
                  <Row k="Present" v={artifact?.present ? 'yes' : 'no'} tone={artifact?.present ? 'text-safe' : 'text-warn'} />
                  <Row k="Shape (T, H, W)" v={artifact?.shape ? artifact.shape.join(' × ') : null} />
                  <Row k="Uncertainty artifact" v={uncArtifact?.path} />
                  <Row k="Present" v={uncArtifact?.present ? 'yes' : 'no'} tone={uncArtifact?.present ? 'text-safe' : 'text-warn'} />
                  <Row k="Shape (T, H, H, W)" v={uncArtifact?.shape ? uncArtifact.shape.join(' × ') : null} />
                </dl>
              )}
              <p className="mt-3 border-t border-graphite-700 pt-2.5 text-[11px] leading-relaxed text-mist">
                These arrays are served as-is. The backend never re-synthesises a forecast frame, so
                what you see on /sea-ice is exactly what was committed.
              </p>
            </Card.Body>
          </Card>

          <Card>
            <Card.Header
              title="System verification"
              subtitle="outputs/final_demo/final_system_validation.json"
              icon={ShieldCheck}
              action={
                verification ? (
                  <Badge
                    value={verification.tests_status ?? '—'}
                    tone={verification.tests_failed === 0 ? 'ok' : 'bad'}
                  />
                ) : null
              }
            />
            <Card.Body className="space-y-3">
              {ensemble.loading && <LoadingState label="Reading verification" compact />}
              {ensemble.error && <ErrorState title="Verification unavailable" message={ensemble.error.message} compact />}
              {verification && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <MetricCard label="Tests passed" value={verification.tests_passed} tone="text-safe" />
                    <MetricCard label="Tests failed" value={verification.tests_failed} tone={verification.tests_failed ? 'text-danger' : 'text-safe'} />
                    <MetricCard
                      label="CVaR computed"
                      value={verification.cvar_computed ? 'yes' : null}
                      state={verification.cvar_computed ? 'ok' : 'unavailable'}
                    />
                  </div>
                  <p className="text-[12.5px] font-semibold text-white">{verification.overall_status}</p>
                  <p className="text-[12px] leading-relaxed text-mist">{verification.source}</p>
                  {verification.warnings?.length > 0 && (
                    <div className="border-t border-graphite-700 pt-2.5">
                      <p className="mono-label">DECLARED WARNINGS ({verification.warnings.length})</p>
                      <ul className="mt-1.5 space-y-1.5">
                        {verification.warnings.map((w) => (
                          <li key={w} className="flex gap-2 text-[11.5px] leading-relaxed text-mist">
                            <CircleSlash size={12} className="mt-1 shrink-0 text-warn" />
                            <span>{w}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </Card.Body>
          </Card>
        </div>

        <SectionHeader
          eyebrow="COMPONENT INVENTORY"
          title="Every component the backend declares"
          description="GET /api/aurora/status · wording taken verbatim from the backend's own status vocabulary."
        />

        <Card>
          <Card.Body className="scrollbar-thin overflow-x-auto p-0">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="border-b border-graphite-600">
                  <th className="th">Component</th>
                  <th className="th">Status</th>
                  <th className="th">Reported detail</th>
                </tr>
              </thead>
              <tbody>
                {status.loading && (
                  <tr>
                    <td className="td" colSpan={3}>
                      <LoadingState label="Reading component status" compact />
                    </td>
                  </tr>
                )}
                {status.error && (
                  <tr>
                    <td className="td" colSpan={3}>
                      <ErrorState title="Status unavailable" message={status.error.message} compact />
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.label} className="border-b border-graphite-700 last:border-0">
                    <td className="td text-[13px] font-medium text-white">{r.label}</td>
                    <td className="td">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 text-[11.5px] font-semibold',
                          r.status === 'READY' ? 'text-safe' : r.status === 'INTEGRATION READY' ? 'text-ice' : 'text-warn'
                        )}
                      >
                        {r.status === 'READY' ? <CheckCircle2 size={13} /> : <CircleSlash size={13} />}
                        {r.status}
                      </span>
                    </td>
                    <td className="td text-[11.5px] text-mist">{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card.Body>
        </Card>

        <Notice tone="warn" icon={Boxes} title="No model on this page is being re-trained or re-run live">
          Checkpoints are present and loadable, but the raw 2026 multi-channel inference inputs are
          not in this deployment, so ConvLSTM inference is not re-run by the API and the metrics
          above are the checkpoints' own recorded training values. Every number shown here was
          returned by the backend — none was computed in the browser.
        </Notice>

        <div className="flex flex-wrap items-center gap-4 pb-2 font-mono text-[11px] text-steel">
          <span className="inline-flex items-center gap-1.5">
            <Waves size={12} /> /api/sic/status
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Snowflake size={12} /> /api/icebergs/status
          </span>
          <span className="inline-flex items-center gap-1.5">
            <RouteIcon size={12} /> /api/layers/status
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Boxes size={12} /> /api/models/ensemble
          </span>
          <span className="ml-auto">prototype · not for navigation</span>
        </div>
      </div>
    </div>
  )
}

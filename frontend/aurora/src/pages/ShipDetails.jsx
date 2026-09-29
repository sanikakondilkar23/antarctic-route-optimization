import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Anchor,
  ArrowRight,
  CheckCircle2,
  CircleSlash,
  Compass,
  Gauge,
  MapPin,
  Navigation,
  Radar,
  RefreshCw,
  Route as RouteIcon,
  Ship,
  Snowflake,
  Waves,
} from 'lucide-react'
import PageHeader, { MetaItem } from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { ErrorState, LoadingState } from '../components/ui/Status'
import { MetricCard, Notice, Row, SectionHeader } from '../components/ui/Panels'
import {
  fetchAuroraStatus,
  fetchIcebergStatus,
  fetchLayersStatus,
  fetchVerifiedRoute,
} from '../lib/auroraApi'

/**
 * /ship-details - vessel context for the operational route.
 *
 * This deployment publishes no vessel registry, no AIS feed and no telemetry,
 * so nothing about a ship is invented here. What the page does show is exactly
 * what the backend returns: the route leg the optimiser was asked to solve,
 * the vessel parameters the cost map was configured with (draft), the cost
 * terms in force, and the re-planning status of the committed route. Every
 * other vessel field is printed as "Data unavailable" or "Not connected".
 *
 * Reads from: GET /api/route, GET /api/layers/status, GET /api/aurora/status,
 * GET /api/icebergs/status. No endpoint is added or assumed.
 */

const UNAVAILABLE = 'Data unavailable'
const NOT_CONNECTED = 'Not connected'

const fmtLatLon = (pair, digits = 2) =>
  Array.isArray(pair) && pair.length === 2 && pair.every((n) => Number.isFinite(n))
    ? `${pair[0].toFixed(digits)}°, ${pair[1].toFixed(digits)}°`
    : null

/** The operational chain, annotated with what this deployment actually serves. */
const WORKFLOW = [
  ['Ship', 'Vessel identity, position and AIS', false, 'No AIS feed is connected'],
  ['Position / destination', 'Route leg endpoints', true, 'GET /api/route · leg'],
  ['Environmental conditions', 'SIC and forecast timestep', true, 'GET /api/sic/* · GET /api/layers/status'],
  ['Optimized route', 'A* over the real SIC field', true, 'POST /api/route/optimize'],
  ['Route monitoring', 'Compare original vs re-planned', true, 'jaccard · coverage · changed cells'],
  ['Dynamic rerouting', 'Re-plan on a later timestep', true, 'POST /api/route/reroute'],
  ['Updated route', 'Drawn beside the original', true, 'reroute.updated_route'],
]

export default function ShipDetails() {
  const [route, setRoute] = useState({ data: null, error: null, loading: true })
  const [layers, setLayers] = useState({ data: null, error: null, loading: true })
  const [status, setStatus] = useState({ data: null, error: null, loading: true })
  const [iceberg, setIceberg] = useState({ data: null, error: null, loading: true })
  const [refreshedAt, setRefreshedAt] = useState(null)

  const load = useCallback(async () => {
    const [r, l, s, i] = await Promise.allSettled([
      fetchVerifiedRoute(),
      fetchLayersStatus(0),
      fetchAuroraStatus(),
      fetchIcebergStatus(),
    ])
    const apply = (setter) => (res) =>
      setter(
        res.status === 'fulfilled'
          ? { data: res.value, error: null, loading: false }
          : { data: null, error: res.reason, loading: false }
      )
    apply(setRoute)(r)
    apply(setLayers)(l)
    apply(setStatus)(s)
    apply(setIceberg)(i)
    setRefreshedAt(new Date().toISOString().slice(11, 19))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const leg = route.data?.leg ?? null
  const weights = layers.data?.cost_weights ?? layers.data?.cost_breakdown?.weights ?? null
  const terms = layers.data?.cost_breakdown?.terms ?? []
  const ais = layers.data?.datasets?.ais ?? null
  const reroute = route.data?.dynamic_rerouting ?? null
  const anyLoading = route.loading || layers.loading

  const draftM = weights?.vessel_draft_m
  const activeWeights = weights
    ? Object.entries(weights).filter(([k, v]) => k !== 'vessel_draft_m' && Number(v) > 0)
    : []

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-5 p-4 md:p-6">
        <PageHeader
          title="Ship Details"
          subtitle="Vessel context for the operational route. This deployment publishes no vessel registry, no AIS feed and no telemetry, so no position, identity, speed or ETA is shown — only the values the backend actually returns."
          meta={
            <>
              <MetaItem label="AIS / TELEMETRY" value={ais?.configured ? 'configured' : NOT_CONNECTED} />
              <MetaItem label="ROUTE LEG" value={leg?.name ?? '—'} />
              <MetaItem
                label="ROUTE STATUS"
                value={route.loading ? '…' : route.data?.success ? 'RESOLVED' : route.error ? 'unavailable' : '—'}
              />
              <MetaItem label="SYNC" value={refreshedAt ? `${refreshedAt} UTC` : '—'} />
            </>
          }
          actions={
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={load} disabled={anyLoading}>
                <RefreshCw size={14} className={anyLoading ? 'animate-spin' : ''} /> Refresh
              </Button>
              <Link to="/routes" className="btn-primary !rounded-lg !px-4 !py-2 !text-[13px]">
                <RouteIcon size={14} /> Plan route
              </Link>
            </div>
          }
        />

        {/* ---------------------------------------------------------- */}
        {/* Integration banner                                          */}
        {/* ---------------------------------------------------------- */}
        <Notice tone="warn" icon={Anchor} title="No vessel tracking is connected">
          {ais ? (
            <>
              <span className="font-mono text-white">GET /api/layers/status</span> reports the{' '}
              <span className="font-mono text-white">ais</span> layer as{' '}
              <strong>{ais.configured ? 'configured' : 'not configured'}</strong>.{' '}
              {ais.configured
                ? ais.path
                : 'No AIS dataset is reachable from this deployment, so vessel positions, identity, speed, heading and ETA are all shown as unavailable rather than estimated.'}
              {ais.dataset_location && (
                <span className="mt-1 block text-steel">Expected location: {ais.dataset_location}</span>
              )}
            </>
          ) : (
            'Reading the AIS dataset status from GET /api/layers/status.'
          )}
        </Notice>

        {/* ---------------------------------------------------------- */}
        {/* Profile · navigation · parameters                           */}
        {/* ---------------------------------------------------------- */}
        <SectionHeader
          eyebrow="VESSEL"
          title="Profile, navigation and vessel parameters"
          description="Fields this deployment does not hold are printed as “Data unavailable” — never filled with a plausible-looking number."
        />

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <Card.Header title="Vessel profile" icon={Ship} />
            <Card.Body>
              <dl>
                <Row k="Vessel name" v={UNAVAILABLE} tone="text-warn" />
                <Row k="Vessel type" v={UNAVAILABLE} tone="text-warn" />
                <Row k="IMO / MMSI" v={UNAVAILABLE} tone="text-warn" />
                <Row k="Flag / registration" v={UNAVAILABLE} tone="text-warn" />
                <Row k="Operational status" v={NOT_CONNECTED} tone="text-warn" />
                <Row k="Last AIS update" v={UNAVAILABLE} tone="text-warn" />
              </dl>
              <p className="mt-3 border-t border-graphite-700 pt-2.5 text-[11px] leading-relaxed text-steel">
                No vessel registry or AIS feed is served by this backend, so identity and status
                fields stay empty by design.
              </p>
            </Card.Body>
          </Card>

          <Card>
            <Card.Header title="Navigation" icon={Navigation} />
            <Card.Body>
              {anyLoading ? (
                <LoadingState label="Reading route leg" compact />
              ) : route.error ? (
                <ErrorState
                  title="Route unavailable"
                  message={route.error.message ?? String(route.error)}
                  onRetry={load}
                  compact
                />
              ) : leg ? (
                <dl>
                  <Row k="Route leg" v={leg.name} />
                  <Row k="Origin" v={fmtLatLon(leg.start_latlon)} />
                  <Row k="Destination" v={fmtLatLon(leg.goal_latlon)} />
                  <Row
                    k="Route status"
                    v={route.data?.success ? 'RESOLVED' : 'FAILED'}
                    tone={route.data?.success ? 'text-safe' : 'text-danger'}
                  />
                  <Row k="Current position" v={UNAVAILABLE} tone="text-warn" />
                  <Row k="Destination ETA" v={UNAVAILABLE} tone="text-warn" />
                  <Row k="Vessel heading" v={UNAVAILABLE} tone="text-warn" />
                </dl>
              ) : (
                <p className="text-[12px] leading-relaxed text-warn">
                  No baseline route is published by this deployment.
                </p>
              )}
              <p className="mt-3 border-t border-graphite-700 pt-2.5 text-[11px] leading-relaxed text-steel">
                Origin and destination come from the committed route artifact
                <span className="font-mono text-mist"> GET /api/route</span>; a live vessel position
                would require an AIS feed that is not connected.
              </p>
            </Card.Body>
          </Card>

          <Card>
            <Card.Header title="Vessel parameters" icon={Gauge} />
            <Card.Body>
              <dl>
                <Row
                  k="Draft"
                  v={draftM != null ? `${draftM} m` : UNAVAILABLE}
                  tone={draftM != null ? 'text-ice' : 'text-warn'}
                />
                <Row k="Length (LOA)" v={UNAVAILABLE} tone="text-warn" />
                <Row k="Beam" v={UNAVAILABLE} tone="text-warn" />
                <Row k="Speed" v={UNAVAILABLE} tone="text-warn" />
                <Row k="Ice class" v={UNAVAILABLE} tone="text-warn" />
                <Row k="Crew" v={UNAVAILABLE} tone="text-warn" />
              </dl>
              <p className="mt-3 border-t border-graphite-700 pt-2.5 text-[11px] leading-relaxed text-steel">
                {draftM != null ? (
                  <>
                    Draft is the one vessel parameter the backend carries: it is server
                    configuration (<span className="font-mono text-mist">vessel_draft_m</span>)
                    used by the cost map, reported by{' '}
                    <span className="font-mono text-mist">GET /api/layers/status</span>.
                  </>
                ) : (
                  'No vessel parameter is published by this deployment.'
                )}
              </p>
            </Card.Body>
          </Card>
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Environmental context                                       */}
        {/* ---------------------------------------------------------- */}
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <Card.Header
              title="Environmental context"
              subtitle="GET /api/layers/status — which layers reach the cost map, and why the rest do not"
              icon={Waves}
            />
            <Card.Body>
              {layers.loading ? (
                <LoadingState label="Reading cost weights" compact />
              ) : layers.error ? (
                <ErrorState
                  title="Layer status unavailable"
                  message={layers.error.message ?? String(layers.error)}
                  onRetry={load}
                  compact
                />
              ) : (
                <>
                  <dl>
                    <Row
                      k="Terms in force"
                      v={terms.length ? terms.join(', ') : 'none'}
                      tone={terms.length ? 'text-safe' : 'text-warn'}
                    />
                    {weights &&
                      Object.entries(weights)
                        .filter(([k]) => k !== 'vessel_draft_m')
                        .map(([k, v]) => (
                          <Row
                            key={k}
                            k={k}
                            v={v}
                            tone={Number(v) > 0 ? 'text-ice' : 'text-steel'}
                          />
                        ))}
                    <Row
                      k="Wind / current / depth"
                      v={['w_wind', 'w_curr', 'w_depth'].every((k) => Number(weights?.[k]) > 0)
                        ? 'active'
                        : 'DATA UNAVAILABLE'}
                      tone="text-warn"
                    />
                  </dl>
                  <p className="mt-3 border-t border-graphite-700 pt-2.5 text-[11px] leading-relaxed text-steel">
                    Iceberg risk is not an input:{' '}
                    <span className="font-mono text-mist">w_ice</span> is{' '}
                    <span className="text-white">{weights?.w_ice ?? '—'}</span> and the backend
                    reports{' '}
                    <span className="font-mono text-mist">route_consumes_iceberg_risk = </span>
                    <span className="text-white">
                      {String(iceberg.data?.route_consumes_iceberg_risk ?? '—')}
                    </span>
                    .
                  </p>
                </>
              )}
            </Card.Body>
          </Card>

          <Card>
            <Card.Header
              title="Route status"
              subtitle="GET /api/route — the committed baseline artifact"
              icon={RouteIcon}
              action={route.data ? <Badge value={route.data.success ? 'RESOLVED' : 'FAILED'} /> : null}
            />
            <Card.Body>
              {route.loading && <LoadingState label="Reading route artifact" compact />}
              {route.error && (
                <ErrorState
                  title="Baseline route unavailable"
                  message={route.error.message ?? String(route.error)}
                  onRetry={load}
                  compact
                />
              )}
              {route.data && (
                <>
                  <dl>
                    <Row k="Algorithm" v={route.data.algorithm} />
                    <Row k="Waypoints" v={route.data.waypoints} />
                    <Row
                      k="Length"
                      v={
                        route.data.route_length_grid_units != null
                          ? `${route.data.route_length_grid_units.toFixed(1)} grid units`
                          : null
                      }
                    />
                    <Row k="Total cost" v={route.data.total_cost?.toFixed?.(3)} />
                    <Row k="Data" v={route.data.data} />
                    <Row k="Source" v={route.data.source} />
                  </dl>
                  <p className="mt-3 overflow-x-auto whitespace-nowrap border-t border-graphite-700 pt-2.5 font-mono text-[10px] text-steel">
                    {route.data.algorithm}
                  </p>
                </>
              )}
            </Card.Body>
          </Card>
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Route monitoring · dynamic rerouting                        */}
        {/* ---------------------------------------------------------- */}
        <SectionHeader
          eyebrow="ROUTE MONITORING · DYNAMIC REROUTING"
          title="Re-planning status reported by the backend"
          description="GET /api/route → dynamic_rerouting. The re-plan runs on the server against a later forecast timestep; the fields below are its own report, including its own warning that the committed demo artifact is synthetic."
        />

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Re-plan"
            value={reroute ? (reroute.reroute_replan_success ? 'SUCCESS' : 'FAILED') : null}
            state={reroute ? (reroute.reroute_replan_success ? 'ok' : 'bad') : 'unavailable'}
            note="POST /api/route/reroute"
          />
          <MetricCard
            label="Forecast step"
            value={reroute?.reroute_forecast_step ?? null}
            state={reroute?.reroute_forecast_step != null ? 'ok' : 'unavailable'}
            note="timestep the route was re-planned for"
          />
          <MetricCard
            label="Jaccard overlap"
            value={reroute?.divergence?.jaccard_overlap?.toFixed?.(3) ?? null}
            state={reroute?.divergence?.jaccard_overlap != null ? 'ok' : 'unavailable'}
            note="original vs re-planned corridor"
          />
          <MetricCard
            label="Waypoints before → after"
            value={
              reroute?.waypoints_before != null && reroute?.waypoints_after != null
                ? `${reroute.waypoints_before} → ${reroute.waypoints_after}`
                : null
            }
            state={reroute?.waypoints_before != null ? 'ok' : 'unavailable'}
            note="changed segments reported by the API"
          />
        </div>

        {reroute?.committed_demo_artifact_is_synthetic && (
          <Notice tone="warn" icon={CircleSlash} title="Committed re-plan artifact is synthetic">
            The backend flags this re-plan as{' '}
            <span className="font-mono text-white">committed_demo_artifact_is_synthetic: true</span>{' '}
            with <span className="font-mono text-white">decision_source: </span>
            <span className="font-mono text-white">{reroute.decision_source}</span>. It is shown
            because the API published it, and it is not presented as a live operational re-plan.
          </Notice>
        )}

        {/* ---------------------------------------------------------- */}
        {/* Workflow                                                    */}
        {/* ---------------------------------------------------------- */}
        <SectionHeader
          eyebrow="OPERATIONAL WORKFLOW"
          title="From vessel to updated route"
          description="Each step is marked with the endpoint that serves it. Steps the backend does not serve stay marked as not connected."
        />

        <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {WORKFLOW.map(([title, body, ok, endpoint], i) => (
            <li
              key={title}
              className="flex flex-col border border-graphite-600 bg-graphite-850 p-4"
            >
              <div className="flex items-center justify-between">
                <span className="num text-[22px] font-bold leading-none text-ice/70">
                  {`0${i + 1}`}
                </span>
                {ok ? (
                  <CheckCircle2 size={15} className="text-safe" />
                ) : (
                  <CircleSlash size={15} className="text-warn" />
                )}
              </div>
              <h3 className="mt-3 text-[13px] font-semibold uppercase tracking-[0.09em] text-white">
                {title}
              </h3>
              <p className="mt-1.5 flex-1 text-[12px] leading-relaxed text-mist">{body}</p>
              <p
                className={`mt-3 border-t pt-2 font-mono text-[10px] leading-relaxed ${
                  ok ? 'border-graphite-700 text-steel' : 'border-warn/25 text-warn'
                }`}
              >
                {endpoint}
              </p>
            </li>
          ))}
        </ol>

        {/* ---------------------------------------------------------- */}
        {/* Cross links                                                 */}
        {/* ---------------------------------------------------------- */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['/navigation', MapPin, 'Chart room', 'Route, coastline and the real SIC raster'],
            ['/routes', RouteIcon, 'Route optimization', 'Plan and re-plan the operational route'],
            ['/sea-ice', Waves, 'Sea-ice intelligence', 'Independent SIC forecast module'],
            ['/icebergs', Snowflake, 'Iceberg intelligence', 'Independent SAR detection module'],
          ].map(([to, Icon, title, hint]) => (
            <Link
              key={to}
              to={to}
              className="group flex items-center gap-3 border border-graphite-600 bg-graphite-850 px-4 py-3 transition hover:border-ice/50 hover:bg-graphite-800"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-graphite-600 bg-graphite-950 text-ice">
                <Icon size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-white">{title}</span>
                <span className="block truncate text-[11px] text-mist">{hint}</span>
              </span>
              <ArrowRight size={15} className="shrink-0 text-steel transition group-hover:translate-x-0.5 group-hover:text-ice" />
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4 pb-2 font-mono text-[11px] text-steel">
          <span className="inline-flex items-center gap-1.5">
            <Compass size={12} /> GET /api/route
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Gauge size={12} /> GET /api/layers/status
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Radar size={12} /> GET /api/aurora/status
          </span>
          <span className="ml-auto">prototype · not for navigation</span>
        </div>
      </div>
    </div>
  )
}

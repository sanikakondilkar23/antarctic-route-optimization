import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowUpRight,
  Compass,
  Grid3x3,
  Layers,
  MapPinned,
  RefreshCw,
  Route as RouteIcon,
  Ruler,
  Snowflake,
} from 'lucide-react'
import PageHeader, { MetaItem } from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { ErrorState, LoadingState } from '../components/ui/Status'
import { Notice, Row, SectionHeader } from '../components/ui/Panels'
import AntarcticMap from '../components/map/AntarcticMap'
import SicLegend from '../components/sic/SicLegend'
import useSicForecast from '../hooks/useSicForecast'
import {
  fetchAuroraStatus,
  fetchIcebergStatus,
  fetchLayersStatus,
  fetchVerifiedRoute,
  pathToLatLngs,
} from '../lib/auroraApi'
import { useCoastline, useLayersStatus } from '../lib/hooks'
import { cn } from '../lib/utils'

/**
 * /navigation - the chart room.
 *
 * One Antarctic map is the whole page: the real SIC raster over the Natural
 * Earth coastline, the committed baseline route on top of it, and a right-hand
 * rail that says what this map can and cannot tell you. Nothing is placed on
 * the map that the backend has not georeferenced - iceberg detections are
 * pixel-space only and are therefore deliberately absent from the chart.
 */

const LAYER_TOGGLES = [
  { key: 'showSicRaster', label: 'Sea-ice concentration', icon: Layers },
  { key: 'showCoastline', label: 'Coastline', icon: MapPinned },
  { key: 'showGraticule', label: 'Graticule', icon: Grid3x3 },
  { key: 'showStations', label: 'Stations', icon: Compass },
]

function Toggle({ active, onClick, icon: Icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-[11.5px] font-medium transition',
        active
          ? 'border-ice/45 bg-ice/[0.1] text-white'
          : 'border-graphite-600 bg-graphite-850 text-mist hover:border-graphite-500 hover:text-white'
      )}
    >
      <Icon size={13} className={active ? 'text-ice' : 'text-steel'} />
      {children}
    </button>
  )
}

function RailSection({ title, icon: Icon, action, children }) {
  return (
    <Card>
      <Card.Header title={title} icon={Icon} action={action} />
      <Card.Body className="space-y-1.5">{children}</Card.Body>
    </Card>
  )
}

export default function Navigation() {
  const sic = useSicForecast()
  const meta = sic.metadata
  const coastline = useCoastline()
  const layers = useLayersStatus(sic.timestep)

  const [verified, setVerified] = useState({ data: null, error: null, loading: true })
  const [status, setStatus] = useState({ data: null, error: null, loading: true })
  const [iceberg, setIceberg] = useState({ data: null, error: null, loading: true })

  const [showSicRaster, setShowSicRaster] = useState(true)
  const [showCoastline, setShowCoastline] = useState(true)
  const [showGraticule, setShowGraticule] = useState(true)
  const [showStations, setShowStations] = useState(true)

  const load = async () => {
    const [v, s, i] = await Promise.allSettled([
      fetchVerifiedRoute(),
      fetchAuroraStatus(),
      fetchIcebergStatus(),
    ])
    setVerified(
      v.status === 'fulfilled'
        ? { data: v.value, error: null, loading: false }
        : v.reason?.status === 404
          ? { data: null, error: null, loading: false }
          : { data: null, error: v.reason, loading: false }
    )
    setStatus(
      s.status === 'fulfilled'
        ? { data: s.value, error: null, loading: false }
        : { data: null, error: s.reason, loading: false }
    )
    setIceberg(
      i.status === 'fulfilled'
        ? { data: i.value, error: null, loading: false }
        : { data: null, error: i.reason, loading: false }
    )
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const frame = sic.active
  const sicRaster =
    showSicRaster && frame?.available
      ? { url: frame.url, bounds: frame.bounds, label: `SIC ${frame.date}` }
      : null

  const routeLine = useMemo(() => {
    if (!verified.data?.path || !meta) return null
    return pathToLatLngs(meta, verified.data.path)
  }, [verified.data, meta])

  const endpoints = useMemo(() => {
    const leg = verified.data?.leg
    if (!leg?.start_latlon || !leg?.goal_latlon) return []
    return [
      { lat: leg.start_latlon[0], lon: leg.start_latlon[1], kind: 'origin', label: 'route start' },
      { lat: leg.goal_latlon[0], lon: leg.goal_latlon[1], kind: 'destination', label: 'route goal' },
    ]
  }, [verified.data])

  const env = status.data?.data ?? {}
  const weights = layers.data?.cost_breakdown?.weights ?? null
  const terms = layers.data?.cost_breakdown?.terms ?? []
  const frameLoading = sic.status === 'loading' || (frame?.reason === 'Loading...')

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-[1560px] space-y-5 p-4 md:p-6">
        <PageHeader
          title="Navigation"
          subtitle="The Southern Ocean theatre as this deployment can actually chart it: the committed sea-ice field over the Natural Earth coastline, with the repository's verified baseline route on top."
          meta={
            <>
              <MetaItem label="GRID" value={meta ? `${meta.n_rows}×${meta.n_cols}` : '—'} />
              <MetaItem
                label="RESOLUTION"
                value={meta?.resolution_deg != null ? `${meta.resolution_deg}°` : '—'}
              />
              <MetaItem label="FORECAST DAYS" value={meta?.n_timesteps ?? sic.nTimesteps ?? '—'} />
              <MetaItem label="RASTER" value={sicRaster ? sic.date ?? '—' : 'not shown'} />
            </>
          }
          actions={
            <Button variant="secondary" onClick={load}>
              <RefreshCw size={14} /> Refresh
            </Button>
          }
        />

        {/* ---------------------------------------------------------- */}
        {/* Map                                                        */}
        {/* ---------------------------------------------------------- */}
        <div className="grid gap-4 xl:grid-cols-12">
          <div className="xl:col-span-9">
            <Card className="overflow-hidden">
              <Card.Header
                title="Southern Ocean chart"
                subtitle={
                  sicRaster
                    ? `Real SIC raster · ${sic.date} · ${frame?.legend?.units ?? ''}`
                    : showSicRaster
                      ? 'SIC raster layer unavailable'
                      : 'SIC raster layer switched off'
                }
                icon={Compass}
                action={
                  <div className="flex items-center gap-2">
                    <select
                      className="select w-auto font-mono text-[11px]"
                      value={sic.timestep}
                      onChange={(e) => sic.setTimestep(Number(e.target.value))}
                      disabled={!sic.dates?.length}
                      aria-label="Forecast date"
                    >
                      {!sic.dates?.length && <option value={0}>loading…</option>}
                      {(sic.dates ?? []).map((d, i) => (
                        <option key={d} value={i}>
                          D+{i} · {d}
                        </option>
                      ))}
                    </select>
                    <Badge
                      value={frameLoading ? 'LOADING' : sicRaster ? 'REAL' : 'UNAVAILABLE'}
                      tone={frameLoading ? 'neutral' : sicRaster ? 'ok' : 'warn'}
                    />
                  </div>
                }
              />

              <div className="flex flex-wrap gap-2 border-b border-graphite-600 px-4 py-2.5">
                {LAYER_TOGGLES.map(({ key, label, icon }) => (
                  <Toggle
                    key={key}
                    icon={icon}
                    active={
                      key === 'showSicRaster'
                        ? showSicRaster
                        : key === 'showCoastline'
                          ? showCoastline
                          : key === 'showGraticule'
                            ? showGraticule
                            : showStations
                    }
                    onClick={() => {
                      if (key === 'showSicRaster') setShowSicRaster((v) => !v)
                      if (key === 'showCoastline') setShowCoastline((v) => !v)
                      if (key === 'showGraticule') setShowGraticule((v) => !v)
                      if (key === 'showStations') setShowStations((v) => !v)
                    }}
                  >
                    {label}
                  </Toggle>
                ))}
                <span className="ml-auto self-center font-mono text-[10px] uppercase tracking-[0.12em] text-steel">
                  {showSicRaster ? 'raster drawn only where the API marks cells valid' : 'raster hidden'}
                </span>
              </div>

              <div className="p-3">
                <AntarcticMap
                  height={560}
                  meta={meta}
                  coastline={coastline}
                  showBaseTiles
                  showCoastline={showCoastline}
                  showGraticule={showGraticule}
                  showStations={showStations}
                  sicRaster={sicRaster}
                  routeLine={routeLine}
                  routeLabel="Committed baseline route (artifact)"
                  endpoints={endpoints}
                  className="border border-graphite-600"
                />
              </div>

              <div className="border-t border-graphite-600 px-4 py-3">
                {sicRaster ? (
                  <SicLegend legend={frame?.legend} stats={frame?.stats} />
                ) : (
                  <p className="text-[11px] leading-relaxed text-warn">
                    {frame?.reason && frame.reason !== 'Loading...'
                      ? `SIC unavailable: ${frame.reason}`
                      : 'The concentration field is not being drawn - no placeholder replaces it.'}
                  </p>
                )}
              </div>
            </Card>

            <Notice tone="warn" icon={Snowflake} title="Iceberg detections are not plotted here" className="mt-3">
              The SAR YOLOv8 detector reports every detection in{' '}
              <span className="font-semibold text-white">pixel space</span>. The source tiles were
              written as plain PNGs without a CRS or geotransform, so the backend reports{' '}
              <span className="font-semibold text-warn">GEOREFERENCING UNAVAILABLE</span>
              {iceberg.data?.coordinate_space && (
                <>
                  {' '}
                  (coordinate space:{' '}
                  <span className="font-mono text-white">{iceberg.data.coordinate_space}</span>)
                </>
              )}
              . Until that is fixed, no detection has a latitude/longitude and none can be drawn on
              a chart, added to the cost map, or used to steer a route.
            </Notice>
          </div>

          {/* -------------------------------------------------------- */}
          {/* Right rail                                                */}
          {/* -------------------------------------------------------- */}
          <div className="space-y-4 xl:col-span-3">
            <RailSection
              title="Situation"
              icon={Layers}
              action={
                <Badge
                  value={frameLoading ? 'LOADING' : sicRaster ? 'REAL' : 'UNAVAILABLE'}
                  tone={frameLoading ? 'neutral' : sicRaster ? 'ok' : 'warn'}
                />
              }
            >
              {frameLoading && <LoadingState label="Reading frame" compact />}
              {!frameLoading && !frame?.available && (
                <ErrorState title="Frame unavailable" message={frame?.reason ?? 'Unavailable'} compact />
              )}
              {!frameLoading && frame?.available && (
                <dl>
                  <Row k="Forecast date" v={frame.date} />
                  <Row k="Timestep" v={`D+${sic.timestep}`} />
                  <Row
                    k="Mean SIC"
                    v={frame.stats?.mean != null ? `${(frame.stats.mean * 100).toFixed(1)}%` : null}
                  />
                  <Row
                    k="Max SIC"
                    v={frame.stats?.max != null ? `${(frame.stats.max * 100).toFixed(1)}%` : null}
                  />
                  <Row k="Legend units" v={frame.legend?.units} />
                </dl>
              )}
            </RailSection>

            <RailSection
              title="Baseline route"
              icon={RouteIcon}
              action={
                verified.data ? (
                  <Badge
                    value={verified.data.success ? 'RESOLVED' : 'FAILED'}
                    tone={verified.data.success ? 'ok' : 'bad'}
                  />
                ) : null
              }
            >
              {verified.loading && <LoadingState label="Reading route artifact" compact />}
              {verified.error && (
                <ErrorState title="Route unavailable" message={verified.error.message} compact />
              )}
              {verified.data && (
                <dl>
                  <Row k="Leg" v={verified.data.leg?.name} />
                  <Row k="Waypoints" v={verified.data.waypoints} />
                  <Row
                    k="Length"
                    v={
                      verified.data.route_length_km != null
                        ? `${verified.data.route_length_km.toLocaleString()} km`
                        : verified.data.route_length_grid_units != null
                          ? `${verified.data.route_length_grid_units.toFixed(1)} grid units`
                          : null
                    }
                  />
                  <Row k="Total cost" v={verified.data.total_cost?.toFixed?.(3)} />
                  <Row k="Drawn on chart" v={routeLine?.length ? `${routeLine.length} points` : 'no'} />
                </dl>
              )}
              {!verified.loading && !verified.error && !verified.data && (
                <p className="text-[12px] leading-relaxed text-mist">
                  No baseline route is published by this deployment.
                </p>
              )}
              <Link
                to="/routes"
                className="mt-2 inline-flex items-center gap-1.5 border border-graphite-500 bg-graphite-750 px-2.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-graphite-700"
              >
                Plan a route <ArrowUpRight size={13} className="text-ice" />
              </Link>
            </RailSection>

            <RailSection
              title="Cost layers in force"
              icon={Ruler}
              action={
                <Badge
                  value={layers.loading ? '…' : terms.length ? 'READY' : '—'}
                  tone={terms.length ? 'ok' : 'neutral'}
                />
              }
            >
              {layers.loading && <LoadingState label="Reading layer status" compact />}
              {layers.error && (
                <ErrorState title="Layer status unavailable" message={layers.error.message} compact />
              )}
              {layers.data && (
                <dl>
                  <Row k="Requested layers" v={layers.data.cost_layers_requested?.join(', ')} />
                  <Row
                    k="In the cost"
                    v={terms.length ? terms.join(', ') : 'none'}
                    tone={terms.length ? 'text-safe' : 'text-warn'}
                  />
                  {weights && (
                    <>
                      <Row k="w_sic" v={weights.w_sic} />
                      <Row k="w_distance" v={weights.w_distance} />
                      <Row k="w_wind" v={weights.w_wind} tone={weights.w_wind > 0 ? '' : 'text-warn'} />
                      <Row k="w_curr" v={weights.w_curr} tone={weights.w_curr > 0 ? '' : 'text-warn'} />
                      <Row k="w_depth" v={weights.w_depth} tone={weights.w_depth > 0 ? '' : 'text-warn'} />
                      <Row k="w_unc" v={weights.w_unc} tone={weights.w_unc > 0 ? '' : 'text-warn'} />
                      <Row
                        k="Vessel draft"
                        v={weights.vessel_draft_m != null ? `${weights.vessel_draft_m} m` : null}
                      />
                    </>
                  )}
                  <Row k="Cells omitted (sic)" v={layers.data.cost_breakdown?.omitted_cells?.sic} />
                </dl>
              )}
            </RailSection>

            <RailSection title="Environmental layers" icon={Layers}>
              {status.loading && <LoadingState label="Reading component status" compact />}
              {status.error && (
                <ErrorState title="Status unavailable" message={status.error.message} compact />
              )}
              {status.data && (
                <dl>
                  {['wind', 'current', 'water'].map((k) => (
                    <Row
                      key={k}
                      k={k === 'water' ? 'Water / bathymetry' : k[0].toUpperCase() + k.slice(1)}
                      v={env[k]?.status}
                      tone={env[k]?.available ? 'text-safe' : 'text-warn'}
                    />
                  ))}
                </dl>
              )}
              <p className="border-t border-graphite-700 pt-2 text-[11px] leading-relaxed text-mist">
                Unavailable layers carry cost weight 0.0 and therefore have no influence on any
                route drawn above.
              </p>
            </RailSection>
          </div>
        </div>

        <SectionHeader
          eyebrow="WHAT THIS CHART IS"
          title="Sourced from this repository's own artifacts"
          description="Coastline: Natural Earth via /api/map/coastline — context only, never a cost input. Graticule, station markers and the SIC raster are built from the axes served by /api/sic/metadata. The route is the committed artifact from /api/route."
        />

        <div className="pb-2 font-mono text-[11px] text-steel">
          Map context only · prototype · not for navigation
        </div>
      </div>
    </div>
  )
}

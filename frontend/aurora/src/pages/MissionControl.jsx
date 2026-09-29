import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layers, Route as RouteIcon, ChevronRight } from 'lucide-react'
import AntarcticMap from '../components/map/AntarcticMap'
import { FloatPanel, LayerRow, SicLegend, CoordReadout, LineLegend } from '../components/map/MapUi'
import Badge from '../components/ui/Badge'
import { ErrorState, LoadingState } from '../components/ui/Status'
import { fetchVerifiedRoute, pathToLatLngs } from '../lib/auroraApi'
import { useCoastline, useLayersStatus, useMetadata, useSicRaster, useUncertaintyRaster } from '../lib/hooks'

/** Layers offered on the chart, with the status the API reports for each. */
const LAYER_ROWS = [
  { key: 'base', label: 'Base map', kind: 'static' },
  { key: 'coastline', label: 'Coastline (Natural Earth)', kind: 'static' },
  { key: 'graticule', label: 'Graticule 10°', kind: 'static' },
  { key: 'stations', label: 'Stations & staging port', kind: 'static' },
  { key: 'sic_mean', label: 'Sea-ice concentration', kind: 'grid' },
  { key: 'sic_uncertainty', label: 'SIC forecast uncertainty', kind: 'grid' },
  { key: 'route', label: 'Committed baseline route', kind: 'static' },
  { key: 'iceberg_risk', label: 'Iceberg risk', kind: 'grid' },
  { key: 'wind_cost', label: 'Wind cost', kind: 'grid' },
  { key: 'current_uo', label: 'Ocean current (uo)', kind: 'grid' },
]

export default function MissionControl() {
  const meta = useMetadata()
  const coastline = useCoastline()

  const [timestep, setTimestep] = useState(0)
  const layers = useLayersStatus(timestep)

  const [verified, setVerified] = useState({ data: null, error: null, loading: true })
  useEffect(() => {
    let cancelled = false
    fetchVerifiedRoute()
      .then((data) => !cancelled && setVerified({ data, error: null, loading: false }))
      .catch((error) => !cancelled && setVerified({ data: null, error, loading: false }))
    return () => {
      cancelled = true
    }
  }, [])

  const [on, setOn] = useState({
    base: true,
    coastline: true,
    graticule: true,
    stations: true,
    sic_mean: true,
    sic_uncertainty: false,
    route: true,
    iceberg_risk: false,
    wind_cost: false,
    current_uo: false,
  })
  const toggle = (k) => setOn((s) => ({ ...s, [k]: !s[k] }))

  const sic = useSicRaster(timestep, meta.data, { enabled: on.sic_mean })
  const unc = useUncertaintyRaster(timestep, 0, meta.data, { enabled: on.sic_uncertainty })

  const [cursor, setCursor] = useState(null)

  const layerStatus = useMemo(() => {
    const map = {}
    for (const l of layers.data?.layers ?? []) map[l.name] = l
    return map
  }, [layers.data])

  const routeLine = useMemo(() => {
    if (!on.route || !verified.data?.path || !meta.data) return null
    return pathToLatLngs(meta.data, verified.data.path)
  }, [on.route, verified.data, meta.data])

  const endpoints = useMemo(() => {
    const leg = verified.data?.leg
    if (!leg?.start_latlon || !leg?.goal_latlon) return []
    return [
      { lat: leg.start_latlon[0], lon: leg.start_latlon[1], kind: 'origin', label: 'route start' },
      { lat: leg.goal_latlon[0], lon: leg.goal_latlon[1], kind: 'destination', label: 'route goal' },
    ]
  }, [verified.data])

  const dates = meta.data?.dates ?? []
  const weights = layers.data?.cost_weights ?? null
  const counts = layers.data
    ? {
        real: layers.data.real?.length ?? 0,
        partial: layers.data.partial?.length ?? 0,
        unavailable: layers.data.not_available?.length ?? 0,
      }
    : null

  return (
    <div className="relative h-full overflow-y-auto lg:overflow-hidden">
      <div className="relative h-[56vh] min-h-[340px] w-full lg:absolute lg:inset-0 lg:h-full">
        <AntarcticMap
          className="absolute inset-0"
          meta={meta.data}
          coastline={on.coastline ? coastline : null}
          showBaseTiles={on.base}
          showCoastline={on.coastline}
          showGraticule={on.graticule}
          showStations={on.stations}
          sicRaster={on.sic_mean ? sic : null}
          uncertaintyRaster={on.sic_uncertainty ? unc : null}
          uncertaintyOpacity={0.5}
          routeLine={routeLine}
          routeLabel="Committed baseline route (artifact)"
          endpoints={on.route ? endpoints : []}
          onCursor={setCursor}
        />
        {sic.loading && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-[500] -translate-x-1/2 border border-graphite-600 bg-graphite-850 px-3 py-1.5">
            <span className="mono-label">DECODING SIC FRAME…</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 p-2 lg:contents">
        {/* ---------------------------------------------------------- */}
        {/* Left: layer stack + forecast date                           */}
        {/* ---------------------------------------------------------- */}
        <FloatPanel
          title="Map layers"
          action={<Layers size={13} className="text-steel" />}
          className="lg:absolute lg:left-3 lg:top-3 lg:z-10 lg:w-[272px]"
        >
          <div className="space-y-1.5">
            {LAYER_ROWS.map((row) => {
              if (row.kind === 'static') {
                return (
                  <LayerRow
                    key={row.key}
                    checked={on[row.key]}
                    onChange={() => toggle(row.key)}
                    label={row.label}
                  />
                )
              }
              const info = layerStatus[row.key]
              const status = info?.status ?? (layers.loading ? '…' : 'UNKNOWN')
              const unavailable = status === 'NOT_AVAILABLE' || status === 'NOT_CONNECTED'
              return (
                <LayerRow
                  key={row.key}
                  checked={on[row.key] && !unavailable}
                  onChange={() => toggle(row.key)}
                  label={row.label}
                  status={status}
                  note={unavailable ? 'Not served by this deployment' : info?.reason}
                  disabled={unavailable}
                />
              )
            })}
          </div>

          <div className="mt-3 border-t border-graphite-700 pt-2.5">
            <label className="input-label" htmlFor="mc-date">
              Forecast date
            </label>
            <select
              id="mc-date"
              className="select font-mono text-[12px]"
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
            <p className="mt-1.5 text-[10.5px] leading-snug text-steel">
              Frames come from <span className="font-mono">GET /api/sic/{'{t}'}</span>. Cells outside
              the valid domain render transparent and are never navigable.
            </p>
          </div>
        </FloatPanel>

        {/* ---------------------------------------------------------- */}
        {/* Right: mission snapshot + baseline route                    */}
        {/* ---------------------------------------------------------- */}
        <FloatPanel
          title="Mission snapshot"
          className="lg:absolute lg:right-3 lg:top-3 lg:z-10 lg:w-[330px]"
          bodyClass="px-3 py-2.5 lg:max-h-[calc(100vh-190px)] lg:overflow-y-auto scrollbar-thin"
        >
          <dl className="space-y-1.5">
            <Row k="Grid" v={meta.data ? `${meta.data.n_rows} × ${meta.data.n_cols} @ ${meta.data.resolution_deg}°` : '—'} />
            <Row k="Latitude span" v={meta.data ? `${meta.data.lat_range[0]}° → ${meta.data.lat_range[1]}°` : '—'} />
            <Row k="Longitude span" v={meta.data ? `${meta.data.lon_range[0]}° → ${meta.data.lon_range[1]}°` : '—'} />
            <Row k="Forecast window" v={meta.data ? `${meta.data.dates[0]} → ${meta.data.dates.at(-1)}` : '—'} />
            <Row k="Frame date" v={sic.date ?? (layers.data?.date ?? '—')} />
            <Row k="Land mask" v={layers.data?.land_mask ?? '—'} />
          </dl>

          <div className="mt-3 border-t border-graphite-700 pt-2.5">
            <p className="mono-label mb-1.5">Layer availability</p>
            {counts ? (
              <div className="flex flex-wrap gap-1.5">
                <Badge value="REAL" />
                <span className="num text-[12px] text-white">{counts.real}</span>
                <Badge value="PARTIAL" />
                <span className="num text-[12px] text-white">{counts.partial}</span>
                <Badge value="NOT AVAILABLE" />
                <span className="num text-[12px] text-white">{counts.unavailable}</span>
              </div>
            ) : (
              <span className="text-[11.5px] text-mist">{layers.loading ? 'reading…' : 'unavailable'}</span>
            )}
          </div>

          <div className="mt-3 border-t border-graphite-700 pt-2.5">
            <p className="mono-label mb-1.5">Active cost weights</p>
            {weights ? (
              <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px]">
                {Object.entries(weights)
                  .filter(([k]) => k !== 'vessel_draft_m')
                  .map(([k, v]) => (
                    <span key={k} className="flex items-center justify-between gap-2">
                      <span className={Number(v) > 0 ? 'text-white/85' : 'text-steel'}>{k}</span>
                      <span className={Number(v) > 0 ? 'text-ice' : 'text-steel'}>{v}</span>
                    </span>
                  ))}
              </div>
            ) : (
              <span className="text-[11.5px] text-mist">{layers.loading ? 'reading…' : 'unavailable'}</span>
            )}
          </div>
        </FloatPanel>

        {/* ---------------------------------------------------------- */}
        {/* Lower left: baseline route readout                          */}
        {/* ---------------------------------------------------------- */}
        <FloatPanel
          title="Committed baseline route"
          className="lg:absolute lg:left-3 lg:bottom-10 lg:z-20 lg:w-[272px]"
          bodyClass="px-3 py-2.5"
        >
          {verified.loading && <span className="text-[11.5px] text-mist">reading artifact…</span>}
          {verified.error && (
            <p className="text-[11.5px] leading-snug text-danger">{verified.error.message}</p>
          )}
          {verified.data && (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="num text-[12.5px] text-white">{verified.data.leg?.name ?? '—'}</span>
                <Badge value={verified.data.success ? 'RESOLVED' : 'FAILED'} tone={verified.data.success ? 'ok' : 'bad'} />
              </div>
              <dl className="mt-2 space-y-1">
                <Row k="Waypoints (cells)" v={verified.data.waypoints} />
                <Row k="Length (grid units)" v={verified.data.route_length_grid_units?.toFixed?.(2) ?? '—'} />
                <Row k="Mean SIC on route" v="not published by GET /api/route" mono={false} muted />
                <Row k="Total cost" v={verified.data.total_cost?.toFixed?.(3) ?? '—'} />
              </dl>
              <p className="mt-2 text-[10.5px] leading-snug text-steel">
                Source: <span className="font-mono">{verified.data.source}</span> ·{' '}
                <span className="font-mono">{verified.data.algorithm}</span>
              </p>
              <Link
                to="/route-planner"
                className="mt-2.5 inline-flex items-center gap-1.5 border border-graphite-500 bg-graphite-750 px-2.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-graphite-700"
              >
                <RouteIcon size={13} className="text-ice" /> Plan a new route
                <ChevronRight size={13} />
              </Link>
            </>
          )}
        </FloatPanel>

        {/* ---------------------------------------------------------- */}
        {/* Lower right: legend + cursor                                */}
        {/* ---------------------------------------------------------- */}
        <FloatPanel
          title="Legend"
          className="lg:absolute lg:right-3 lg:bottom-3 lg:z-10 lg:w-[330px]"
        >
          <LineLegend
            items={[
              { label: 'Committed baseline route', color: '#A8CFE6' },
              { label: 'Station / staging port marker', color: '#A8CFE6', width: 2 },
            ]}
          />
          {on.sic_mean && <SicLegend className="mt-2.5 border-t border-graphite-700 pt-2.5" />}
          <div className="mt-2.5 border-t border-graphite-700 pt-2">
            <CoordReadout cursor={cursor} />
          </div>
        </FloatPanel>
      </div>

      {meta.error && (
        <div className="p-3 lg:absolute lg:left-1/2 lg:top-1/2 lg:z-20 lg:w-[420px] lg:-translate-x-1/2 lg:-translate-y-1/2">
          <ErrorState
            title="Grid metadata unavailable"
            message={meta.error.message}
            className="shadow-overlay"
          />
        </div>
      )}
      {meta.loading && !meta.data && (
        <div className="p-3 lg:absolute lg:left-1/2 lg:top-1/2 lg:z-20 lg:w-[320px] lg:-translate-x-1/2 lg:-translate-y-1/2">
          <LoadingState label="Loading grid metadata" className="shadow-overlay" />
        </div>
      )}
    </div>
  )
}

function Row({ k, v, muted = false, mono = true }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-[11.5px] text-mist">{k}</dt>
      <dd
        className={`truncate text-right text-[12px] ${mono ? 'num' : ''} ${
          muted ? 'text-steel' : 'text-white/90'
        }`}
        title={String(v ?? '')}
      >
        {v ?? '—'}
      </dd>
    </div>
  )
}

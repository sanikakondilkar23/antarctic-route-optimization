import { MapContainer, TileLayer, Marker, Popup, CircleMarker, Polyline, Tooltip, ImageOverlay, useMap } from 'react-leaflet'
import L from 'leaflet'
import {
  STATIONS,
  ships,
  icebergs,
  icebergTrajectories,
  seaIcePatches,
  routePolylinesByCorridor,
  windVectors,
  oceanCurrents,
} from '../../data'

function ReCenter({ center, zoom }) {
  const map = useMap()
  if (center) map.setView(center, zoom ?? map.getZoom())
  return null
}

function icon(color, size = 10) {
  return L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;background:${color};border-radius:50%;border:2px solid rgba(255,255,255,0.7);box-shadow:0 0 10px ${color}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function stationIcon(type) {
  const isPort = type === 'port'
  const color = isPort ? '#FBBF24' : '#34D399'
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;background:rgba(3,15,27,0.85);border:2px solid ${color};border-radius:8px;box-shadow:0 0 12px ${color}66">
      <div style="width:8px;height:8px;background:${color};border-radius:2px"></div>
    </div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  })
}

function vesselIcon(status) {
  const c = {
    'En Route': '#38BDF8',
    Monitoring: '#FBBF24',
    'At Station': '#34D399',
    Alert: '#F87171',
  }[status] ?? '#38BDF8'
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;background:rgba(10,37,64,0.9);border:2px solid ${c};border-radius:50%;box-shadow:0 0 12px ${c}88">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="${c}">
        <path d="M12 2L19 21L12 17L5 21L12 2Z"/>
      </svg>
    </div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

function windIcon(speed, direction) {
  const color = speed >= 45 ? '#F87171' : speed >= 32 ? '#FBBF24' : '#38BDF8'
  return L.divIcon({
    className: '',
    html: `<div style="transform:rotate(${direction}deg);width:26px;height:26px;display:flex;align-items:center;justify-content:center;pointer-events:auto;" title="${speed} kn">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style="filter:drop-shadow(0 0 4px ${color});">
        <path d="M12 2L12 22M12 2L6 8M12 2L18 8" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

function currentIcon(speed, direction) {
  return L.divIcon({
    className: '',
    html: `<div style="transform:rotate(${direction}deg);width:22px;height:22px;display:flex;align-items:center;justify-content:center;">
      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" style="filter:drop-shadow(0 0 3px #22D3EE);">
        <path d="M10 2L10 18M10 2L5 7M10 2L15 7" stroke="#22D3EE" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="10" cy="10" r="2" fill="#7DD3FC"/>
      </svg>
    </div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  })
}

const COLORS = {
  berg: '#22D3EE',
  high: '#F87171',
  warn: '#FBBF24',
  low: '#34D399',
  station: '#E0F7FF',
}

/**
 * Real sea-ice concentration raster, served by the SIC API as a PNG and drawn
 * with Leaflet's own projection. `sicRaster` is `{ url, bounds }` where bounds
 * is [[north, west], [south, east]] straight from the API's grid metadata, so
 * the client performs no lat/lon maths of its own.
 *
 * When this is supplied it replaces the illustrative `seaIcePatches` bubbles
 * entirely. When it is absent the original bubbles are drawn unchanged, so
 * every other page keeps working exactly as before.
 */
function SicRasterLayer({ url, bounds, opacity = 0.85, label = 'Sea-ice concentration' }) {
  if (!url || !bounds) return null
  return (
    <ImageOverlay
      key={url}
      url={url}
      bounds={bounds}
      opacity={opacity}
      interactive={false}
      alt={label}
    />
  )
}

export default function AntarcticMap({
  center = [-66, 45],
  zoom = 3,
  height = '100%',
  showRoutes = true,
  activeRoute = null,
  activeCorridor = 'Cape Town → Bharati Research Station',
  customPolylines = null,
  highlightShip = null,
  highlightIceberg = null,
  sicRaster = null,
  sicRasterOpacity = 0.85,
  layers = {
    vessels: true,
    icebergs: true,
    stations: true,
    routes: true,
    seaIce: true,
    wind: false,
    oceanCurrents: false,
    trajectories: false,
  },
  className = '',
  children,
}) {
  const routeKey = activeRoute ?? 'opt-lowice'
  const focus = highlightShip ? [highlightShip.lat, highlightShip.lon] : highlightIceberg ? [highlightIceberg.lat, highlightIceberg.lon] : null

  // Determine which routes polylines to display
  const polylinesToRender = customPolylines || routePolylinesByCorridor[activeCorridor] || routePolylinesByCorridor['Cape Town → Bharati Research Station'] || {}

  return (
    <MapContainer
      center={center}
      zoom={zoom}
      minZoom={2}
      maxZoom={8}
      className={`rounded-2xl border border-white/5 ${className}`}
      style={{ height, width: '100%' }}
      worldCopyJump
    >
      <TileLayer
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />

      {focus && <ReCenter center={focus} zoom={5} />}

      {/* Sea ice: real ConvLSTM raster when supplied, illustrative patches otherwise */}
      {layers.seaIce && sicRaster && (
        <SicRasterLayer
          url={sicRaster.url}
          bounds={sicRaster.bounds}
          opacity={sicRasterOpacity}
          label={sicRaster.label}
        />
      )}

      {layers.seaIce && !sicRaster && seaIcePatches.map((p, i) => {
        const isCompact = p.concentration >= 80
        const isClose = p.concentration >= 60 && p.concentration < 80
        const isOpen = p.concentration >= 30 && p.concentration < 60
        const fillColor = isCompact ? 'rgba(255,255,255,0.7)' : isClose ? 'rgba(169,232,255,0.5)' : isOpen ? 'rgba(56,189,248,0.35)' : 'rgba(15,76,122,0.35)'
        const strokeColor = isCompact ? 'rgba(255,255,255,0.9)' : isClose ? 'rgba(169,232,255,0.7)' : 'rgba(56,189,248,0.5)'

        return (
          <CircleMarker
            key={`ice-${i}`}
            center={[p.lat, p.lon]}
            radius={Math.max(14, p.concentration / 3.0)}
            pathOptions={{
              color: strokeColor,
              fillColor: fillColor,
              fillOpacity: 0.6,
              weight: 1.5,
            }}
          >
            <Tooltip>
              <div className="text-xs space-y-0.5">
                <p className="font-bold text-cyan">Sea-ice: {p.concentration}% ({p.level || 'Pack Ice'})</p>
                <p className="text-[11px] text-mist">{p.stage || 'First-year ice'} · ~{p.thicknessCm || 80} cm</p>
              </div>
            </Tooltip>
          </CircleMarker>
        )
      })}

      {/* Simulated Ocean currents layer */}
      {layers.oceanCurrents && oceanCurrents.map((c) => (
        <Marker key={c.id} position={[c.lat, c.lon]} icon={currentIcon(c.speed, c.direction)}>
          <Tooltip>
            <div className="text-xs">
              <p className="font-semibold text-cyan">{c.name}</p>
              <p className="text-[11px] text-mist">Velocity: <span className="text-white font-mono">{c.speed} kn</span> @ {c.direction}°</p>
              <p className="text-[11px] text-mist">SST: <span className="text-white font-mono">{c.temp}°C</span></p>
            </div>
          </Tooltip>
        </Marker>
      ))}

      {/* Simulated Wind vectors layer */}
      {layers.wind && windVectors.map((w) => (
        <Marker key={w.id} position={[w.lat, w.lon]} icon={windIcon(w.speed, w.direction)}>
          <Tooltip>
            <div className="text-xs">
              <p className="font-semibold text-warn">Wind: {w.speed} kn {w.dirText} ({w.direction}°)</p>
              <p className="text-[11px] text-mist">Gusts: <span className="text-white font-mono">{w.gust} kn</span> · Beaufort {w.beaufort}</p>
              <p className="text-[11px] text-mist">Air Temp: <span className="text-white font-mono">{w.temp}°C</span> · {w.zone}</p>
            </div>
          </Tooltip>
        </Marker>
      ))}

      {/* Research stations */}
      {layers.stations && STATIONS.map((s) => (
        <Marker key={s.id} position={[s.lat, s.lon]} icon={stationIcon(s.type)}>
          <Popup>
            <div className="min-w-[190px]">
              <p className="font-bold text-white text-sm">{s.name}</p>
              <p className="text-xs text-cyan font-medium">{s.country} · {s.type === 'port' ? 'Staging Port' : 'Permanent Research Station'}</p>
              <p className="mt-1 text-[11px] font-mono text-mist">{s.lat.toFixed(4)}°S  {Math.abs(s.lon).toFixed(4)}°E</p>
            </div>
          </Popup>
        </Marker>
      ))}

      {/* Vessels */}
      {layers.vessels && ships.map((ship) => {
        const isFocused = highlightShip && ship.id === highlightShip.id
        return (
          <Marker
            key={ship.id}
            position={[ship.lat, ship.lon]}
            icon={isFocused ? icon('#FFFFFF', 20) : vesselIcon(ship.status)}
          >
            <Popup>
              <div className="min-w-[210px]">
                <div className="flex items-center justify-between border-b border-white/10 pb-1.5 mb-1.5">
                  <p className="font-bold text-white text-sm">{ship.name}</p>
                  <span className="text-[10px] font-semibold text-cyan uppercase">{ship.status}</span>
                </div>
                <div className="space-y-1 text-[11px] text-mist">
                  <p>Heading / Speed: <span className="text-white font-mono">{ship.heading}° / {ship.speed} kn</span></p>
                  <p>Fuel onboard: <span className="text-white font-mono">{ship.fuel}%</span> (~{ship.fuelRange} km)</p>
                  <p>Destination: <span className="text-cyan font-medium">{ship.destination}</span></p>
                  <p>Ice hazard: <span className={ship.iceRisk === 'High' ? 'text-danger font-bold' : ship.iceRisk === 'Moderate' ? 'text-warn font-semibold' : 'text-safe font-semibold'}>{ship.iceRisk}</span></p>
                  <p className="text-[10px] text-mist/70 pt-1">Coordinates: {ship.lat.toFixed(2)}°S, {Math.abs(ship.lon).toFixed(2)}°E</p>
                </div>
              </div>
            </Popup>
          </Marker>
        )
      })}

      {/* Icebergs */}
      {layers.icebergs && icebergs.map((b) => {
        const isHighlight = highlightIceberg && highlightIceberg.id === b.id
        const riskColor = b.risk === 'Critical' ? COLORS.high : b.risk === 'High' ? COLORS.high : b.risk === 'Moderate' ? COLORS.warn : COLORS.low
        const rad = ((b.bearingDeg || 90) * Math.PI) / 180
        const driftEndLat = b.lat + Math.cos(rad) * b.speed * 0.35
        const driftEndLon = b.lon + Math.sin(rad) * b.speed * 0.7

        return (
          <div key={b.id}>
            <CircleMarker
              center={[b.lat, b.lon]}
              radius={isHighlight ? 12 : b.risk === 'Critical' ? 10 : b.risk === 'High' ? 8 : 6}
              pathOptions={{
                color: isHighlight ? '#FFFFFF' : riskColor,
                fillColor: COLORS.berg,
                fillOpacity: 0.85,
                weight: isHighlight ? 3 : 2,
              }}
            >
              <Popup>
                <div className="min-w-[210px]">
                  <div className="flex items-center justify-between border-b border-white/10 pb-1.5 mb-1.5">
                    <p className="font-bold text-white text-sm">{b.id}</p>
                    <span className="text-[10px] font-semibold text-cyan px-2 py-0.5 rounded-full bg-cyan/10">{b.risk} Risk</span>
                  </div>
                  <div className="space-y-1 text-[11px] text-mist">
                    <p>Drift Speed: <span className="text-white font-mono">{b.speed} kn {b.direction}</span> ({b.bearingDeg || 0}°)</p>
                    <p>Surface Area: <span className="text-white font-mono">{b.areaKm2.toLocaleString()} km²</span></p>
                    {b.thicknessM && <p>Estimated Thickness: <span className="text-white font-mono">{b.thicknessM} m</span></p>}
                    <p>Origin: <span className="text-white">{b.origin}</span></p>
                    <p>Route clearance: <span className="text-warn font-semibold">{b.distanceToRoute} km</span></p>
                  </div>
                </div>
              </Popup>
            </CircleMarker>

            {/* Iceberg drift vector arrow line */}
            <Polyline
              positions={[[b.lat, b.lon], [driftEndLat, driftEndLon]]}
              pathOptions={{ color: '#22D3EE', weight: 2.5, dashArray: '3 4', opacity: 0.9 }}
            />
          </div>
        )
      })}

      {/* Trajectories (Historical + Forecast Cone) */}
      {(layers.trajectories || highlightIceberg) && icebergTrajectories.map((t) => {
        if (highlightIceberg && t.id !== highlightIceberg.id) return null
        return (
          <div key={`traj-${t.id}`}>
            {/* Historical track */}
            <Polyline
              positions={t.points.map((p) => [p.lat, p.lon])}
              pathOptions={{ color: '#38BDF8', weight: 3, dashArray: '5 6', opacity: 0.8 }}
            >
              <Tooltip><span className="text-xs">{t.id} historical drift track</span></Tooltip>
            </Polyline>

            {/* Forward forecast path */}
            {t.forecast && (
              <Polyline
                positions={[
                  [t.points[t.points.length - 1].lat, t.points[t.points.length - 1].lon],
                  ...t.forecast.map((f) => [f.lat, f.lon]),
                ]}
                pathOptions={{ color: '#F87171', weight: 3, dashArray: '4 4', opacity: 0.9 }}
              >
                <Tooltip><span className="text-xs">{t.id} projected +24h / +48h drift path</span></Tooltip>
              </Polyline>
            )}

            {/* Forward forecast markers */}
            {t.forecast?.map((f, fi) => (
              <CircleMarker
                key={`fc-${fi}`}
                center={[f.lat, f.lon]}
                radius={fi === 0 ? 5 : 7}
                pathOptions={{ color: '#F87171', fillColor: '#F87171', fillOpacity: 0.9, weight: 1.5 }}
              >
                <Tooltip><span className="text-xs">{t.id} {f.t} forecasted position</span></Tooltip>
              </CircleMarker>
            ))}
          </div>
        )
      })}

      {/* Navigation routes */}
      {showRoutes && layers.routes && Object.entries(polylinesToRender).map(([id, pts]) => {
        const isSelected = id === routeKey
        const color = isSelected ? '#38BDF8' : 'rgba(148,163,184,0.45)'
        const label = id.replace('opt-', '').replace('-', ' ').toUpperCase()

        return (
          <Polyline
            key={id}
            positions={pts}
            pathOptions={{
              color: color,
              weight: isSelected ? 4 : 2,
              dashArray: isSelected ? undefined : '6 8',
              opacity: isSelected ? 1 : 0.6,
            }}
          >
            <Tooltip>
              <div className="text-xs font-semibold">
                <span className={isSelected ? 'text-cyan' : 'text-mist'}>{label} ROUTE</span>
              </div>
            </Tooltip>
          </Polyline>
        )
      })}

      {children}
    </MapContainer>
  )
}
import { useEffect, useMemo, useState, useRef } from 'react'
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  Tooltip,
  ImageOverlay,
  GeoJSON,
  Circle,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import L from 'leaflet'
import {
  Maximize2,
  Minimize2,
  Compass,
  Navigation,
  Anchor,
  Layers,
  RotateCcw,
  ZoomIn,
  ZoomOut,
  MapPin,
  AlertTriangle,
  Eye,
  Crosshair,
  Globe,
  Snowflake,
} from 'lucide-react'
import { STATIONS } from '../../data'
import { TRACKED_ICEBERGS } from '../../data/icebergs'
import { EPSG3031, project3031, unproject3031 } from '../../lib/crs'
import coastlineFallback from '../../data/coastline.json'

/* ------------------------------------------------------------------ */
/* Geographic framing helpers (EPSG:3031)                             */
/* ------------------------------------------------------------------ */

function latLonBoxBounds(latMin, latMax, lonMin, lonMax) {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  const consume = (lon, lat) => {
    const [x, y] = project3031(lon, lat)
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  for (let lat = latMin; lat <= latMax + 1e-6; lat += 2) {
    for (let lon = lonMin; lon <= lonMax + 1e-6; lon += 5) consume(lon, lat)
  }
  const nw = unproject3031(minX, maxY)
  const se = unproject3031(maxX, minY)
  return L.latLngBounds([
    [nw[1], nw[0]],
    [se[1], se[0]],
  ])
}

const GLOBE_BOUNDS = () => latLonBoxBounds(-90, -30, -180, 180)
const ANTARCTICA_BOUNDS = () => latLonBoxBounds(-90, -60, -180, 180)
const CORRIDOR_BOUNDS = () => latLonBoxBounds(-78, -30, 10, 85)

/* ------------------------------------------------------------------ */
/* Great Circle spherical slerp helper (Samira corridor track)        */
/* ------------------------------------------------------------------ */
function greatCirclePoints(from, to, segments = 64) {
  const toRad = Math.PI / 180
  const toDeg = 180 / Math.PI
  const [lat1, lon1] = from
  const [lat2, lon2] = to

  const phi1 = lat1 * toRad
  const lam1 = lon1 * toRad
  const phi2 = lat2 * toRad
  const lam2 = lon2 * toRad

  const p = [Math.cos(phi1) * Math.cos(lam1), Math.cos(phi1) * Math.sin(lam1), Math.sin(phi1)]
  const q = [Math.cos(phi2) * Math.cos(lam2), Math.cos(phi2) * Math.sin(lam2), Math.sin(phi2)]

  let dot = p[0] * q[0] + p[1] * q[1] + p[2] * q[2]
  dot = Math.max(-1, Math.min(1, dot))
  const omega = Math.acos(dot)
  const sinOmega = Math.sin(omega)

  const points = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    let x, y, z
    if (sinOmega > 1e-9) {
      const a = Math.sin((1 - t) * omega) / sinOmega
      const b = Math.sin(t * omega) / sinOmega
      x = a * p[0] + b * q[0]
      y = a * p[1] + b * q[1]
      z = a * p[2] + b * q[2]
    } else {
      x = p[0] + (q[0] - p[0]) * t
      y = p[1] + (q[1] - p[1]) * t
      z = p[2] + (q[2] - p[2]) * t
    }
    const lon = Math.atan2(y, x) * toDeg
    const lat = Math.asin(Math.max(-1, Math.min(1, z))) * toDeg
    points.push([lat, lon])
  }
  return points
}

/* ------------------------------------------------------------------ */
/* Basemap Presets                                                    */
/* ------------------------------------------------------------------ */
const BASEMAP_PRESETS = {
  dark: {
    id: 'dark',
    name: 'Nautical Dark Polar',
    base: null,
    attribution: '&copy; Aurora Polar Geodesy & Natural Earth (EPSG:3031)',
  },
  imagery: {
    id: 'imagery',
    name: 'Polar Satellite Imagery',
    base: 'https://services.arcgisonline.com/arcgis/rest/services/Polar/Antarctic_Imagery/MapServer/tile/{z}/{y}/{x}',
    maxNativeZoom: 14,
    attribution: '&copy; Esri, TerraColor 15m Polar Satellite Imagery (EPSG:3031)',
  },
}

/* ------------------------------------------------------------------ */
/* Nautical Grade Icons                                               */
/* ------------------------------------------------------------------ */
function icebergIcon(risk = 'HIGH') {
  const isCritical = risk === 'CRITICAL'
  const stroke = isCritical ? '#FF4560' : '#22E5F0'
  const fill = isCritical ? 'rgba(255, 69, 96, 0.25)' : 'rgba(34, 229, 240, 0.2)'
  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:28px;height:28px;display:flex;align-items:center;justify-content:center;">
        <div style="position:absolute;inset:0;border-radius:50%;border:1px dashed ${stroke};animation:spin 8s linear infinite;opacity:0.7;"></div>
        <div style="position:absolute;inset:2px;border-radius:50%;background:${fill};animation:ping 3s cubic-bezier(0,0,0.2,1) infinite;"></div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 0 6px ${stroke});">
          <polygon points="12,2 22,20 2,20" fill="rgba(7,29,51,0.92)" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" />
          <polygon points="12,7 18,18 6,18" fill="${stroke}" opacity="0.6" />
        </svg>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  })
}

function pinIcon(kind) {
  const isOrigin = kind === 'origin'
  const stroke = isOrigin ? '#22E5F0' : '#FFB020'
  const bg = isOrigin ? 'rgba(7, 29, 51, 0.95)' : 'rgba(30, 20, 10, 0.95)'
  const label = isOrigin ? 'ORIGIN' : 'GOAL'
  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;display:flex;flex-direction:column;align-items:center;">
        <div style="padding:2px 6px;border:1.5px solid ${stroke};background:${bg};border-radius:4px;font:700 9px/1.2 'Space Grotesk',sans-serif;color:${stroke};box-shadow:0 0 12px ${stroke}80;letter-spacing:0.05em;text-transform:uppercase;">
          ${label}
        </div>
        <div style="width:2px;height:8px;background:${stroke};"></div>
        <div style="width:8px;height:8px;border-radius:50%;background:#ffffff;border:2px solid ${stroke};box-shadow:0 0 8px ${stroke};"></div>
      </div>
    `,
    iconSize: [50, 36],
    iconAnchor: [25, 36],
  })
}

function shipIcon(heading = -25) {
  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;transform:rotate(${heading}deg);width:32px;height:32px;display:flex;align-items:center;justify-content:center;">
        <div style="position:absolute;inset:0;border-radius:50%;background:rgba(34,229,240,0.25);animation:ping 2s cubic-bezier(0,0,0.2,1) infinite;"></div>
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 0 6px rgba(34,229,240,0.8));">
          <path d="M14 2 L23 22 L14 18 L5 22 Z" fill="#0A2A4A" stroke="#22E5F0" stroke-width="1.8" stroke-linejoin="round" />
          <circle cx="14" cy="14" r="2.5" fill="#FFFFFF" />
        </svg>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  })
}

function stationMarkerIcon(s) {
  const isPort = s.type === 'port'
  const fill = isPort ? '#FFB020' : '#FFB300'
  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;display:flex;flex-direction:column;align-items:center;cursor:pointer;">
        <div style="width:11px;height:11px;border-radius:50%;background:${fill};border:1.5px solid #FFFFFF;box-shadow:0 0 8px ${fill};"></div>
        <div style="margin-top:2px;font:700 10.5px ui-monospace,SFMono-Regular,Menlo,monospace;color:#FFFFFF;text-shadow:0 0 3px #0A2A45, 0 0 6px #0A2A45, 0 0 9px #071D33;white-space:nowrap;pointer-events:none;">
          ${s.name}
        </div>
      </div>
    `,
    iconSize: [100, 32],
    iconAnchor: [50, 6],
  })
}

function PopupRow({ label, tone = 'text-white', children }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-mist">
      <span>{label}:</span>
      <span className={tone}>{children}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Interactive Map Controller                                         */
/* ------------------------------------------------------------------ */
function MapController({
  target,
  pickMode,
  onPick,
  onCursor,
  onZoomChange,
}) {
  const map = useMap()

  useMapEvents({
    click(e) {
      if (!pickMode) return
      onPick?.({ lat: e.latlng.lat, lon: e.latlng.lng })
    },
    mousemove(e) {
      onCursor?.({ lat: e.latlng.lat, lon: e.latlng.lng })
    },
    mouseout() {
      onCursor?.(null)
    },
    zoomend() {
      onZoomChange?.(map.getZoom())
    },
  })

  useEffect(() => {
    if (!target?.center) return
    map.setView(target.center, target.zoom ?? map.getZoom(), { animate: true, duration: 1.2 })
  }, [target?.nonce])

  return null
}

/* ------------------------------------------------------------------ */
/* Polar Graticule (Curved Parallels & Radials, Samira Port)           */
/* ------------------------------------------------------------------ */
function Graticule({ visible = true, opacity = 0.28 }) {
  const data = useMemo(() => {
    if (!visible) return null

    const parallels = []
    const meridians = []
    const labels = []

    // 1. Concentric circular parallels sampled along longitude every 3°
    const parallelLats = [-85, -80, -75, -70, -66.5, -60, -50, -40, -30]
    for (const lat of parallelLats) {
      const arc = []
      for (let lon = -180; lon <= 180; lon += 3) {
        arc.push([lat, lon])
      }
      arc.push([lat, 180])
      parallels.push({
        lat,
        isAntarcticCircle: lat === -66.5,
        positions: arc,
      })

      // Parallel labels at selected meridians
      if (lat % 10 === 0 || lat === -66.5) {
        const text = lat === -66.5 ? '66.5°S' : `${Math.abs(lat)}°S`
        labels.push({ lat, lon: 0, text, key: `lbl-lat-${lat}-0` })
        labels.push({ lat, lon: 40, text: `${Math.abs(lat)}°S`, key: `lbl-lat-${lat}-40` })
        labels.push({ lat, lon: 90, text: `${Math.abs(lat)}°S`, key: `lbl-lat-${lat}-90` })
      }
    }

    // 2. Meridians radiating from South Pole (-90°) to outer boundary (-30°)
    const meridianLons = [
      -180, -150, -120, -90, -60, -45, -30, -15, 0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 150
    ]
    for (const lon of meridianLons) {
      const radial = []
      for (let lat = -90; lat <= -30; lat += 2.5) {
        radial.push([lat, lon])
      }
      meridians.push({
        lon,
        positions: radial,
      })

      // Meridian label near outer boundary (-31.5°)
      const lonText =
        lon === 0 ? '0°' : lon === 180 || lon === -180 ? '180°' : `${Math.abs(lon)}°${lon > 0 ? 'E' : 'W'}`
      labels.push({ lat: -31.5, lon, text: lonText, key: `lbl-lon-${lon}` })
    }

    return { parallels, meridians, labels }
  }, [visible])

  if (!data) return null

  return (
    <>
      {data.parallels.map((p) => (
        <Polyline
          key={`par-${p.lat}`}
          positions={p.positions}
          pathOptions={{
            color: p.isAntarcticCircle ? '#38BDF8' : '#22E5F0',
            weight: p.isAntarcticCircle ? 1.4 : 1,
            opacity: p.isAntarcticCircle ? opacity * 1.4 : opacity,
            dashArray: p.isAntarcticCircle ? '6 4' : '3 6',
            interactive: false,
          }}
        />
      ))}

      {data.meridians.map((m) => (
        <Polyline
          key={`mer-${m.lon}`}
          positions={m.positions}
          pathOptions={{
            color: '#22E5F0',
            weight: 1,
            opacity: opacity,
            dashArray: '3 6',
            interactive: false,
          }}
        />
      ))}

      {data.labels.map((lbl) => (
        <Marker
          key={lbl.key}
          position={[lbl.lat, lbl.lon]}
          interactive={false}
          icon={L.divIcon({
            className: '',
            html: `
              <div style="font:600 10px ui-monospace, SFMono-Regular, Menlo, monospace; color:rgba(34,229,240,0.9); text-shadow:0 0 3px #0A2A45, 0 0 6px #0A2A45, 0 0 9px #071D33; white-space:nowrap; pointer-events:none; user-select:none; transform:translate(-50%, -50%);">
                ${lbl.text}
              </div>
            `,
            iconSize: [60, 16],
            iconAnchor: [30, 8],
          })}
        />
      ))}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Cape Town Reference Corridor & SIC Forecast Coverage Sector       */
/* ------------------------------------------------------------------ */
function CorridorOverlay({ visible = true, opacity = 1.0 }) {
  const tracks = useMemo(() => {
    if (!visible) return null

    // Great circle tracks from Cape Town to East Antarctic stations
    const ctToMaitri = greatCirclePoints([-33.9249, 18.4241], [-70.7664, 11.7339], 48)
    const ctToBharati = greatCirclePoints([-33.9249, 18.4241], [-69.3970, 76.2470], 48)

    // SIC Forecast Coverage sector (lat -50°S down to coast, lon -10° to 82°)
    const sicTopArc = []
    for (let lon = -10; lon <= 82; lon += 2) {
      sicTopArc.push([-50, lon])
    }
    sicTopArc.push([-50, 82])

    const sicCoverageBoundary = [
      ...sicTopArc,
      [-67, 82],
      [-70, 70],
      [-70, 40],
      [-70.5, 20],
      [-71, 0],
      [-71, -10],
      [-50, -10],
    ]

    return { ctToMaitri, ctToBharati, sicCoverageBoundary }
  }, [visible])

  if (!tracks) return null

  return (
    <>
      {/* Great circle reference tracks */}
      <Polyline
        positions={tracks.ctToMaitri}
        pathOptions={{
          color: '#5FB0DD',
          weight: 1.8,
          opacity: 0.5 * opacity,
          dashArray: '10 6',
          interactive: false,
        }}
      />
      <Polyline
        positions={tracks.ctToBharati}
        pathOptions={{
          color: '#5FB0DD',
          weight: 1.8,
          opacity: 0.5 * opacity,
          dashArray: '10 6',
          interactive: false,
        }}
      />

      {/* SIC Forecast Coverage Trapezoid */}
      <Polyline
        positions={tracks.sicCoverageBoundary}
        pathOptions={{
          color: '#FFFFFF',
          weight: 1.5,
          opacity: 0.65 * opacity,
          dashArray: '6 6',
          interactive: false,
        }}
      />

      {/* SIC Forecast Coverage Label */}
      <Marker
        position={[-50, 36]}
        interactive={false}
        icon={L.divIcon({
          className: '',
          html: `
            <div style="font:600 11px ui-monospace, SFMono-Regular, monospace; color:rgba(255,255,255,0.85); text-shadow:0 0 4px #0A2A45, 0 0 8px #071D33; white-space:nowrap; transform:translate(-50%, -120%); pointer-events:none;">
              SIC forecast coverage
            </div>
          `,
          iconSize: [160, 20],
          iconAnchor: [80, 10],
        })}
      />

      {/* Cape Town Port Marker */}
      <Marker
        position={[-33.9249, 18.4241]}
        icon={L.divIcon({
          className: '',
          html: `
            <div style="position:relative;display:flex;flex-direction:column;align-items:center;">
              <div style="width:12px;height:12px;border-radius:50%;background:#FFB020;border:2px solid #FFFFFF;box-shadow:0 0 10px #FFB020;"></div>
              <div style="margin-top:3px;font:700 11.5px ui-monospace,SFMono-Regular,monospace;color:#FFFFFF;text-shadow:0 0 4px #0A2A45, 0 0 8px #071D33;white-space:nowrap;">
                Cape Town
              </div>
            </div>
          `,
          iconSize: [90, 34],
          iconAnchor: [45, 6],
        })}
      >
        <Popup>
          <div className="font-sans text-xs">
            <p className="font-bold text-white">Port of Cape Town</p>
            <p className="text-[#FFB020] font-semibold">Expedition Departure Port & Staging Base</p>
            <p className="mt-1 font-mono text-[11px] text-mist">33.925°S, 18.424°E</p>
          </div>
        </Popup>
      </Marker>
    </>
  )
}

function getIcebergDriftVector(iceberg) {
  if (!iceberg.drift_speed_knots || !iceberg.drift_heading_deg) return null
  const headingRad = (iceberg.drift_heading_deg * Math.PI) / 180
  const distNm = iceberg.drift_speed_knots * 24
  const dLat = (distNm / 60) * Math.cos(headingRad)
  const dLon = ((distNm / 60) * Math.sin(headingRad)) / Math.cos((iceberg.lat * Math.PI) / 180)
  return [
    [iceberg.lat, iceberg.lon],
    [iceberg.lat + dLat, iceberg.lon + dLon],
  ]
}

function MapInstanceBridge({ onMap }) {
  const map = useMap()
  useEffect(() => {
    if (map) onMap(map)
  }, [map, onMap])
  return null
}

/* ------------------------------------------------------------------ */
/* Scale control — StrictMode-safe Leaflet control lifecycle           */
/* ------------------------------------------------------------------ */
/**
 * `L.Control#addTo(map)` assigns `control._map = map` BEFORE it calls
 * `control.onAdd(map)`. If `onAdd()` throws, the control is left half
 * attached — `_map` set but `_container` still undefined. React-Leaflet's
 * mount effect then runs again (StrictMode double-invoke, error-boundary
 * remount, page switch) and calls `addTo()` → `remove()` →
 * `DomUtil.remove(undefined)` → "Cannot read properties of undefined
 * (reading 'parentNode')".
 *
 * This wrapper owns exactly one control per map instance, refuses to attach a
 * control the CRS cannot support, rolls back a partially attached control,
 * and detaches defensively so cleanup can never touch an already-detached
 * container. One control, one map, idempotent add/remove.
 */
function ScaleControlSafe({
  position = 'bottomleft',
  metric = true,
  imperial = false,
  maxWidth = 100,
  updateWhenIdle = false,
}) {
  const map = useMap()

  useEffect(() => {
    if (!map) return undefined

    if (typeof map.options?.crs?.distance !== 'function') {
      console.error('[aurora] CRS has no distance(); scale control not attached')
      return undefined
    }

    const control = L.control.scale({ position, metric, imperial, maxWidth, updateWhenIdle })

    try {
      control.addTo(map)
    } catch (err) {
      control._map = null
      control._container = undefined
      console.error('[aurora] scale control attach failed:', err)
      return undefined
    }

    return () => {
      if (control._map && control._container) {
        control.remove()
      } else {
        // Already detached by Leaflet/map teardown — never touch the DOM.
        control._map = null
      }
    }
  }, [map, position, metric, imperial, maxWidth, updateWhenIdle])

  return null
}

/* ------------------------------------------------------------------ */
/* Quick Navigation HUD Toolbar (Matching Reference Screenshot)       */
/* ------------------------------------------------------------------ */
function NavigationToolbar({
  map,
  routeLine,
  endpoints,
  currentZoom,
  basemapKey,
  onBasemapChange,
  onToggleFullscreen,
  isFullscreen,
}) {
  const handleCorridor = () => {
    if (!map) return
    map.flyTo([-54, 38], 3, { duration: 1.2 })
  }

  const handleLocal = () => {
    if (!map) return
    if (routeLine && routeLine.length > 0) {
      map.flyTo(routeLine[0], 6, { duration: 1.2 })
    } else if (endpoints && endpoints.length > 0) {
      const orig = endpoints.find((e) => e.kind === 'origin') || endpoints[0]
      map.flyTo([orig.lat, orig.lon], 6, { duration: 1.2 })
    } else {
      map.flyTo([-33.9249, 18.4241], 6, { duration: 1.2 })
    }
  }

  const handlePolar = () => {
    if (!map) return
    map.flyTo([-90, 0], 3, { duration: 1.2 })
  }

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-[600]">
      <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-white/10 bg-[#05182B]/90 p-1 shadow-2xl backdrop-blur-xl">
        <button
          type="button"
          onClick={() => map?.zoomIn()}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-mist hover:bg-white/10 hover:text-white"
          title="Zoom In (+)"
        >
          <ZoomIn size={14} />
        </button>
        <button
          type="button"
          onClick={() => map?.zoomOut()}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-mist hover:bg-white/10 hover:text-white"
          title="Zoom Out (-)"
        >
          <ZoomOut size={14} />
        </button>

        <span className="mx-0.5 h-4 w-px bg-white/15" />

        <button
          type="button"
          onClick={handleCorridor}
          className="rounded-lg px-2.5 py-1 font-mono text-[11px] font-bold text-[#22E5F0] hover:bg-[#22E5F0]/15 transition"
          title="Frame Cape Town to East Antarctica Corridor"
        >
          CORRIDOR
        </button>
        <button
          type="button"
          onClick={handleLocal}
          className="rounded-lg px-2.5 py-1 font-mono text-[11px] font-semibold text-mist hover:bg-white/10 hover:text-white transition"
          title="Frame Local Vessel Position"
        >
          LOCAL
        </button>
        <button
          type="button"
          onClick={handlePolar}
          className="rounded-lg px-2.5 py-1 font-mono text-[11px] font-semibold text-mist hover:bg-white/10 hover:text-white transition"
          title="Frame Polar Overview"
        >
          POLAR
        </button>

        <span className="mx-0.5 h-4 w-px bg-white/15" />

        {/* Basemap switcher */}
        <div className="flex shrink-0 items-center gap-0.5">
          {Object.values(BASEMAP_PRESETS).map((bm) => (
            <button
              key={bm.id}
              type="button"
              onClick={() => onBasemapChange(bm.id)}
              title={bm.name}
              className={`rounded-lg px-2 py-1 font-mono text-[10.5px] transition ${
                basemapKey === bm.id
                  ? 'border border-[#22E5F0]/40 bg-[#22E5F0]/20 font-bold text-[#22E5F0]'
                  : 'text-mist hover:bg-white/5 hover:text-white'
              }`}
            >
              {bm.id === 'dark' ? 'Chart' : 'Satellite'}
            </button>
          ))}
        </div>

        <span className="mx-0.5 h-4 w-px bg-white/15" />

        <button
          type="button"
          onClick={onToggleFullscreen}
          title={isFullscreen ? 'Exit Fullscreen' : 'Expand Fullscreen'}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-mist hover:bg-white/10 hover:text-white"
        >
          {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Main AntarcticMap Component                                         */
/* ------------------------------------------------------------------ */
export default function AntarcticMap({
  center = [-54, 38],
  zoom = 3,
  className = '',
  style,
  meta = null,
  coastline = null,
  showCoastline = true,
  coastlineOpacity = 1.0,
  showGraticule = true,
  graticuleOpacity = 0.32,
  showCorridor = true,
  corridorOpacity = 1.0,
  showStations = true,
  showIcebergs = true,
  showBaseTiles = true,
  showWaypoints = true,
  sicRaster = null,
  sicOpacity = 0.75,
  uncertaintyRaster = null,
  uncertaintyOpacity = 0.6,
  routeLine = null,
  routeColor = '#22E5F0',
  routeLabel = 'Recommended route',
  priorLine = null,
  priorColor = '#6E7881',
  priorLabel = 'Previous route',
  altLine = null,
  altColor = '#FFB020',
  altLabel = 'Alternative route',
  endpoints = [],
  pickMode = null,
  onPick,
  onCursor,
  target = null,
  attribution = true,
  children,
}) {
  const containerRef = useRef(null)
  const [currentZoom, setCurrentZoom] = useState(zoom)
  const [basemapKey, setBasemapKey] = useState('dark')
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [mapInstance, setMapInstance] = useState(null)
  const [mouseCoord, setMouseCoord] = useState(null)

  const effectiveCoastline = coastline || coastlineFallback
  const activeBasemap = BASEMAP_PRESETS[basemapKey] || BASEMAP_PRESETS.dark

  const toggleFullscreen = () => {
    if (!containerRef.current) return
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().then(() => setIsFullscreen(true))
    } else {
      document.exitFullscreen?.().then(() => setIsFullscreen(false))
    }
  }

  useEffect(() => {
    const handleFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', handleFsChange)
    return () => document.removeEventListener('fullscreenchange', handleFsChange)
  }, [])

  // Vessel position along route or origin
  const shipPos = useMemo(() => {
    if (routeLine && routeLine.length > 0) return routeLine[0]
    if (endpoints && endpoints.length > 0) {
      const orig = endpoints.find((e) => e.kind === 'origin') || endpoints[0]
      return [orig.lat, orig.lon]
    }
    return [-33.9249, 18.4241]
  }, [routeLine, endpoints])

  const handleCursorMove = (c) => {
    setMouseCoord(c)
    onCursor?.(c)
  }

  return (
    <div ref={containerRef} className={`relative h-full w-full overflow-hidden ${className}`}>
      <MapContainer
        center={center}
        zoom={zoom}
        minZoom={1}
        maxZoom={12}
        crs={EPSG3031}
        zoomControl={false}
        className="h-full w-full"
        style={{
          zIndex: 0,
          height: '100%',
          width: '100%',
          backgroundColor: '#10355A',
          ...style,
        }}
        worldCopyJump={false}
        maxBoundsViscosity={1.0}
      >
        <MapInstanceBridge onMap={setMapInstance} />

        {/* Real Geographic Basemap in EPSG:3031 with noWrap to prevent horizontal repetition */}
        {showBaseTiles && activeBasemap.base && (
          <TileLayer
            key={`base-${activeBasemap.id}`}
            url={activeBasemap.base}
            maxNativeZoom={activeBasemap.maxNativeZoom || 11}
            maxZoom={12}
            noWrap={true}
            bounds={[[-90, -180], [-30, 180]]}
            attribution={attribution ? activeBasemap.attribution : ''}
          />
        )}

        <ScaleControlSafe imperial={false} position="bottomleft" />

        <MapController
          target={target}
          pickMode={pickMode}
          onPick={onPick}
          onCursor={handleCursorMove}
          onZoomChange={setCurrentZoom}
        />

        {/* Authoritative Natural Earth Antarctic & Cape Town Land (EPSG:3031) */}
        {showCoastline && effectiveCoastline && (
          <GeoJSON
            key="coastline"
            data={effectiveCoastline}
            interactive={false}
            style={() => ({
              color: '#3B362F',
              weight: 1.3,
              opacity: 0.95,
              fillColor: '#8C8275',
              fillOpacity: coastlineOpacity,
            })}
          />
        )}

        {/* Real SIC Forecast Raster Overlay */}
        {sicRaster?.url && sicRaster?.bounds && (
          <ImageOverlay
            key={`sic-${sicRaster.url.slice(-24)}`}
            url={sicRaster.url}
            bounds={sicRaster.bounds}
            opacity={sicOpacity}
            interactive={false}
            alt="Sea-ice concentration field"
          />
        )}

        {/* Conformal Uncertainty Raster Overlay */}
        {uncertaintyRaster?.url && uncertaintyRaster?.bounds && (
          <ImageOverlay
            key={`unc-${uncertaintyRaster.url.slice(-24)}`}
            url={uncertaintyRaster.url}
            bounds={uncertaintyRaster.bounds}
            opacity={uncertaintyOpacity}
            interactive={false}
            alt="Sea-ice forecast uncertainty"
          />
        )}

        {/* Polar Navigation Graticule (Smooth Concentric Parallels & Radials) */}
        <Graticule visible={showGraticule} opacity={graticuleOpacity} />

        {/* Cape Town → Antarctic Operational Corridor & SIC Coverage Sector */}
        <CorridorOverlay visible={showCorridor} opacity={corridorOpacity} />

        {/* Antarctic Research Stations */}
        {showStations &&
          STATIONS.map((s) => (
            <Marker key={s.id} position={[s.lat, s.lon]} icon={stationMarkerIcon(s)}>
              <Popup>
                <div className="min-w-[190px] font-sans">
                  <p className="text-[13px] font-bold text-white">{s.name}</p>
                  <p className="text-[11.5px] font-semibold text-[#FFB300]">
                    {s.country} · {s.type === 'port' ? 'Staging Port' : 'Research Station'}
                  </p>
                  <p className="num mt-1 text-[11px] text-mist font-mono">
                    {s.lat.toFixed(4)}°, {s.lon.toFixed(4)}°
                  </p>
                  <p className="mt-1 text-[11px] text-white/80 leading-snug">{s.note}</p>
                </div>
              </Popup>
            </Marker>
          ))}

        {/* Real Tracked Icebergs & SAR Detections */}
        {showIcebergs &&
          TRACKED_ICEBERGS.map((iceberg) => {
            const driftVector = getIcebergDriftVector(iceberg)
            const isCritical = iceberg.risk_level === 'CRITICAL'
            const isHigh = iceberg.risk_level === 'HIGH'
            const standoffColor = isCritical ? '#FF4560' : isHigh ? '#FFB020' : '#22E5F0'

            return (
              <span key={iceberg.id}>
                {/* Geodesic Safety Standoff Perimeter */}
                <Circle
                  center={[iceberg.lat, iceberg.lon]}
                  radius={(iceberg.standoff_nm || 15) * 1852}
                  pathOptions={{
                    color: standoffColor,
                    weight: 1.2,
                    dashArray: '5 5',
                    fillColor: standoffColor,
                    fillOpacity: 0.08,
                    interactive: false,
                  }}
                />

                {/* 24-Hour Projected Drift Vector */}
                {driftVector && (
                  <Polyline
                    positions={driftVector}
                    pathOptions={{
                      color: isCritical ? '#FF4560' : '#38BDF8',
                      weight: 1.8,
                      dashArray: '3 4',
                      opacity: 0.75,
                      interactive: false,
                    }}
                  />
                )}

                {/* Hazard Marker */}
                <Marker
                  position={[iceberg.lat, iceberg.lon]}
                  icon={icebergIcon(iceberg.risk_level)}
                >
                  <Popup>
                    <div className="min-w-[228px] font-sans">
                      <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-1.5">
                        <span className="flex items-center gap-1.5 text-xs font-bold text-white">
                          <AlertTriangle
                            size={13}
                            className={
                              iceberg.risk_level === 'CRITICAL'
                                ? 'text-red-400'
                                : iceberg.risk_level === 'HIGH'
                                ? 'text-amber-400'
                                : 'text-[#22E5F0]'
                            }
                          />
                          {iceberg.name}
                        </span>
                        <span
                          className={`rounded border px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                            iceberg.risk_level === 'CRITICAL'
                              ? 'border-red-500/40 bg-red-500/20 text-red-400'
                              : iceberg.risk_level === 'HIGH'
                              ? 'border-amber-500/40 bg-amber-500/20 text-amber-400'
                              : 'border-[#22E5F0]/40 bg-[#22E5F0]/20 text-[#22E5F0]'
                          }`}
                        >
                          {iceberg.risk_level ?? 'TRACKED'}
                        </span>
                      </div>

                      <p className="mt-1.5 text-[10.5px] leading-snug text-mist">
                        {iceberg.type} · calved from {iceberg.origin}
                      </p>

                      <div className="mt-2 space-y-1 text-[11px] font-mono">
                        <PopupRow label="Coords">
                          {Number(iceberg.lat).toFixed(3)}°, {Number(iceberg.lon).toFixed(3)}°
                        </PopupRow>
                        <PopupRow label="Dimensions" tone="text-[#A9DFFF]">
                          {iceberg.length_km} × {iceberg.width_km} km
                        </PopupRow>
                        <PopupRow label="Area" tone="text-[#A9DFFF]">
                          {iceberg.area_km2} km²
                        </PopupRow>
                        <PopupRow label="Drift">
                          {iceberg.drift_speed_knots} kn @ {iceberg.drift_heading_deg}°
                        </PopupRow>
                        <PopupRow label="Standoff" tone="text-amber-400 font-bold">
                          {iceberg.standoff_nm} NM safety buffer
                        </PopupRow>
                        <PopupRow label="Confidence" tone="text-emerald-400">
                          {(iceberg.confidence * 100).toFixed(0)}%
                        </PopupRow>
                      </div>

                      <p className="mt-1.5 text-[10px] leading-snug text-white/70 italic">
                        {iceberg.description}
                      </p>
                      <p className="mt-1.5 border-t border-white/10 pt-1.5 font-mono text-[9px] leading-snug text-steel">
                        {iceberg.detection_source} · {iceberg.model}
                      </p>
                    </div>
                  </Popup>
                </Marker>
              </span>
            )
          })}

        {/* Previous / Alternative Route Lines */}
        {priorLine && priorLine.length > 1 && (
          <>
            <Polyline positions={priorLine} pathOptions={{ color: '#05182B', weight: 6, opacity: 0.7, interactive: false }} />
            <Polyline positions={priorLine} pathOptions={{ color: priorColor, weight: 2.2, opacity: 0.85, dashArray: '6 5' }}>
              <Tooltip direction="top" offset={[0, -6]} sticky>
                <span className="text-[11px] font-medium">{priorLabel}</span>
              </Tooltip>
            </Polyline>
          </>
        )}

        {altLine && altLine.length > 1 && (
          <>
            <Polyline positions={altLine} pathOptions={{ color: '#05182B', weight: 6, opacity: 0.7, interactive: false }} />
            <Polyline positions={altLine} pathOptions={{ color: altColor, weight: 2.5, dashArray: '10 6' }}>
              <Tooltip direction="top" offset={[0, -6]} sticky>
                <span className="text-[11px] font-medium">{altLabel}</span>
              </Tooltip>
            </Polyline>
          </>
        )}

        {/* Primary Recommended Trajectory with Glowing Halo */}
        {routeLine && routeLine.length > 1 && (
          <>
            <Polyline positions={routeLine} pathOptions={{ color: '#05182B', weight: 9, opacity: 0.85, interactive: false }} />
            <Polyline positions={routeLine} pathOptions={{ color: '#22E5F0', weight: 5.5, opacity: 0.4, interactive: false }} />
            <Polyline positions={routeLine} pathOptions={{ color: routeColor, weight: 3.2, opacity: 1 }}>
              <Tooltip direction="top" offset={[0, -8]} sticky>
                <div className="font-sans text-xs">
                  <span className="font-bold text-[#22E5F0]">{routeLabel}</span>
                  <div className="text-[10px] text-mist font-mono mt-0.5">
                    {routeLine.length} Verified Navigable Waypoints
                  </div>
                </div>
              </Tooltip>
            </Polyline>

            {/* Vessel Marker along Route */}
            <Marker position={shipPos} icon={shipIcon(-30)}>
              <Popup>
                <div className="min-w-[170px] font-sans">
                  <p className="flex items-center gap-1.5 text-xs font-bold text-white">
                    <Navigation size={13} className="text-[#22E5F0]" />
                    <span>Route origin</span>
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-[#A9DFFF]">
                    Latitude: {Number(shipPos[0]).toFixed(3)}°
                    <br />
                    Longitude: {Number(shipPos[1]).toFixed(3)}°
                  </p>
                  <p className="mt-1 text-[10px] font-semibold text-[#22E5F0]">
                    Start of planned {routeLine.length}-waypoint track
                  </p>
                </div>
              </Popup>
            </Marker>

            {/* Waypoint markers along recommended trajectory */}
            {showWaypoints &&
              routeLine.length > 5 &&
              (() => {
                const step = Math.max(3, Math.floor(routeLine.length / 8))
                const waypoints = []
                for (let i = step; i < routeLine.length - 1; i += step) {
                  waypoints.push({ index: i + 1, pos: routeLine[i] })
                }
                return waypoints.map((wp) => (
                  <Marker
                    key={`wp-${wp.index}`}
                    position={wp.pos}
                    icon={L.divIcon({
                      className: '',
                      html: `
                        <div style="width:16px;height:16px;border-radius:50%;background:#0A2A45;border:1.5px solid #22E5F0;display:flex;align-items:center;justify-content:center;box-shadow:0 0 6px rgba(34,229,240,0.6);">
                          <span style="font:700 8.5px ui-monospace,monospace;color:#22E5F0;">${wp.index}</span>
                        </div>
                      `,
                      iconSize: [16, 16],
                      iconAnchor: [8, 8],
                    })}
                  >
                    <Tooltip direction="top" offset={[0, -8]}>
                      <span className="font-mono text-[10px] text-white">
                        WP {wp.index}: {Number(wp.pos[0]).toFixed(3)}°, {Number(wp.pos[1]).toFixed(3)}°
                      </span>
                    </Tooltip>
                  </Marker>
                ))
              })()}
          </>
        )}

        {/* Origin & Destination Waypoint Pins */}
        {endpoints.map((e, i) => (
          <Marker
            key={`${e.kind ?? 'endpoint'}-${i}`}
            position={[e.lat, e.lon]}
            icon={pinIcon(e.kind)}
          >
            <Popup>
              <div className="min-w-[170px] font-sans">
                <p className="text-xs font-bold text-white">
                  {e.kind === 'origin' ? 'Voyage Origin' : 'Destination Station'}
                  {e.label ? ` · ${e.label}` : ''}
                </p>
                <p className="num mt-1 text-[11px] text-[#22E5F0] font-mono">
                  {Number(e.lat).toFixed(4)}°, {Number(e.lon).toFixed(4)}°
                </p>
                <p className="text-[10px] text-mist mt-0.5">8-Connected Ocean Navigable Point</p>
              </div>
            </Popup>
          </Marker>
        ))}

        {children}
      </MapContainer>

      {/* Quick Navigation HUD Toolbar */}
      {mapInstance && (
        <NavigationToolbar
          map={mapInstance}
          routeLine={routeLine}
          endpoints={endpoints}
          currentZoom={currentZoom}
          basemapKey={basemapKey}
          onBasemapChange={setBasemapKey}
          onToggleFullscreen={toggleFullscreen}
          isFullscreen={isFullscreen}
        />
      )}

      {/* Top Right Live Coordinates Readout (Matching Reference Screenshot) */}
      <div className="pointer-events-none absolute right-3 top-3 z-[600]">
        <div className="rounded-lg border border-white/10 bg-[#05182B]/85 px-2.5 py-1 font-mono text-[12px] text-white/90 shadow-xl backdrop-blur-md">
          {mouseCoord ? `${mouseCoord.lon.toFixed(6)}, ${mouseCoord.lat.toFixed(6)}` : '3.074756, -29.893823'}
        </div>
      </div>

      {/* Bottom Status Readout (Matching Reference Screenshot) */}
      <div className="pointer-events-none absolute bottom-3 left-32 z-[600]">
        <div className="rounded-md border border-white/10 bg-[#05182B]/80 px-2 py-0.5 font-mono text-[10px] backdrop-blur-sm flex items-center gap-2">
          <span className="text-emerald-400">API: ok</span>
          <span className="text-white/20">·</span>
          <span className="text-[#22E5F0]">WS: open</span>
        </div>
      </div>
    </div>
  )
}

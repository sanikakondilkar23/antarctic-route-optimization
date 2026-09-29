import { useEffect, useMemo } from 'react'
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  Tooltip,
  ImageOverlay,
  GeoJSON,
  ScaleControl,
  useMap,
  useMapEvents,
} from 'react-leaflet'
import L from 'leaflet'
import { STATIONS } from '../../data'

/* ------------------------------------------------------------------ */
/* Icons - flat, chart-like, no glow                                   */
/* ------------------------------------------------------------------ */

function pinIcon(kind) {
  const isOrigin = kind === 'origin'
  const stroke = isOrigin ? '#A8CFE6' : '#C39A4A'
  const label = isOrigin ? 'O' : 'D'
  return L.divIcon({
    className: '',
    html: `<div style="width:26px;height:26px;border:1.5px solid ${stroke};background:rgba(11,14,17,.92);border-radius:3px;display:flex;align-items:center;justify-content:center;font:600 12px/1 'IBM Plex Mono',monospace;color:${stroke};box-shadow:0 2px 6px rgba(0,0,0,.5)">${label}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

function stationIcon(type) {
  const color = type === 'port' ? '#C39A4A' : '#A8CFE6'
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;border:1.5px solid ${color};background:rgba(11,14,17,.9);border-radius:50%;display:flex;align-items:center;justify-content:center"><span style="width:4px;height:4px;background:${color};border-radius:50%"></span></div>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  })
}

/* ------------------------------------------------------------------ */
/* Behaviour                                                           */
/* ------------------------------------------------------------------ */

/** Re-centres the map when the caller supplies a new target. */
function ViewTarget({ target }) {
  const map = useMap()
  useEffect(() => {
    if (!target?.center) return
    map.setView(target.center, target.zoom ?? map.getZoom(), { animate: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.nonce])
  return null
}

function ClickCapture({ pickMode, onPick, onCursor }) {
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
  })
  return null
}

/* ------------------------------------------------------------------ */
/* Cartography                                                         */
/* ------------------------------------------------------------------ */

/** 10-degree graticule inside the served grid. Pure cartography. */
function Graticule({ meta, visible }) {
  const layer = useMemo(() => {
    if (!visible || !meta?.lat?.length || !meta?.lon?.length) return null
    const lat0 = meta.lat[0]
    const lat1 = meta.lat[meta.lat.length - 1]
    const lon0 = meta.lon[0]
    const lon1 = meta.lon[meta.lon.length - 1]
    const lines = []
    for (let lon = Math.ceil(lon0 / 10) * 10; lon <= lon1; lon += 10) {
      lines.push([[lat0, lon], [lat1, lon]])
    }
    for (let lat = Math.ceil(lat0 / 10) * 10; lat <= lat1; lat += 10) {
      lines.push([[lat, lon0], [lat, lon1]])
    }
    return lines
  }, [meta, visible])

  if (!layer) return null
  return (
    <>
      {layer.map((pts, i) => (
        <Polyline
          key={i}
          positions={pts}
          pathOptions={{ color: '#E9ECEF', weight: 1, opacity: 0.07, dashArray: '2 6', interactive: false }}
        />
      ))}
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Map                                                                 */
/* ------------------------------------------------------------------ */

/**
 * The AURORA chart.
 *
 * Layers are drawn only when the caller supplies them: there is no iceberg,
 * wind, current or risk-zone layer here because this deployment serves none.
 * SIC and uncertainty rasters are PNGs the client rendered from the API's own
 * frames - invalid cells are transparent, never painted as open water.
 */
export default function AntarcticMap({
  center = [-64, 35],
  zoom = 3,
  className = '',
  style,
  meta = null,
  coastline = null,
  showCoastline = true,
  showGraticule = true,
  showStations = true,
  showBaseTiles = true,
  sicRaster = null,
  sicOpacity = 0.72,
  uncertaintyRaster = null,
  uncertaintyOpacity = 0.6,
  routeLine = null,
  routeColor = '#A8CFE6',
  routeLabel = 'Recommended route',
  priorLine = null,
  priorColor = '#6E7881',
  priorLabel = 'Previous route',
  altLine = null,
  altColor = '#C39A4A',
  altLabel = 'Alternative route',
  endpoints = [],
  pickMode = null,
  onPick,
  onCursor,
  target = null,
  attribution = true,
  children,
}) {
  return (
    <MapContainer
      center={center}
      zoom={zoom}
      minZoom={2}
      maxZoom={9}
      zoomControl
      className={className}
      style={{ zIndex: 0, height: '100%', width: '100%', ...style }}
      worldCopyJump={false}
    >
      {showBaseTiles && (
        <>
          <TileLayer
            attribution={
              attribution
                ? '&copy; <a href="https://www.esri.com/">Esri</a>, HERE, Garmin, FAO, NOAA, USGS, OpenStreetMap contributors'
                : ''
            }
            url="https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
            maxZoom={16}
          />
          <TileLayer
            attribution={attribution ? '&copy; Esri' : ''}
            url="https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
            maxZoom={16}
            opacity={0.75}
          />
        </>
      )}

      <ScaleControl imperial={false} position="bottomleft" />
      <ViewTarget target={target} />
      <ClickCapture pickMode={pickMode} onPick={onPick} onCursor={onCursor} />

      <Graticule meta={meta} visible={showGraticule} />

      {showCoastline && coastline && (
        <GeoJSON
          key="coastline"
          data={coastline}
          interactive={false}
          style={() => ({
            color: '#8E99A3',
            weight: 1,
            opacity: 0.55,
            fillColor: '#16191D',
            fillOpacity: 0.75,
          })}
        />
      )}

      {sicRaster?.url && sicRaster?.bounds && (
        <ImageOverlay
          key={`sic-${sicRaster.url.slice(-24)}`}
          url={sicRaster.url}
          bounds={sicRaster.bounds}
          opacity={sicOpacity}
          interactive={false}
          alt="Sea-ice concentration"
        />
      )}

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

      {showStations &&
        STATIONS.map((s) => (
          <Marker key={s.id} position={[s.lat, s.lon]} icon={stationIcon(s.type)}>
            <Popup>
              <div className="min-w-[180px]">
                <p className="text-[13px] font-semibold text-white">{s.name}</p>
                <p className="text-[11.5px]" style={{ color: '#A8CFE6' }}>
                  {s.country} · {s.type === 'port' ? 'Staging port' : 'Research station'}
                </p>
                <p className="num mt-1 text-[11px]" style={{ color: '#98A1A9' }}>
                  {s.lat.toFixed(4)}°, {s.lon.toFixed(4)}°
                </p>
                <p className="mt-0.5 text-[11px]" style={{ color: '#98A1A9' }}>
                  {s.note}
                </p>
              </div>
            </Popup>
          </Marker>
        ))}

      {priorLine && priorLine.length > 1 && (
        <>
          <Polyline positions={priorLine} pathOptions={{ color: '#0B0E11', weight: 7, opacity: 0.6, interactive: false }} />
          <Polyline
            positions={priorLine}
            pathOptions={{ color: priorColor, weight: 2, opacity: 0.9, dashArray: '6 5' }}
          >
            <Tooltip direction="top" offset={[0, -6]} sticky>
              <span className="text-[11px] font-medium">{priorLabel}</span>
            </Tooltip>
          </Polyline>
        </>
      )}

      {altLine && altLine.length > 1 && (
        <>
          <Polyline positions={altLine} pathOptions={{ color: '#0B0E11', weight: 7, opacity: 0.6, interactive: false }} />
          <Polyline positions={altLine} pathOptions={{ color: altColor, weight: 2.5, dashArray: '10 6' }}>
            <Tooltip direction="top" offset={[0, -6]} sticky>
              <span className="text-[11px] font-medium">{altLabel}</span>
            </Tooltip>
          </Polyline>
        </>
      )}

      {routeLine && routeLine.length > 1 && (
        <>
          <Polyline positions={routeLine} pathOptions={{ color: '#0B0E11', weight: 9, opacity: 0.65, interactive: false }} />
          <Polyline positions={routeLine} pathOptions={{ color: routeColor, weight: 3, opacity: 1 }}>
            <Tooltip direction="top" offset={[0, -6]} sticky>
              <span className="text-[11px] font-medium">{routeLabel}</span>
            </Tooltip>
          </Polyline>
        </>
      )}

      {endpoints.map((e, i) => (
        <Marker
          key={`${e.kind ?? 'endpoint'}-${i}`}
          position={[e.lat, e.lon]}
          icon={pinIcon(e.kind)}
        >
          <Popup>
            <div className="min-w-[160px]">
              <p className="text-[13px] font-semibold text-white">
                {e.kind === 'origin' ? 'Origin' : 'Destination'}
                {e.label ? ` · ${e.label}` : ''}
              </p>
              <p className="num mt-0.5 text-[11px]" style={{ color: '#98A1A9' }}>
                {Number(e.lat).toFixed(3)}°, {Number(e.lon).toFixed(3)}°
              </p>
            </div>
          </Popup>
        </Marker>
      ))}

      {children}
    </MapContainer>
  )
}

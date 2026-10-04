import L from 'leaflet'
import proj4 from 'proj4'

/**
 * Authoritative WGS 84 / Antarctic Polar Stereographic CRS definition (EPSG:3031).
 * Standard parallel: -71° S, Central Meridian: 0° E, Datum: WGS 84.
 */
export const EPSG3031_DEF =
  '+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs'

// Register in global proj4 registry
proj4.defs('EPSG:3031', EPSG3031_DEF)

// Ensure globals for any Leaflet extensions
if (typeof window !== 'undefined') {
  window.L = L
  window.proj4 = proj4
}

// WGS84 Ellipsoid Constants for analytical forward & inverse projection
const WGS84_A = 6378137.0
const WGS84_F = 1 / 298.257223563
const WGS84_E2 = 2 * WGS84_F - WGS84_F * WGS84_F
const WGS84_E = Math.sqrt(WGS84_E2)
const PHI_C = 71 * (Math.PI / 180)
const SIN_C = Math.sin(PHI_C)
const M_C = Math.cos(PHI_C) / Math.sqrt(1 - WGS84_E2 * SIN_C * SIN_C)
const T_C =
  Math.tan(Math.PI / 4 - PHI_C / 2) /
  Math.pow((1 - WGS84_E * SIN_C) / (1 + WGS84_E * SIN_C), WGS84_E / 2)

const E4 = WGS84_E2 * WGS84_E2
const E6 = E4 * WGS84_E2
const E8 = E6 * WGS84_E2
const C2 = WGS84_E2 / 2 + (5 * E4) / 24 + E6 / 12 + (13 * E8) / 480
const C4 = (7 * E4) / 48 + (29 * E6) / 240
const C6 = (7 * E6) / 120

/**
 * Direct analytical forward projection from WGS84 (lon, lat in degrees)
 * to EPSG:3031 (x, y in meters). Sub-millisecond performance (<0.05µs).
 */
export function project3031(lon_deg, lat_deg) {
  const phi = -lat_deg * (Math.PI / 180)
  const lam = lon_deg * (Math.PI / 180)
  const s = Math.sin(phi)
  const t =
    Math.tan(Math.PI / 4 - phi / 2) /
    Math.pow((1 - WGS84_E * s) / (1 + WGS84_E * s), WGS84_E / 2)
  const rho = (WGS84_A * M_C * t) / T_C
  return [rho * Math.sin(lam), rho * Math.cos(lam)]
}

/**
 * Direct analytical inverse projection from EPSG:3031 (x, y in meters)
 * to WGS84 (lon, lat in degrees).
 */
export function unproject3031(x, y) {
  const rho = Math.hypot(x, y)
  if (rho < 1e-5) return [0, -90]
  const lam = Math.atan2(x, y)
  const lon = (lam * 180) / Math.PI
  const t = (rho * T_C) / (WGS84_A * M_C)
  const chi = Math.PI / 2 - 2 * Math.atan(t)
  const phi =
    chi +
    C2 * Math.sin(2 * chi) +
    C4 * Math.sin(4 * chi) +
    C6 * Math.sin(6 * chi)
  const lat = (-phi * 180) / Math.PI
  return [lon, lat]
}

const ORIGIN = [-33699550.99203, 33699551.01703]
const RESOLUTIONS = [
  238810.813354, // Zoom 0
  119405.406677, // Zoom 1
  59702.703338,  // Zoom 2
  29851.351669,  // Zoom 3 (Antarctic Continental View)
  14925.675835,  // Zoom 4 (Southern Ocean Corridor)
  7462.837917,   // Zoom 5 (Marginal Ice Zone)
  3731.418959,   // Zoom 6 (Regional Navigation)
  1865.709479,   // Zoom 7 (Tactical Waypoints)
  932.85474,     // Zoom 8
  466.42737,     // Zoom 9
  233.213685,    // Zoom 10
  116.606842,    // Zoom 11
  58.303421,     // Zoom 12
  29.151711,     // Zoom 13
  14.575855,     // Zoom 14
]

const SCALES = RESOLUTIONS.map((r) => 1 / r)

const EARTH_R = 6371000

/**
 * Great-circle distance in metres for the EPSG:3031 CRS.
 *
 * `L.CRS` (the bare base object) does NOT define `distance()` — only
 * `L.CRS.Earth` does, and that is what Leaflet's own EPSG:4326 / EPSG:3857
 * CRSs inherit. `L.Map#distance()` delegates to `map.options.crs.distance`,
 * so an EPSG:3031 CRS built from bare `L.CRS` throws
 * `TypeError: this.options.crs.distance is not a function`.
 *
 * That throw happens *inside* `L.Control.Scale#onAdd`, and `L.Control#addTo`
 * assigns `control._map = map` BEFORE calling `onAdd()`. The control is then
 * left half-attached (`_map` set, `_container` still undefined) and the next
 * `addTo()` — React StrictMode / error-boundary remount — calls `remove()`,
 * which does `DomUtil.remove(undefined)` and crashes with
 * "Cannot read properties of undefined (reading 'parentNode')".
 *
 * Deliberately a distinct function object from `L.CRS.Earth.distance`, so
 * `L.Circle._project()` takes its projected-CRS branch. That branch measures
 * the radius in projected metres, which is correct for a conformal polar
 * stereographic CRS; the Earth branch assumes longitude-linear x (Mercator)
 * and would squash the iceberg standoff circles into longitude-dependent
 * ellipses.
 */
export function distance3031(latlng1, latlng2) {
  const a = L.latLng(latlng1)
  const b = L.latLng(latlng2)
  const rad = Math.PI / 180
  const lat1 = a.lat * rad
  const lat2 = b.lat * rad
  const sinDLat = Math.sin(((b.lat - a.lat) * rad) / 2)
  const sinDLon = Math.sin(((b.lng - a.lng) * rad) / 2)
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon
  return EARTH_R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)))
}

/**
 * Authoritative Leaflet CRS implementation for EPSG:3031.
 * Inherits standard Leaflet CRS methods and supports seamless zooming,
 * projection of GeoJSON, Polyline, ImageOverlay, and TileLayers.
 * wrapLng and wrapLat are explicitly undefined to eliminate horizontal
 * world tile wrapping for polar stereographic coordinate space.
 */
export const EPSG3031 = L.extend({}, L.CRS, {
  code: 'EPSG:3031',
  projection: {
    project: (latlng) => {
      const [x, y] = project3031(latlng.lng, latlng.lat)
      return new L.Point(x, y)
    },
    unproject: (point) => {
      const [lon, lat] = unproject3031(point.x, point.y)
      return new L.LatLng(lat, lon)
    },
    bounds: L.bounds(
      [-33699550.99203, -33699550.99203],
      [33699551.01703, 33699551.01703]
    ),
  },
  transformation: new L.Transformation(1, -ORIGIN[0], -1, ORIGIN[1]),
  scale: function (zoom) {
    const i = Math.floor(zoom)
    if (i >= SCALES.length) return SCALES[SCALES.length - 1]
    if (i < 0) return SCALES[0]
    if (zoom === i) return SCALES[i]
    const next = i + 1 < SCALES.length ? SCALES[i + 1] : SCALES[i]
    return SCALES[i] + (next - SCALES[i]) * (zoom - i)
  },
  zoom: function (scale) {
    let closest = 0
    let minDiff = Infinity
    for (let i = 0; i < SCALES.length; i++) {
      const diff = Math.abs(SCALES[i] - scale)
      if (diff < minDiff) {
        minDiff = diff
        closest = i
      }
    }
    return closest
  },
  wrapLng: undefined,
  wrapLat: undefined,
  infinite: false,
  // Required by L.Map#distance (L.Control.Scale, L.Circle, L.LatLng helpers).
  // Without it `Control.Scale#onAdd` throws and poisons the control's lifecycle.
  distance: distance3031,
})

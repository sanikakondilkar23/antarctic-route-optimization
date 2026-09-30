/**
 * auroraApi.js - the single client for the AURORA backend.
 *
 * Every number this frontend shows comes from one of the endpoints below or
 * from an explicit "unavailable" state. Nothing is generated, interpolated or
 * defaulted: when a request fails, the failure is surfaced to the caller.
 *
 * Endpoints consumed (backend/api/main.py):
 *   GET  /api/health                 liveness
 *   GET  /api/sic/metadata           grid, dates, lat/lon axes
 *   GET  /api/sic/<t>                one real SIC frame (base64 + validity)
 *   GET  /api/uncertainty/<t>        one real forecast-uncertainty frame
 *   GET  /api/uncertainty/summary    committed uncertainty distribution
 *   GET  /api/models/ensemble        ConvLSTM checkpoints + recorded metrics
 *   GET  /api/system/status          what is genuinely available
 *   GET  /api/layers/status          per-layer cost status + ACTIVE weights
 *   GET  /api/limitations            documented limitations
 *   GET  /api/route                  verified baseline route
 *   POST /api/route/optimize         A* + CostMap on the real SIC field
 *   POST /api/route/reroute          replan on a later forecast timestep
 *
 * Base URL: same origin. Vite proxies /api to the Flask backend in dev and
 * preview; VITE_AURORA_API_BASE overrides it for a deployed frontend.
 */

const RAW_BASE = (import.meta.env?.VITE_AURORA_API_BASE || '').trim()
export const API_BASE = RAW_BASE.replace(/\/+$/, '')

export function apiUrl(path) {
  if (!path) return null
  if (/^https?:\/\//i.test(path)) return path
  return `${API_BASE}${path}`
}

export class AuroraApiError extends Error {
  constructor(message, { status = 0, detail = null, path = '' } = {}) {
    super(message)
    this.name = 'AuroraApiError'
    this.status = status
    this.detail = detail
    this.path = path
  }
}

async function getJSON(path, { allow404 = false, signal } = {}) {
  let response
  try {
    response = await fetch(apiUrl(path), {
      signal,
      headers: { Accept: 'application/json' },
    })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new AuroraApiError(
      `Cannot reach the AURORA backend at ${apiUrl(path) || '(same origin)'}. ` +
        'Start it with: python backend/api/main.py',
      { status: 0, path },
    )
  }

  if (response.status === 404 && allow404) return null

  let body = null
  try {
    body = await response.json()
  } catch {
    body = null
  }

  if (!response.ok) {
    const message =
      body?.error || body?.detail || `request failed (HTTP ${response.status})`
    throw new AuroraApiError(message, {
      status: response.status,
      detail: body,
      path,
    })
  }
  return body
}

async function postJSON(path, payload) {
  let response
  try {
    response = await fetch(apiUrl(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new AuroraApiError(
      `Cannot reach the AURORA backend at ${apiUrl(path) || '(same origin)'}.`,
      { status: 0, path },
    )
  }

  let body = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (!response.ok) {
    const message =
      body?.error || body?.detail || `request failed (HTTP ${response.status})`
    throw new AuroraApiError(message, {
      status: response.status,
      detail: body,
      path,
    })
  }
  return body
}

/* ------------------------------------------------------------------ */
/* Read endpoints                                                      */
/* ------------------------------------------------------------------ */

export const fetchHealth = () => getJSON('/api/health')
export const fetchMetadata = () => getJSON('/api/sic/metadata')
export const fetchSystemStatus = (signal) => getJSON('/api/system/status', { signal })
export const fetchLayersStatus = (timestep = 0, signal) =>
  getJSON(`/api/layers/status?timestep=${timestep}`, { signal })
export const fetchLimitations = () => getJSON('/api/limitations')

/** Routing preference presets (ids, labels, hints, weights) from the backend. */
export const fetchRoutePreferences = () => getJSON('/api/route/preferences')
export const fetchUncertaintySummary = () => getJSON('/api/uncertainty/summary')
export const fetchEnsemble = () => getJSON('/api/models/ensemble')
export const fetchVerifiedRoute = () => getJSON('/api/route', { allow404: true })
export const fetchSicSlice = (timestep) => getJSON(`/api/sic/${timestep}`)
export const fetchUncertaintySlice = (timestep, horizon = 0) =>
  getJSON(`/api/uncertainty/${timestep}?horizon=${horizon}`)

/* ------------------------------------------------------------------ */
/* AURORA compositor endpoints (backend/api/aurora_api.py)             */
/* ------------------------------------------------------------------ */

/**
 * Component-level status for the four intelligence groups the product
 * reports on: SIC, route, iceberg and the environmental data layers.
 */
export const fetchAuroraStatus = (signal) => getJSON('/api/aurora/status', { signal })

/** Forecaster health: checkpoints, metrics, artifact shapes, horizons. */
export const fetchSicStatus = (signal) => getJSON('/api/sic/status', { signal })

/**
 * Request a forecast field. `format: 'stats'` asks the backend for aggregate
 * statistics only, which keeps the payload small for status panels.
 */
export function sicPredict(payload) {
  return postJSON('/api/sic/predict', { format: 'stats', ...payload })
}

/**
 * Run the full analysis: SIC exposure + iceberg detections + environmental
 * layers + route optimisation in one request.
 */
export function auroraAnalyze(payload) {
  return postJSON('/api/aurora/analyze', payload)
}

/** SAR sample tiles shipped with the repository, for the iceberg page. */
export const fetchIcebergSamples = (signal) =>
  getJSON('/api/aurora/iceberg/samples', { signal })

/* ------------------------------------------------------------------ */
/* Route endpoints                                                     */
/* ------------------------------------------------------------------ */

/**
 * Ask the backend for a route. The backend owns the algorithm (A* + CostMap
 * on the real SIC field); this function never computes anything itself.
 *
 * @param {{start_lat:number,start_lon:number,goal_lat:number,goal_lon:number,
 *          timestep:number,snap?:boolean,max_snap_cells?:number}} req
 */
export function optimizeRoute(req) {
  return postJSON('/api/route/optimize', req)
}

/**
 * Re-optimize an existing route on a LATER forecast timestep.
 * `originalRoute` is the object returned by optimizeRoute().
 */
export function rerouteRoute({ originalRoute, newTimestep }) {
  return postJSON('/api/route/reroute', {
    original_route: originalRoute,
    new_timestep: newTimestep,
  })
}

/**
 * Real SIC encountered along the A* route for the given endpoints, one sample
 * per waypoint with cumulative great-circle distance. Cells are grid indices,
 * taken from the `start.cell` / `goal.cell` fields of an optimize response.
 */
export function fetchRouteProfile(timestep, { startRow, startCol, goalRow, goalCol } = {}) {
  const q = new URLSearchParams()
  if (startRow != null) q.set('start_row', startRow)
  if (startCol != null) q.set('start_col', startCol)
  if (goalRow != null) q.set('goal_row', goalRow)
  if (goalCol != null) q.set('goal_col', goalCol)
  const suffix = q.toString() ? `?${q.toString()}` : ''
  return getJSON(`/api/route/profile/${timestep}${suffix}`)
}

/* ------------------------------------------------------------------ */
/* Iceberg detection (backend/api/iceberg_api.py)                      */
/* ------------------------------------------------------------------ */

export const fetchIcebergStatus = () => getJSON('/api/icebergs/status')
export const fetchIcebergModel = () => getJSON('/api/icebergs/model')

/**
 * Ocean currents (CMEMS uo/vo). Returns `available:false` with uo/vo null
 * unless a real CMEMS dataset is mounted on the host - the caller must honour
 * that and draw nothing.
 */
export const fetchCurrent = (timestep) => getJSON(`/api/current/${timestep}`)

/**
 * Natural Earth Antarctic coastline GeoJSON. Map context only - the API says
 * so itself and it is never an input to the cost map.
 */
export const fetchCoastline = () => getJSON('/api/map/coastline', { allow404: true })

/**
 * Run the YOLOv8 detector on an uploaded SAR tile.
 * Detections are reported in PIXEL space - georeferencing is unavailable in
 * this deployment, so nothing here is turned into a latitude/longitude.
 */
export async function detectIcebergs(file, conf = 0.25) {
  const form = new FormData()
  form.append('image', file)
  form.append('conf', String(conf))
  let response
  try {
    response = await fetch(apiUrl('/api/icebergs/detect'), { method: 'POST', body: form })
  } catch {
    throw new AuroraApiError('Cannot reach the AURORA iceberg endpoint.', { status: 0, path: '/api/icebergs/detect' })
  }
  let body = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (!response.ok) {
    throw new AuroraApiError(
      body?.error || body?.detail || `detection failed (HTTP ${response.status})`,
      { status: response.status, detail: body, path: '/api/icebergs/detect' },
    )
  }
  return body
}

/* ------------------------------------------------------------------ */
/* Routing objectives                                                  */
/* ------------------------------------------------------------------ */

/**
 * Cost-weight profiles documented in src/routing/cost.py. The weights are
 * server-side configuration (SIH_W_* environment variables) - the API echoes
 * the ACTIVE profile in every route response as `cost_weights`, so the UI can
 * always state which objective actually produced a route.
 */
export const OBJECTIVES = [
  {
    id: 'sic_distance',
    label: 'Sea-ice risk + distance',
    required: ['w_sic', 'w_distance'],
    forbidden: ['w_unc', 'w_ice', 'w_wind', 'w_curr', 'w_depth', 'w_ice_class'],
    hint: 'Server default. SIC risk and distance are the only cost terms.',
  },
  {
    id: 'sic_uncertainty',
    label: 'Sea-ice + forecast uncertainty',
    required: ['w_sic', 'w_distance', 'w_unc'],
    forbidden: ['w_ice', 'w_wind', 'w_curr', 'w_depth', 'w_ice_class'],
    hint: 'Requires SIH_W_UNC > 0 on the backend.',
  },
  {
    id: 'iceberg_standoff',
    label: 'Sea-ice + iceberg standoff',
    required: ['w_sic', 'w_distance', 'w_ice'],
    forbidden: ['w_unc', 'w_wind', 'w_curr', 'w_depth', 'w_ice_class'],
    hint: 'Requires iceberg risk data (routing_metadata.json: deferred) and SIH_W_ICE > 0.',
  },
  {
    id: 'multi_hazard',
    label: 'Multi-hazard (ice, wind, currents, depth)',
    required: ['w_sic', 'w_distance', 'w_ice', 'w_wind', 'w_curr', 'w_depth'],
    forbidden: [],
    hint: 'Requires every environmental dataset; wind/currents/depth are unavailable in this deployment.',
  },
]

/** Which documented objective (if any) the backend is actually running. */
export function activeObjective(costWeights) {
  if (!costWeights) return null
  return (
    OBJECTIVES.find((o) =>
      o.required.every((k) => Number(costWeights[k]) > 0) &&
      o.forbidden.every((k) => Number(costWeights[k] || 0) === 0),
    ) ?? null
  )
}

/** Enabled/disabled cost terms, straight from a `cost_weights` payload. */
export function enabledCostTerms(costWeights) {
  if (!costWeights) return []
  return Object.entries(costWeights)
    .filter(([k, v]) => k !== 'vessel_draft_m' && Number(v) > 0)
    .map(([k]) => k)
}

/* ------------------------------------------------------------------ */
/* Decoding                                                            */
/* ------------------------------------------------------------------ */

export function b64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Decode a `/api/sic/<t>` payload.
 *
 * valid[i] === 0 means INVALID / NON-NAVIGABLE. The value byte of such a cell
 * carries no meaning and must never be drawn as open water - the alpha channel
 * of any raster built from this is the authority.
 */
export function decodeSlice(raw) {
  const [nRows, nCols] = raw.encoding.shape
  const values = b64ToBytes(raw.encoding.sic_u8)
  const packed = b64ToBytes(raw.encoding.valid)
  const n = nRows * nCols
  const valid = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    valid[i] = (packed[i >> 3] >> (7 - (i & 7))) & 1
  }
  return {
    timestep: raw.timestep,
    date: raw.date,
    nRows,
    nCols,
    values,
    valid,
    stats: raw.stats,
  }
}

/** Decode an `/api/uncertainty/<t>` payload (same value/validity contract). */
export function decodeUncertainty(raw) {
  const [nRows, nCols] = raw.encoding.shape
  const values = b64ToBytes(raw.encoding.sic_u8)
  const packed = b64ToBytes(raw.encoding.valid)
  const n = nRows * nCols
  const valid = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    valid[i] = (packed[i >> 3] >> (7 - (i & 7))) & 1
  }
  return {
    timestep: raw.timestep,
    date: raw.date,
    horizon: raw.horizon,
    horizonDays: raw.horizon_days,
    nRows,
    nCols,
    values,
    valid,
    stats: raw.stats,
  }
}

/* ------------------------------------------------------------------ */
/* Colour ramps (display only - values always come from the API)       */
/* ------------------------------------------------------------------ */

const SIC_RAMP = [
  [6, 24, 46],
  [11, 47, 82],
  [18, 80, 127],
  [43, 127, 184],
  [111, 178, 217],
  [184, 221, 240],
  [232, 244, 251],
  [255, 255, 255],
]

const UNC_RAMP = [
  [12, 8, 34],
  [45, 24, 84],
  [88, 40, 130],
  [140, 60, 150],
  [196, 92, 140],
  [238, 140, 140],
  [255, 214, 235],
]

function rampColor(ramp, t) {
  const x = Math.max(0, Math.min(1, t)) * (ramp.length - 1)
  const i = Math.min(ramp.length - 2, Math.floor(x))
  const f = x - i
  const a = ramp[i]
  const b = ramp[i + 1]
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ]
}

export function sicColor(v) {
  return rampColor(SIC_RAMP, v)
}

export function sicAlpha(v) {
  return Math.min(255, 62 + 193 * Math.pow(Math.max(0, Math.min(1, v)), 0.58))
}

export function uncColor(v, vmax) {
  const m = vmax > 0 ? vmax : 1
  return rampColor(UNC_RAMP, v / m)
}

/**
 * Legends exported so the drawn raster and the printed legend can never
 * disagree - both are built from the same stop table as the ramps above.
 */
export const SIC_LEGEND = {
  type: 'sequential',
  units: 'SIC fraction',
  vmin: 0,
  vmax: 1,
  stops: SIC_RAMP.map((c, i) => ({
    t: i / (SIC_RAMP.length - 1),
    color: `rgb(${c[0]},${c[1]},${c[2]})`,
  })),
  description:
    '0 = open ocean, 1 = consolidated ice. Cells outside the valid domain are drawn fully transparent (non-navigable), never as open water.',
}

export const UNCERTAINTY_LEGEND = {
  type: 'sequential',
  units: 'SIC fraction',
  vmin: 0,
  stops: UNC_RAMP.map((c, i) => ({
    t: i / (UNC_RAMP.length - 1),
    color: `rgb(${c[0]},${c[1]},${c[2]})`,
  })),
  description:
    'Forecast spread (1 sigma) from the committed uncertainty_2026.npy artifact. Higher = less confidence at that lead time.',
}

/* ------------------------------------------------------------------ */
/* Web Mercator projection helpers for Leaflet ImageOverlay           */
/* ------------------------------------------------------------------ */

const MAX_LAT = 85.05112878
const mercY = (lat) => {
  const l = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))
  return Math.log(Math.tan(Math.PI / 4 + (l * Math.PI) / 360))
}
const invMercY = (y) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI

const mercRatio = (latTop, latBot) =>
  (mercY(latTop) - mercY(latBot)) / (((latTop - latBot) * Math.PI) / 180)

/**
 * Rasterise a decoded frame to a PNG data URL for Leaflet's ImageOverlay.
 *
 * Web Mercator re-sampling: The underlying SIC/uncertainty grid is evenly
 * spaced in degrees (0.25 deg), but Leaflet's map is in Web Mercator
 * (EPSG:3857) where latitude degrees expand towards the poles.
 *
 * In Leaflet's ImageOverlay, row 0 (y = 0, top of image) corresponds to the
 * NORTHERN boundary (near Cape Town, lat ~ -32 deg), and the bottom row
 * corresponds to the SOUTHERN boundary (Antarctica, lat ~ -75 deg).
 * The grid has row 0 at lat -75 deg (South) and row nRows-1 at lat -32 deg (North).
 * Resampling row-by-row in Mercator space maps the rows correctly so that:
 * 1. North (Cape Town / open ocean) is at the top (no ice).
 * 2. South (Antarctica / sea-ice pack) is at the bottom (sea ice).
 * 3. Every cell aligns with real cartography (coastline, bathymetry, route).
 *
 * Invalid cells remain fully transparent (alpha = 0).
 */
export function rasterToDataUrl(decoded, { kind = 'sic', vmax = 1, meta = null } = {}) {
  const { nRows, nCols, values, valid } = decoded
  if (!nRows || !nCols) return null

  const res = Number(meta?.resolution_deg ?? 0.25)
  const latMin = meta?.lat?.length ? Math.min(meta.lat[0], meta.lat[meta.lat.length - 1]) : -75.0
  const latMax = meta?.lat?.length ? Math.max(meta.lat[0], meta.lat[meta.lat.length - 1]) : -32.0
  const latBot = latMin - res / 2
  const latTop = latMax + res / 2

  const yTop = mercY(latTop)
  const yBot = mercY(latBot)
  const ratio = mercRatio(latTop, latBot)
  const outH = Math.max(2, Math.round(nRows * ratio))

  const rowMap = new Int32Array(outH)
  for (let j = 0; j < outH; j++) {
    const y = yTop - ((j + 0.5) / outH) * (yTop - yBot)
    const latVal = invMercY(y)
    let r = Math.round((latVal - latMin) / res)
    if (r < 0) r = 0
    else if (r > nRows - 1) r = nRows - 1
    rowMap[j] = r
  }

  const canvas = document.createElement('canvas')
  canvas.width = nCols
  canvas.height = outH
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(nCols, outH)
  const data = img.data

  for (let j = 0; j < outH; j++) {
    const r = rowMap[j]
    for (let ci = 0; ci < nCols; ci++) {
      const srcIdx = r * nCols + ci
      const dstIdx = (j * nCols + ci) * 4
      if (!valid[srcIdx]) {
        data[dstIdx + 3] = 0
        continue
      }
      const t = values[srcIdx] / 255
      const [red, green, blue] = kind === 'unc' ? uncColor(t, vmax) : sicColor(t)
      data[dstIdx] = red
      data[dstIdx + 1] = green
      data[dstIdx + 2] = blue
      data[dstIdx + 3] = kind === 'unc' ? 220 : sicAlpha(t)
    }
  }

  ctx.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}

/* ------------------------------------------------------------------ */
/* Grid geometry                                                       */
/* ------------------------------------------------------------------ */

/** Leaflet ImageOverlay bounds [[south, west], [north, east]] from metadata. */
export function boundsFromMetadata(meta) {
  if (!meta?.lat?.length || !meta?.lon?.length) return null
  return rasterBounds(meta, 0, meta.lat.length, 0, meta.lon.length)
}

/**
 * Outer cell edges of a sub-block of the grid, so an ImageOverlay lines up
 * with the cells it represents (the axes are cell CENTRES, so half a cell is
 * added on each side). Every number comes from the API's own metadata.
 *
 * @param {{lat:number[],lon:number[],resolution_deg?:number}} meta
 * @param {number} rowStart inclusive
 * @param {number} rowEnd exclusive
 * @param {number} colStart inclusive
 * @param {number} colEnd exclusive
 */
export function rasterBounds(meta, rowStart, rowEnd, colStart, colEnd) {
  if (!meta?.lat?.length || !meta?.lon?.length) return null
  const h = Number(meta.resolution_deg ?? 0.25) / 2
  const r0 = Math.max(0, rowStart)
  const r1 = Math.min(meta.lat.length, rowEnd)
  const c0 = Math.max(0, colStart)
  const c1 = Math.min(meta.lon.length, colEnd)
  const lat0 = Number(meta.lat[r0])
  const lat1 = Number(meta.lat[r1 - 1])
  const lon0 = Number(meta.lon[c0])
  const lon1 = Number(meta.lon[c1 - 1])
  const south = Math.min(lat0, lat1) - h
  const north = Math.max(lat0, lat1) + h
  const west = Math.min(lon0, lon1) - h
  const east = Math.max(lon0, lon1) + h
  if ([north, south, west, east].some((v) => !Number.isFinite(v))) return null
  return [
    [south, west],
    [north, east],
  ]
}

/**
 * Bounds for a SUB-BLOCK of the grid (used for the uncertainty product, which
 * the API reports as `model_band_rows` / `model_band_cols`).
 *
 * @param {{lat:number[],lon:number[]}} meta
 * @param {[number,number]} rowBand inclusive-exclusive row indices
 * @param {[number,number]} colBand inclusive-exclusive column indices
 */
export function boundsForBand(meta, rowBand, colBand) {
  if (!meta?.lat?.length || !meta?.lon?.length) return null
  return rasterBounds(meta, rowBand[0], rowBand[1], colBand[0], colBand[1])
}

/** Grid cell -> [lat, lon] using the axes the API itself serves. */
export function cellToLatLng(meta, row, col) {
  const lat = meta?.lat?.[row]
  const lon = meta?.lon?.[col]
  if (lat == null || lon == null) return null
  return [Number(lat), Number(lon)]
}

/** A route `path` ([row, col] cells) -> [[lat, lon], ...] for a Polyline. */
export function pathToLatLngs(meta, path) {
  if (!Array.isArray(path)) return []
  const out = []
  for (const cell of path) {
    const ll = cellToLatLng(meta, cell[0], cell[1])
    if (ll) out.push(ll)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* Endpoints (stations / horizons)                                     */
/* ------------------------------------------------------------------ */

/**
 * Named origin/destination choices that are real, verifiable coordinates on
 * the 0.25 deg routing grid. Bharati and Maitri are the project's own
 * station-approach goals (backend/cache/routing_station_goals.json); Cape Town
 * is the staging port used by the verified baseline route. Any other point is
 * entered as explicit coordinates - no location is invented here, and the
 * backend rejects (HTTP 400) any endpoint outside its grid.
 */
export const ROUTE_POINTS = [
  { id: 'capetown', name: 'Cape Town (staging port)', lat: -33.9249, lon: 18.4241 },
  { id: 'bharati', name: 'Bharati station approach', lat: -69.0, lon: 76.25 },
  { id: 'maitri', name: 'Maitri station approach', lat: -70.0, lon: 10.5 },
]

export function pointById(id) {
  return ROUTE_POINTS.find((p) => p.id === id) ?? null
}

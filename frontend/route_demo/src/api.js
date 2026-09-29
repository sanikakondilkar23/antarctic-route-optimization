/**
 * Thin API client for the SIH2026059 IceRoute-Robust backend.
 *
 * All scientific / routing logic lives in the backend. This module only
 * fetches, caches and decodes payloads. Timestep slices are cached so the
 * timeline can be scrubbed without re-requesting data.
 *
 * HARD RULE: nothing here invents a value. If an endpoint reports that a
 * layer is unavailable, the UI must show "Unavailable in current deployment"
 * rather than substituting a placeholder.
 */

const BASE = '' // same-origin; Vite proxies /api to the Flask backend in dev

/**
 * Dynamic rerouting is pinned to the verified real backend endpoint
 * GET /api/reroute/3 (origin D0 -> target D3).  No synthetic demo payload is
 * ever used as a route result.
 */
export const REROUTE_ORIGIN_STEP = 0
export const REROUTE_TARGET_STEP = 3

const sliceCache = new Map() // timestep -> decoded SIC frame
const uncCache = new Map() // `${t}:${h}` -> decoded uncertainty frame
const oneShot = new Map() // url -> promise (metadata, ensemble, profile...)

async function getJSON(path, { allow404 = false } = {}) {
  const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    if (allow404) return null
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body && body.error) detail = body.error
    } catch {
      /* keep status text */
    }
    throw new Error(`${path}: ${detail}`)
  }
  return res.json()
}

/* ------------------------------------------------------------------ */
/* Endpoints                                                          */
/* ------------------------------------------------------------------ */

export const fetchHealth = () => getJSON('/api/health')

export const fetchMetadata = () => getJSON('/api/sic/metadata')

export const fetchSystemStatus = () => getJSON('/api/system/status')

export const fetchLimitations = () => getJSON('/api/limitations')

export const fetchRoute = () => getJSON('/api/route')

export const fetchRouteAt = (timestep) => getJSON(`/api/route/at/${timestep}`)

/**
 * THE route-planning call.
 *
 * POST /api/route/optimize — the backend resolves the coordinates onto the
 * 0.25 deg routing grid, builds the EnvironmentalGrid from the REAL SIC field
 * for that timestep, and runs A* + CostMap on it. Nothing is computed here.
 *
 * A 400 carries a machine-readable `reason` (out_of_grid,
 * endpoint_not_navigable, no_route, unsafe_route_cells, ...) and is thrown as
 * an Error with `.payload` so the UI can explain the rejection instead of
 * showing a route.
 */
export async function optimizeRoute({
  start_lat, start_lon, goal_lat, goal_lon, timestep, snap = true,
} = {}) {
  const res = await fetch('/api/route/optimize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      start_lat: Number(start_lat),
      start_lon: Number(start_lon),
      goal_lat: Number(goal_lat),
      goal_lon: Number(goal_lon),
      timestep: Number(timestep),
      snap,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.success === false) {
    const err = new Error(body.error || `optimize failed (HTTP ${res.status})`)
    err.reason = body.reason || 'request_failed'
    err.payload = body
    throw err
  }
  return body
}

/**
 * POST /api/route/reroute — re-optimize the SAME leg on a later real SIC
 * timestep. Endpoints come from the original plan unless overridden, so the
 * only variable is the environment. Returns both routes, the comparison and
 * the real changed segments.
 */
export async function rerouteRoute({ original_route, new_timestep, start, goal } = {}) {
  const res = await fetch('/api/route/reroute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ original_route, new_timestep: Number(new_timestep), start, goal }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.success === false) {
    const err = new Error(body.error || `reroute failed (HTTP ${res.status})`)
    err.reason = body.reason || 'request_failed'
    err.payload = body
    throw err
  }
  return body
}

/** Real SIC encountered along the real A* route, one sample per waypoint. */
export const fetchRouteProfile = (timestep) =>
  getJSON(`/api/route/profile/${timestep}`)

/* ------------------------------------------------------------------ */
/* AURORA integration layer — the three project models                 */
/* ------------------------------------------------------------------ */

async function postJSON(path, payload) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload ?? {}),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || body.success === false) {
    const err = new Error(body.error || `${path} failed (HTTP ${res.status})`)
    err.reason = body.reason || body.detail?.reason || 'request_failed'
    err.payload = body
    throw err
  }
  return body
}

/** GET /api/sic/status — real runtime state of the ConvLSTM forecaster. */
export const fetchSicStatus = () => getJSON('/api/sic/status')

/**
 * POST /api/sic/predict — a real forecast frame for one date + horizon.
 * horizon 0 comes from the committed routing artifact (all 167 days);
 * horizons 1 and 2 from the 30 dates committed alongside it.
 * `format: 'stats'` skips the raster and returns only statistics.
 */
export const sicPredict = ({ timestep, date, horizon = 0, format = 'b64' } = {}) =>
  postJSON('/api/sic/predict', { timestep, date, horizon, format })

/** GET /api/aurora/status — the six-row model/data status area. */
export const fetchAuroraStatus = () => getJSON('/api/aurora/status')

/** GET /api/aurora/iceberg/samples — committed SAR tiles for the detector. */
export const fetchIcebergSamples = () => getJSON('/api/aurora/iceberg/samples')

/** GET /api/icebergs/status — detector status, checksum and risk state. */
export const fetchIcebergStatus = () => getJSON('/api/icebergs/status')

/** GET /api/icebergs/model — architecture, thresholds and provenance. */
export const fetchIcebergModel = () => getJSON('/api/icebergs/model')

/** POST /api/aurora/analyze — the unified SIC -> iceberg -> environment -> route run. */
export const auroraAnalyze = ({
  start, destination, date, timestep, vessel_parameters = {}, iceberg = null,
} = {}) => {
  const payload = {
    start,
    destination,
    vessel_parameters,
  }
  if (date) payload.date = date
  else if (timestep != null) payload.timestep = Number(timestep)
  if (iceberg) payload.icebergs = iceberg
  return postJSON('/api/aurora/analyze', payload)
}

/** Three independently trained SIC ConvLSTM checkpoints + their own metrics. */
export const fetchEnsemble = () => memo('ensemble', '/api/models/ensemble')

/** Distribution summary committed alongside the uncertainty artifact. */
export const fetchUncertaintySummary = () =>
  memo('uncsummary', '/api/uncertainty/summary')

/** Verified real dynamic reroute: origin D0 -> target D3. */
export const fetchRerouteDemo = () =>
  getJSON(
    `/api/reroute/${REROUTE_TARGET_STEP}?origin_timestep=${REROUTE_ORIGIN_STEP}`,
  )

export const fetchReroute = (timestep, originTimestep = REROUTE_ORIGIN_STEP) =>
  getJSON(`/api/reroute/${timestep}?origin_timestep=${originTimestep}`)

export const fetchCurrent = (timestep) => getJSON(`/api/current/${timestep}`)

/**
 * Real Antarctic coastline for the basemap layer (GeoJSON, map context only).
 * Cached once: it never changes with the timestep.
 */
let coastlinePromise = null
export function fetchCoastline() {
  if (!coastlinePromise) coastlinePromise = getJSON('/api/map/coastline')
  return coastlinePromise
}

/* ------------------------------------------------------------------ */
/* Frame payloads (lazy: only the selected step is ever requested)     */
/* ------------------------------------------------------------------ */

/** Real SIC raster. */
export async function fetchSlice(timestep, { force = false } = {}) {
  const key = String(timestep)
  if (!force && sliceCache.has(key)) return sliceCache.get(key)
  const raw = await getJSON(`/api/sic/${timestep}`)
  const decoded = decodeSlice(raw)
  sliceCache.set(key, decoded)
  return decoded
}

export function cachedSlice(timestep) {
  return sliceCache.get(String(timestep)) || null
}

/** Real forecast-uncertainty frame for one lead-time horizon (0..2 = D+1..D+3). */
export async function fetchUncertainty(timestep, horizon) {
  const key = `${timestep}:${horizon}`
  if (uncCache.has(key)) return uncCache.get(key)
  const raw = await getJSON(`/api/uncertainty/${timestep}?horizon=${horizon}`)
  const decoded = { ...decodeSlice(raw), horizon, horizon_days: raw.horizon_days, stats: raw.stats }
  uncCache.set(key, decoded)
  return decoded
}

export function cachedUncertainty(timestep, horizon) {
  return uncCache.get(`${timestep}:${horizon}`) || null
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                   */
/* ------------------------------------------------------------------ */

function memo(name, path) {
  if (!oneShot.has(name)) oneShot.set(name, getJSON(path))
  return oneShot.get(name)
}

function b64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Decode the backend payload into flat typed arrays.
 *
 * valid[i] === 0  =>  INVALID / NON-NAVIGABLE cell. Its sic value carries no
 * meaning and must never be treated as open water. This is the documented
 * NaN encoding (see backend/api/main.py).
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

/* ------------------------------------------------------------------ */
/* SIC colour mapping (display only; values come from the backend)      */
/*                                                                     */
/* A standard sea-ice-concentration convention is used:                 */
/*   0.0 = open ocean (deep navy)  ->  1.0 = consolidated ice (white)   */
/* Most of the Southern Ocean sits near 0, so a light-at-zero ramp      */
/* would render the whole chart as blank paper. This ramp keeps the      */
/* open water dark and the ice edge bright, which is both truthful to    */
/* the data and how sea-ice analysis charts are actually drawn.         */
/* ------------------------------------------------------------------ */

const RAMP = [
  [6, 24, 46],     // 0.00  deep ocean
  [11, 47, 82],    // ~0.15
  [18, 80, 127],   // ~0.30
  [43, 127, 184],  // ~0.45
  [111, 178, 217], // ~0.60
  [184, 221, 240], // ~0.75
  [232, 244, 251], // ~0.90
  [255, 255, 255], // 1.00  consolidated ice
]

/**
 * Per-cell opacity for the SIC raster.
 *
 * The basemap has to stay readable underneath, and the route has to stay the
 * loudest thing on the plate. So open water is almost transparent and opacity
 * rises with concentration: the ice edge and the consolidated pack are the
 * only parts of the raster that assert themselves. This is a display choice
 * only — the values served by the API are untouched.
 */
export function sicAlpha(v) {
  return Math.min(255, 62 + 193 * Math.pow(Math.max(0, Math.min(1, v)), 0.58))
}

export function sicColor(v) {
  const t = Math.max(0, Math.min(1, v)) * (RAMP.length - 1)
  const i = Math.min(RAMP.length - 2, Math.floor(t))
  const f = t - i
  const a = RAMP[i]
  const b = RAMP[i + 1]
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ]
}

/**
 * Uncertainty ramp: dark violet (confident) -> hot magenta/white (uncertain).
 * Used only for the real `uncertainty_2026.npy` frames; values are the
 * artifact's own SIC-fraction spread, not an invented unit.
 */
const UNC_RAMP = [
  [12, 8, 34],
  [45, 24, 84],
  [88, 40, 130],
  [140, 60, 150],
  [196, 92, 140],
  [238, 140, 140],
  [255, 214, 235],
]

export function uncColor(v, vmax) {
  const m = vmax > 0 ? vmax : 1
  const t = Math.max(0, Math.min(1, v / m))
  const p = t * (UNC_RAMP.length - 1)
  const i = Math.min(UNC_RAMP.length - 2, Math.floor(p))
  const f = p - i
  const a = UNC_RAMP[i]
  const b = UNC_RAMP[i + 1]
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ]
}

/**
 * Diverging ramp for the BEFORE/AFTER difference field: cyan = ice retreated,
 * amber = ice advanced. Zero difference is deliberately near-black so only
 * genuinely changed cells light up.
 */
export function diffColor(d, vmax) {
  const m = vmax > 0 ? vmax : 1
  const t = Math.max(-1, Math.min(1, d / m))
  const u = Math.abs(t)
  if (u < 0.02) return [8, 14, 24]
  const k = Math.min(1, u / 0.55)
  return t > 0
    ? [Math.round(20 + 235 * k), Math.round(22 + 150 * k), Math.round(28 + 10 * k)]  // + advanced
    : [Math.round(18 + 10 * k), Math.round(24 + 190 * k), Math.round(38 + 205 * k)] // - retreated
}

/**
 * Build a diff frame between two decoded SIC slices.
 * Cells that are invalid in either slice stay invalid (NaN policy preserved);
 * a cell that becomes/stops being navigable is reported as a navigability
 * change, which is the single most important thing a reroute reacts to.
 */
export function buildDiff(a, b) {
  if (!a || !b || a.nRows !== b.nRows || a.nCols !== b.nCols) return null
  const n = a.nRows * a.nCols
  const delta = new Float32Array(n)
  const navChange = new Int8Array(n) // -1 became non-nav, +1 became nav, 0 same
  let vmax = 0
  let nIncreased = 0
  let nDecreased = 0
  let nNavChanged = 0
  for (let i = 0; i < n; i++) {
    const va = a.valid[i]
    const vb = b.valid[i]
    if (!va && !vb) { delta[i] = NaN; navChange[i] = 0; continue }
    if (va !== vb) {
      navChange[i] = va ? -1 : 1
      nNavChanged += 1
      delta[i] = NaN
      continue
    }
    const d = b.values[i] / 255 - a.values[i] / 255
    delta[i] = d
    if (d > vmax) vmax = d
    if (d < -vmax) vmax = -d
    if (d > 0) nIncreased += 1
    else if (d < 0) nDecreased += 1
  }
  return { nRows: a.nRows, nCols: a.nCols, delta, navChange, vmax, nIncreased, nDecreased, nNavChanged, nCompared: n }
}

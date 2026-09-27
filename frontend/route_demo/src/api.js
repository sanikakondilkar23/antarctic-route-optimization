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

/** Real SIC encountered along the real A* route, one sample per waypoint. */
export const fetchRouteProfile = (timestep) =>
  getJSON(`/api/route/profile/${timestep}`)

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

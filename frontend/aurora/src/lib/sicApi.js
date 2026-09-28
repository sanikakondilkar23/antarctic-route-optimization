/**
 * sicApi.js — thin client for the SIC ConvLSTM forecast API.
 *
 * The backend at /api/sic/* is the only source of sea-ice numbers in this app.
 * Nothing here generates, interpolates or defaults a value: if the API cannot
 * serve a field, the returned object carries `available: false` plus the exact
 * `reason`, and callers are expected to surface it.
 *
 * Base URL resolution:
 *   VITE_SIC_API_BASE   absolute origin, e.g. https://sic.example.com
 *                       Unset in development: requests go to the same origin
 *                       and Vite proxies /api to the FastAPI service.
 */

const RAW_BASE = (import.meta.env?.VITE_SIC_API_BASE || '').trim()
export const SIC_API_BASE = RAW_BASE.replace(/\/+$/, '')

/** Resolve an API-relative path (e.g. /api/sic/raster?...) to a fetchable URL. */
export function apiUrl(path) {
  if (!path) return null
  if (/^https?:\/\//i.test(path)) return path
  return `${SIC_API_BASE}${path}`
}

export class SicApiError extends Error {
  constructor(message, { status = 0, detail = null, path = '' } = {}) {
    super(message)
    this.name = 'SicApiError'
    this.status = status
    this.detail = detail
    this.path = path
  }
}

async function getJson(path, signal) {
  let response
  try {
    response = await fetch(apiUrl(path), { signal, headers: { Accept: 'application/json' } })
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    throw new SicApiError(
      `Cannot reach the SIC API at ${apiUrl(path) || '(same origin)'}. ` +
        'Start it with: uvicorn app.main:app --port 8000 (from backend/)',
      { status: 0, path },
    )
  }

  if (!response.ok) {
    let detail = null
    let body = null
    try {
      body = await response.json()
      detail = body?.detail ?? body?.reason ?? null
    } catch {
      detail = null
    }
    const message =
      detail?.reason ||
      (typeof detail === 'string' ? detail : null) ||
      `SIC API request failed with HTTP ${response.status}`
    throw new SicApiError(message, { status: response.status, detail, path })
  }
  return response.json()
}

/** Full forecast payload: model card, grid, and every field per horizon. */
export function fetchForecast({ date = null, includeDates = true, signal } = {}) {
  const params = new URLSearchParams()
  if (date) params.set('date', date)
  if (!includeDates) params.set('include_dates', 'false')
  const qs = params.toString()
  return getJson(`/api/sic/forecast${qs ? `?${qs}` : ''}`, signal)
}

/** Real per-date forecast-vs-observation series for the charts. */
export function fetchTimeseries({ signal } = {}) {
  return getJson('/api/sic/timeseries', signal)
}

/** Architecture + per-checkpoint verification + live-input report. */
export function fetchModelCard({ signal } = {}) {
  return getJson('/api/sic/model', signal)
}

export function fetchMetrics({ signal } = {}) {
  return getJson('/api/sic/metrics', signal)
}

/** Which fields the API can currently serve, for capability-gating the UI. */
export function capabilities(forecast) {
  if (!forecast?.forecast) return { mean: [], uncertainty: [], confidence: [] }
  const pick = (block) =>
    Object.entries(block)
      .filter(([, v]) => v?.available)
      .map(([k]) => Number(k))
  return {
    mean: pick(forecast.forecast),
    uncertainty: pick(forecast.uncertainty),
    confidence: pick(forecast.confidence),
  }
}

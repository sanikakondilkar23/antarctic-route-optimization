/**
 * useSicForecast.js — loads the real ConvLSTM SIC forecast for the website.
 *
 * Responsibilities:
 *   - fetch /api/sic/forecast and /api/sic/timeseries, with abort on unmount
 *   - hold the forecast horizon (Reference / H+1 / H+2 / H+3) and the field
 *     layer (concentration / uncertainty / confidence)
 *   - resolve which field should be drawn, and — when the requested field is
 *     genuinely unavailable — fall back to a field that IS available while
 *     keeping the original reason so the UI can state it plainly
 *
 * It never substitutes a value. An unavailable field stays unavailable.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiUrl, capabilities, fetchForecast, fetchTimeseries } from '../lib/sicApi'

export const HORIZON_OBSERVED = 'observed'

export const HORIZONS = [
  { id: HORIZON_OBSERVED, short: 'Observed', label: 'Reference (Observed)', days: 0 },
  { id: 1, short: 'H+1', label: 'H+1 · +24 h', days: 1 },
  { id: 2, short: 'H+2', label: 'H+2 · +48 h', days: 2 },
  { id: 3, short: 'H+3', label: 'H+3 · +72 h', days: 3 },
]

export const SIC_LAYERS = [
  { id: 'sic', label: 'Concentration', hint: 'NSIDC CDR v6 sea-ice concentration, 0–1' },
  { id: 'uncertainty', label: 'Uncertainty', hint: 'Ensemble + MC-dropout 1σ spread' },
  { id: 'confidence', label: 'Confidence', hint: 'High / medium / low class map' },
]

function entryFor(forecast, horizon, layer) {
  if (!forecast) return null
  if (horizon === HORIZON_OBSERVED) {
    if (layer === 'sic') return { field: 'observed', entry: forecast.observed }
    return { field: 'observed', entry: forecast.observed }
  }
  const key = String(horizon)
  if (layer === 'uncertainty') {
    return { field: 'uncertainty', entry: forecast.uncertainty?.[key] }
  }
  if (layer === 'confidence') {
    return { field: 'confidence', entry: forecast.confidence?.[key] }
  }
  const block = forecast.forecast?.[key]
  return { field: 'forecast_mean', entry: block?.mean, block }
}

function decorate(forecast, resolved) {
  if (!resolved?.entry?.available) {
    return {
      field: resolved?.field ?? null,
      url: null,
      bounds: forecast?.grid?.bounds ?? null,
      stats: null,
      legend: null,
      available: false,
      reason: resolved?.entry?.reason ?? 'Field not served by the API.',
    }
  }
  const { entry } = resolved
  return {
    field: resolved.field,
    url: apiUrl(entry.url),
    bounds: forecast?.grid?.bounds ?? null,
    stats: entry.stats,
    legend: entry.legend,
    available: true,
    reason: null,
  }
}

export default function useSicForecast({ autoRefetchMs = 0 } = {}) {
  const [forecast, setForecast] = useState(null)
  const [timeseries, setTimeseries] = useState(null)
  const [date, setDate] = useState(null)
  const [horizon, setHorizon] = useState(HORIZON_OBSERVED)
  const [layer, setLayer] = useState('sic')
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const controllerRef = useRef(null)

  const load = useCallback(async (targetDate = null) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setStatus('loading')
    setError(null)
    try {
      const [f, t] = await Promise.all([
        fetchForecast({ date: targetDate, signal: controller.signal }),
        fetchTimeseries({ signal: controller.signal }),
      ])
      if (controller.signal.aborted) return
      setForecast(f)
      setTimeseries(t)
      setDate(f.date)
      setStatus('ready')
    } catch (err) {
      if (err?.name === 'AbortError') return
      setForecast(null)
      setTimeseries(null)
      setError(err)
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    load(null)
    return () => controllerRef.current?.abort()
  }, [load])

  useEffect(() => {
    if (!autoRefetchMs) return undefined
    const id = setInterval(() => load(date), autoRefetchMs)
    return () => clearInterval(id)
  }, [autoRefetchMs, date, load])

  const caps = useMemo(() => capabilities(forecast), [forecast])

  const resolved = useMemo(() => entryFor(forecast, horizon, layer), [forecast, horizon, layer])
  let active = decorate(forecast, resolved)

  // If the requested field is unavailable but a real alternative exists for the
  // same horizon, draw that instead and keep the original reason visible.
  let notice = null
  if (forecast && !active.available) {
    const alternatives = horizon === HORIZON_OBSERVED
      ? []
      : ['uncertainty', 'confidence'].filter((id) => id !== layer)
    for (const alt of alternatives) {
      const altResolved = entryFor(forecast, horizon, alt)
      const altActive = decorate(forecast, altResolved)
      if (altActive.available) {
        notice = {
          severity: 'warn',
          requested: SIC_LAYERS.find((l) => l.id === layer)?.label ?? layer,
          reason: active.reason,
          showing: SIC_LAYERS.find((l) => l.id === alt)?.label ?? alt,
        }
        active = { ...altActive, fallback: true }
        break
      }
    }
  }

  const availableHorizons = useMemo(() => {
    if (!forecast) return []
    return HORIZONS.filter((h) => {
      if (h.id === HORIZON_OBSERVED) return Boolean(forecast.observed?.available)
      const key = String(h.id)
      return (
        Boolean(forecast.forecast?.[key]?.mean?.available) ||
        Boolean(forecast.uncertainty?.[key]?.available) ||
        Boolean(forecast.confidence?.[key]?.available)
      )
    }).map((h) => h.id)
  }, [forecast])

  const model = forecast?.model ?? null
  const checkpointsLoaded = model?.checkpoints_loaded ?? 0

  return {
    status,
    error,
    forecast,
    timeseries,
    model,
    artifacts: forecast?.artifacts ?? null,
    liveInference: forecast?.live_inference ?? null,
    source: forecast?.source ?? null,
    generatedAt: forecast?.generated_at ?? null,
    date,
    dates: forecast?.dates ?? [],
    setDate: useCallback((value) => load(value), [load]),
    refresh: useCallback(() => load(date), [date, load]),
    horizon,
    setHorizon,
    layer,
    setLayer,
    active,
    notice,
    capabilities: caps,
    availableHorizons,
    checkpointSummary: {
      loaded: checkpointsLoaded,
      expected: model?.ensemble_seeds ?? 3,
      architecture: model?.architecture ?? null,
      architectureMatches: model?.architecture_matches_checkpoints ?? false,
      parameters: model?.parameters_per_checkpoint ?? null,
      mcDropout: model?.mc_dropout ?? null,
      conformal: model?.conformal ?? null,
    },
  }
}

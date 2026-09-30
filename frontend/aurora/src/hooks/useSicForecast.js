/**
 * useSicForecast.js - loads the REAL sea-ice fields the AURORA backend serves.
 *
 * Data path:
 *   /api/sic/metadata        grid axes + the list of forecast dates
 *   /api/sic/<t>             one SIC frame (base64 value + validity bitmask)
 *   /api/uncertainty/<t>     one forecast-uncertainty frame
 *
 * The frames are decoded and colourised in the browser so Leaflet can overlay
 * them. Invalid cells stay fully transparent: NaN means INVALID / NON-NAVIGABLE
 * and is never drawn as open water.
 *
 * If any request fails, `status` becomes 'error' and `active.available` is
 * false with the exact reason. No value is ever substituted, so the UI can say
 * "DATA UNAVAILABLE" truthfully.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AuroraApiError,
  SIC_LEGEND,
  UNCERTAINTY_LEGEND,
  boundsFromMetadata,
  decodeSlice,
  decodeUncertainty,
  fetchEnsemble,
  fetchMetadata,
  fetchSicSlice,
  fetchUncertaintySlice,
  rasterToDataUrl,
} from '../lib/auroraApi'

export const LAYER_SIC = 'sic'
export const LAYER_UNCERTAINTY = 'uncertainty'

export const SIC_LAYERS = [
  { id: LAYER_SIC, label: 'Concentration', hint: 'Real SIC field served for the selected forecast day' },
  { id: LAYER_UNCERTAINTY, label: 'Uncertainty', hint: 'Forecast spread (1 sigma, SIC fraction) for the lead time below' },
]

export const UNCERTAINTY_HORIZONS = [
  { id: 0, short: 'D+1', label: 'Lead time +1 day' },
  { id: 1, short: 'D+2', label: 'Lead time +2 days' },
  { id: 2, short: 'D+3', label: 'Lead time +3 days' },
]

function unavailable(reason) {
  return { available: false, url: null, bounds: null, stats: null, reason }
}

export default function useSicForecast() {
  const [metadata, setMetadata] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState(null)
  const [timestep, setTimestep] = useState(0)
  const [layer, setLayer] = useState(LAYER_SIC)
  const [horizon, setHorizon] = useState(0)
  const [frame, setFrame] = useState(null)
  const controllerRef = useRef(null)

  /* ---------------- metadata ---------------- */
  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    fetchMetadata()
      .then((meta) => {
        if (cancelled) return
        setMetadata(meta)
        setError(null)
        setStatus((prev) => (prev === 'error' ? 'ready' : 'ready'))
      })
      .catch((err) => {
        if (cancelled) return
        setMetadata(null)
        setError(err)
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  /* ---------------- one frame at a time ---------------- */
  const loadFrame = useCallback(
    async (t, which, h) => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      try {
        const raw =
          which === LAYER_UNCERTAINTY
            ? await fetchUncertaintySlice(t, h)
            : await fetchSicSlice(t)
        if (controller.signal.aborted) return
        const decoded =
          which === LAYER_UNCERTAINTY ? decodeUncertainty(raw) : decodeSlice(raw)
        const vmax = which === LAYER_UNCERTAINTY ? Math.max(decoded.stats?.max || 0, 0.05) : 1
        const url = rasterToDataUrl(decoded, {
          kind: which === LAYER_UNCERTAINTY ? 'unc' : 'sic',
          vmax,
          meta: metadata,
        })
        setFrame({
          available: true,
          url,
          stats: decoded.stats,
          date: decoded.date,
          timestep: decoded.timestep,
          horizonDays: decoded.horizonDays ?? null,
          reason: null,
        })
        setError(null)
        setStatus('ready')
      } catch (err) {
        if (err?.name === 'AbortError') return
        setFrame(
          unavailable(
            err instanceof AuroraApiError
              ? err.message
              : 'The SIC field could not be loaded.',
          ),
        )
        setError(err)
        setStatus('error')
      }
    },
    [metadata],
  )

  useEffect(() => {
    if (!metadata) return undefined
    loadFrame(timestep, layer, horizon)
    return () => controllerRef.current?.abort()
  }, [metadata, timestep, layer, horizon, loadFrame])

  const bounds = useMemo(() => boundsFromMetadata(metadata), [metadata])
  const dates = metadata?.dates ?? []
  const nTimesteps = metadata?.n_timesteps ?? dates.length
  const date = dates[timestep] ?? null

  /* ---------------- checkpoint / ensemble provenance ---------------- */
  const [ensemble, setEnsemble] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetchEnsemble()
      .then((e) => {
        if (!cancelled) setEnsemble(e)
      })
      .catch(() => {
        if (!cancelled) setEnsemble(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const legend = useMemo(() => {
    if (layer === LAYER_SIC) return SIC_LEGEND
    return { ...UNCERTAINTY_LEGEND, vmax: frame?.stats?.max ?? 1 }
  }, [layer, frame])

  const active = useMemo(() => {
    if (status === 'error' && !frame) {
      return unavailable(error?.message ?? 'DATA UNAVAILABLE - the AURORA API did not respond.')
    }
    if (!frame) return unavailable('Loading...')
    if (!frame.available) return frame
    return { ...frame, bounds, legend }
  }, [frame, bounds, legend, status, error])

  const refresh = useCallback(() => {
    if (metadata) loadFrame(timestep, layer, horizon)
  }, [metadata, timestep, layer, horizon, loadFrame])

  const members = ensemble?.members ?? []
  const checkpointSummary = ensemble
    ? {
        loaded: members.filter((m) => m.checkpoint_present).length,
        expected: ensemble.n_members ?? members.length,
        architecture: ensemble.architecture ?? null,
        parameters: ensemble.param_count ?? null,
        horizons: ensemble.horizons ?? null,
        recordedMetrics: members.map((m) => ({ run: m.run, seed: m.seed, metrics: m.metrics ?? null })),
        note: ensemble.note ?? null,
        inferenceRerunPossible: ensemble.inference_rerun_possible ?? false,
      }
    : null

  return {
    status,
    error,
    metadata,
    ensemble,
    model: ensemble
      ? {
          architecture: ensemble.architecture,
          ensemble_seeds: ensemble.n_members,
          source: 'backend/runs/final_10ch_3f_seed{0,1,2}/best_model.pt',
        }
      : null,
    checkpointSummary,
    dates,
    date,
    nTimesteps,
    timestep,
    setTimestep,
    layer,
    setLayer,
    horizon,
    setHorizon,
    active,
    legend,
    refresh,
    available: Boolean(active?.available),
    /** Exact reason a field is not shown; null when it is shown. */
    unavailableReason: active?.available ? null : active?.reason,
  }
}

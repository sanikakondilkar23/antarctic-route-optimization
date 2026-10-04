/**
 * hooks.js - data acquisition for the AURORA UI.
 *
 * Every hook here returns raw AURORA API payloads (or a raster rendered from
 * one). Nothing is interpolated, smoothed or defaulted: an unavailable product
 * surfaces as `error` / `available:false` and the UI is expected to say so.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  boundsForBand,
  boundsFromMetadata,
  buildPolarRaster,
  decodeSlice,
  decodeUncertainty,
  fetchCoastline,
  fetchLayersStatus,
  fetchMetadata,
  fetchSicSlice,
  fetchUncertaintySlice,
  rasterBounds,
  rasterToDataUrl,
} from './auroraApi'
import coastlineFallback from '../data/coastline.json'

/** Load /api/sic/metadata once. */
export function useMetadata() {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  useEffect(() => {
    let cancelled = false
    fetchMetadata()
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((error) => !cancelled && setState({ data: null, error, loading: false }))
    return () => {
      cancelled = true
    }
  }, [])
  return state
}

/** Load /api/layers/status for one timestep. */
export function useLayersStatus(timestep = 0) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true }))
    fetchLayersStatus(timestep)
      .then((data) => !cancelled && setState({ data, error: null, loading: false }))
      .catch((error) => !cancelled && setState({ data: null, error, loading: false }))
    return () => {
      cancelled = true
    }
  }, [timestep])
  return state
}

/** Load /api/map/coastline once, starting immediately with bundled fallback. */
export function useCoastline() {
  const [geojson, setGeojson] = useState(coastlineFallback)
  useEffect(() => {
    let cancelled = false
    fetchCoastline()
      .then((g) => {
        if (!cancelled && g) setGeojson(g)
      })
      .catch(() => {
        if (!cancelled) setGeojson(coastlineFallback)
      })
    return () => {
      cancelled = true
    }
  }, [])
  return geojson
}

/**
 * Real SIC frame -> PNG data URL + Leaflet bounds for an ImageOverlay.
 * Invalid cells stay fully transparent; they are never painted as open water.
 */
export function useSicRaster(timestep, meta, { enabled = true } = {}) {
  const [frame, setFrame] = useState({ raw: null, decoded: null, loading: false, error: null })

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    setFrame((s) => ({ ...s, loading: true, error: null }))
    fetchSicSlice(timestep)
      .then((raw) => {
        if (cancelled) return
        setFrame({ raw, decoded: decodeSlice(raw), loading: false, error: null })
      })
      .catch((error) => !cancelled && setFrame({ raw: null, decoded: null, loading: false, error }))
    return () => {
      cancelled = true
    }
  }, [timestep, enabled])

  const polar = useMemo(() => {
    if (!frame.decoded || !meta) return { url: null, bounds: null }
    return buildPolarRaster(frame.decoded, meta, { kind: 'sic' })
  }, [frame.decoded, meta])

  return {
    url: polar.url,
    bounds: polar.bounds,
    decoded: frame.decoded,
    stats: frame.raw?.stats ?? null,
    date: frame.raw?.date ?? null,
    loading: frame.loading,
    error: frame.error,
  }
}

/**
 * Real forecast-uncertainty frame -> PNG data URL + bounds.
 * `horizon` is 0|1|2 (D+1/D+2/D+3), the only horizon selector the API exposes.
 * The uncertainty product covers the model band only, so its bounds are the
 * model band, not the full routing grid.
 */
export function useUncertaintyRaster(timestep, horizon = 0, meta, { enabled = true } = {}) {
  const [frame, setFrame] = useState({ raw: null, decoded: null, loading: false, error: null })

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    setFrame((s) => ({ ...s, loading: true, error: null }))
    fetchUncertaintySlice(timestep, horizon)
      .then((raw) => {
        if (cancelled) return
        setFrame({ raw, decoded: decodeUncertainty(raw), loading: false, error: null })
      })
      .catch((error) => !cancelled && setFrame({ raw: null, decoded: null, loading: false, error }))
    return () => {
      cancelled = true
    }
  }, [timestep, horizon, enabled])

  const polar = useMemo(() => {
    if (!frame.decoded || !meta) return { url: null, bounds: null }
    return buildPolarRaster(frame.decoded, meta, {
      kind: 'unc',
      vmax: frame.raw?.stats?.max ?? 1,
      rowBand: frame.raw?.model_band_rows ?? meta.model_band_rows,
      colBand: frame.raw?.model_band_cols ?? meta.model_band_cols,
    })
  }, [frame.decoded, meta, frame.raw])

  return {
    url: polar.url,
    bounds: polar.bounds,
    decoded: frame.decoded,
    stats: frame.raw?.stats ?? null,
    date: frame.raw?.date ?? null,
    horizon: frame.raw?.horizon ?? horizon,
    horizonDays: frame.raw?.horizon_days ?? null,
    loading: frame.loading,
    error: frame.error,
  }
}

/** Bounds helper bound to loaded metadata. */
export function useGridBounds(meta) {
  return useMemo(() => boundsFromMetadata(meta), [meta])
}

export function useRasterBounds(meta, rowBand, colBand) {
  const key = JSON.stringify([rowBand, colBand])
  return useMemo(() => boundsForBand(meta, rowBand, colBand), [meta, key])
}

export { rasterBounds }

/**
 * A value that refreshes on an interval (used for the UTC clock in the
 * status bar).
 */
export function useUtcClock(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** Guards against state updates after unmount for async user actions. */
export function useIsMounted() {
  const ref = useRef(true)
  useEffect(() => {
    ref.current = true
    return () => {
      ref.current = false
    }
  }, [])
  return useCallback(() => ref.current, [])
}

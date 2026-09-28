import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import { sicColor, sicAlpha, uncColor, diffColor } from '../api.js'
import { BASEMAPS, DEFAULT_BASEMAP, basemapById } from './basemaps.js'

/* ------------------------------------------------------------------ */
/* Web Mercator helpers.                                               */
/*                                                                     */
/* The SIC grid is a regular LAT/LON grid, but the basemap is drawn   */
/* in Web Mercator, where rows are not evenly spaced in latitude.     */
/* Every raster is therefore resampled row-by-row in Mercator space   */
/* before it is handed to Leaflet, so the SIC field, the non-          */
/* navigable mask and the route polyline all sit on the SAME real     */
/* geography. Nothing is nudged by hand and no cell is invented.      */
/* ------------------------------------------------------------------ */

const MAX_LAT = 85.05112878
const mercY = (lat) => {
  const l = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))
  return Math.log(Math.tan(Math.PI / 4 + (l * Math.PI) / 360))
}
const invMercY = (y) => ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI

/** Vertical stretch of this lat band in Mercator space (1.0 = equirectangular). */
const mercRatio = (latTop, latBot) =>
  (mercY(latTop) - mercY(latBot)) / (((latTop - latBot) * Math.PI) / 180)

/**
 * For each output row of a Mercator-correct raster, the source row of the
 * lat/lon grid it samples. Output row 0 is the northern edge.
 */
function mercRowMap(outH, latTop, latBot, nRows, res) {
  const yTop = mercY(latTop)
  const yBot = mercY(latBot)
  const out = new Int32Array(outH)
  for (let j = 0; j < outH; j++) {
    const y = yTop - ((j + 0.5) / outH) * (yTop - yBot)
    let r = nRows - 1 - Math.round((latTop - invMercY(y)) / res)
    if (r < 0) r = 0
    else if (r > nRows - 1) r = nRows - 1
    out[j] = r
  }
  return out
}

const SUP = 2 // raster supersampling

const nonNavFill = 'rgba(96,116,146,0.55)'
const ROUTE_CASING = 'rgba(2,6,12,0.92)'
const ROUTE_GLOW = 'rgba(56,189,248,0.34)'
const ROUTE_MAIN = 'rgba(56,189,248,0.9)'
const ROUTE_CORE = 'rgba(240,250,255,0.99)'
const ORIGIN_CSS = 'rgba(251,191,36,0.95)'

const PANE = { sic: 'p-sic', hatch: 'p-hatch', geo: 'p-geo', route: 'p-route', pin: 'p-pin' }

/**
 * Central Antarctic navigation chart — a real geographic map.
 *
 * The chart is a Leaflet map on a public geographic basemap (Esri World
 * Imagery / Esri Ocean bathymetry / CARTO / OpenStreetMap), so the
 * coastline, the Southern Ocean, the place names and the latitude /
 * longitude graticule are real cartography rather than a synthetic
 * plate. Zoom, pan and projection are the basemap's.
 *
 * On top of that real geography, from the API only:
 *
 *   1. SIC field        real /api/sic/<t> payload, Mercator-resampled
 *   2. non-navigable    real NaN cells, hatched (never zero-filled)
 *   3. uncertainty      real /api/uncertainty/<t> artifact, optional
 *   4. coastline        real /api/map/coastline polygons, outline only
 *   5. route            the backend A* + CostMap path, plus the pre-
 *                       reroute corridor and the changed cells
 *   6. endpoints        start, destination, direction, vessel
 *
 * Every number drawn here is a backend response. This component computes
 * no routing, no cost and no science.
 */
export default function SicMap({
  slice, lat, lon,
  uncertainty = null,
  diff = null,
  renderMode = 'sic',
  uncMax = null,
  layers,
  basemap = DEFAULT_BASEMAP,
  onBasemap = null,
  primaryRoute,
  originRoute,
  changedCells,
  routeVisible,
  pulseT = null,
  vesselT = null,
  corridorUnchanged = false,
  statusChip = null,
  onHoverCell = null,
  onPickCell = null,
  pickMode = null,
  selection = null,
  coastline = null,
  hud,
}) {
  const elRef = useRef(null)
  const mapRef = useRef(null)
  const basemapRef = useRef(null)
  const layersRef = useRef({})
  const [zoom, setZoom] = useState(2)
  const [hover, setHover] = useState(null)
  const [sicOpacity, setSicOpacity] = useState(0.9)

  const grid = useMemo(() => {
    if (!lat.length || !lon.length) return null
    return {
      latMin: lat[0], latMax: lat[lat.length - 1],
      lonMin: lon[0], lonMax: lon[lon.length - 1],
      bounds: L.latLngBounds([lat[0], lon[0]], [lat[lat.length - 1], lon[lon.length - 1]]),
    }
  }, [lat, lon])

  /* ---------------------------------------------------------------- */
  /* Map instance                                                      */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    if (mapRef.current || !elRef.current) return undefined
    const map = L.map(elRef.current, {
      crs: L.CRS.EPSG3857,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: false,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 110,
      minZoom: 1,
      maxZoom: 19,
      worldCopyJump: false,
      maxBounds: L.latLngBounds([[-88.5, -400], [-18, 400]]),
      maxBoundsViscosity: 0.55,
      zoomAnimation: true,
      fadeAnimation: true,
      markerZoomAnimation: true,
      inertia: true,
    })
    map.setView([-60, 30], 2)
    mapRef.current = map

    for (const p of Object.values(PANE)) {
      map.createPane(p)
    }
    map.getPane(PANE.sic).style.zIndex = 350
    map.getPane(PANE.hatch).style.zIndex = 360
    map.getPane(PANE.geo).style.zIndex = 380
    map.getPane(PANE.route).style.zIndex = 450
    map.getPane(PANE.pin).style.zIndex = 620

    L.control.scale({ metric: true, imperial: false, position: 'bottomright' }).addTo(map)

    const ro = new ResizeObserver(() => map.invalidateSize({ animate: false }))
    ro.observe(elRef.current)
    return () => { ro.disconnect(); map.remove(); mapRef.current = null }
  }, [])

  /* ---------------------------------------------------------------- */
  /* Basemap                                                           */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (basemapRef.current) { map.removeLayer(basemapRef.current); basemapRef.current = null }
    const spec = basemapById(basemap)
    const t = L.tileLayer(spec.url, {
      attribution: spec.attribution,
      subdomains: spec.subdomains,
      maxNativeZoom: spec.maxNativeZoom,
      maxZoom: spec.maxZoom,
      crossOrigin: true,
      keepBuffer: 2,
    })
    t.addTo(map)
    t.bringToBack()
    basemapRef.current = t
  }, [basemap])

  /* ---------------------------------------------------------------- */
  /* Rasters, resampled into Mercator space                            */
  /* ---------------------------------------------------------------- */

  /** SIC / uncertainty / difference field, georeferenced to the real grid. */
  const fieldUrl = useMemo(() => {
    const src = renderMode === 'uncertainty' ? uncertainty : slice
    if (!src || !grid) return null
    const nR = src.nRows
    const nC = src.nCols
    const latTop = grid.latMax
    const latBot = grid.latMin
    const res = (latTop - latBot) / (nR - 1)
    const w = nC * SUP
    const h = Math.max(2, Math.round(nR * mercRatio(latTop, latBot) * SUP))
    const rowMap = mercRowMap(h, latTop, latBot, nR, res)

    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    const img = ctx.createImageData(w, h)
    const d = img.data
    const umax = uncMax || src.stats?.max || 1
    const dmax = diff?.vmax || 1

    for (let j = 0; j < h; j++) {
      const r = rowMap[j]
      for (let ci = 0; ci < nC; ci++) {
        const i = r * nC + ci
        const p = (j * nC + ci) * SUP * 4
        let rgb
        let alpha = 255
        if (renderMode === 'diff') {
          if (!diff) rgb = [10, 16, 26]
          else if (diff.navChange[i] === -1) rgb = [250, 205, 21]
          else if (diff.navChange[i] === 1) rgb = [56, 189, 248]
          else if (!Number.isFinite(diff.delta[i])) rgb = [46, 55, 68]
          else rgb = diffColor(diff.delta[i], dmax)
        } else if (renderMode === 'uncertainty') {
          if (!src.valid[i]) { rgb = [26, 31, 39]; alpha = 190 }
          else rgb = uncColor(src.values[i] / 255, umax)
        } else if (!src.valid[i]) {
          rgb = [46, 55, 68]
          alpha = 0 // drawn by the hatch layer, never as open water
        } else if (!layers.sic) {
          rgb = [10, 20, 34]
          alpha = 70
        } else {
          // Open water is nearly transparent so the real coastline, bathymetry
          // and place names underneath stay readable; the ice edge and the pack
          // build up to full opacity. The values themselves are untouched.
          const v = src.values[i] / 255
          rgb = sicColor(v)
          alpha = sicAlpha(v)
        }
        for (let sy = 0; sy < SUP; sy++) {
          const q = p + sy * nC * SUP * 4
          for (let sx = 0; sx < SUP; sx++) {
            d[q + sx * 4] = rgb[0]
            d[q + sx * 4 + 1] = rgb[1]
            d[q + sx * 4 + 2] = rgb[2]
            d[q + sx * 4 + 3] = alpha
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0)
    return c.toDataURL('image/png')
  }, [slice, uncertainty, diff, renderMode, uncMax, layers.sic, grid])

  /** Hatched mask for the REAL non-navigable (NaN) cells only. */
  const hatchUrl = useMemo(() => {
    const src = renderMode === 'uncertainty' ? uncertainty : slice
    if (!src || !grid || !layers.nonNav) return null
    const nR = src.nRows
    const nC = src.nCols
    const latTop = grid.latMax
    const latBot = grid.latMin
    const res = (latTop - latBot) / (nR - 1)
    const w = nC * SUP
    const h = Math.max(2, Math.round(nR * mercRatio(latTop, latBot) * SUP))
    const rowMap = mercRowMap(h, latTop, latBot, nR, res)

    const mask = document.createElement('canvas')
    mask.width = w
    mask.height = h
    const mctx = mask.getContext('2d')
    const mimg = mctx.createImageData(w, h)
    for (let j = 0; j < h; j++) {
      const r = rowMap[j]
      for (let ci = 0; ci < nC; ci++) {
        if (src.valid[r * nC + ci]) continue
        for (let sy = 0; sy < SUP; sy++) {
          const q = ((j * nC + ci) * SUP + sy * nC * SUP) * 4
          for (let sx = 0; sx < SUP; sx++) {
            mimg.data[q + sx * 4] = 255
            mimg.data[q + sx * 4 + 1] = 255
            mimg.data[q + sx * 4 + 2] = 255
            mimg.data[q + sx * 4 + 3] = 255
          }
        }
      }
    }
    mctx.putImageData(mimg, 0, 0)

    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    const octx = out.getContext('2d')
    octx.fillStyle = nonNavFill
    octx.fillRect(0, 0, w, h)
    octx.strokeStyle = 'rgba(198,214,236,0.45)'
    octx.lineWidth = 1.2
    for (let d = -h; d < w; d += 12) {
      octx.beginPath()
      octx.moveTo(d, 0)
      octx.lineTo(d + h, h)
      octx.stroke()
    }
    octx.globalCompositeOperation = 'destination-in'
    octx.drawImage(mask, 0, 0)
    return out.toDataURL('image/png')
  }, [slice, uncertainty, renderMode, layers.nonNav, grid])

  /** Optional forecast-uncertainty veil from the real artifact. */
  const uncUrl = useMemo(() => {
    if (!uncertainty || !grid) return null
    const nR = uncertainty.nRows
    const nC = uncertainty.nCols
    const latTop = grid.latMax
    const latBot = grid.latMin
    const res = (latTop - latBot) / (nR - 1)
    const w = nC * SUP
    const h = Math.max(2, Math.round(nR * mercRatio(latTop, latBot) * SUP))
    const rowMap = mercRowMap(h, latTop, latBot, nR, res)
    const umax = uncMax || uncertainty.stats?.max || 1
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    const img = ctx.createImageData(w, h)
    const d = img.data
    for (let j = 0; j < h; j++) {
      const r = rowMap[j]
      for (let ci = 0; ci < nC; ci++) {
        const i = r * nC + ci
        const p = (j * nC + ci) * SUP * 4
        const rgb = uncertainty.valid[i]
          ? uncColor(uncertainty.values[i] / 255, umax)
          : [26, 31, 39]
        for (let sy = 0; sy < SUP; sy++) {
          const q = p + sy * nC * SUP * 4
          for (let sx = 0; sx < SUP; sx++) {
            d[q + sx * 4] = rgb[0]
            d[q + sx * 4 + 1] = rgb[1]
            d[q + sx * 4 + 2] = rgb[2]
            d[q + sx * 4 + 3] = uncertainty.valid[i] ? 255 : 170
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0)
    return c.toDataURL('image/png')
  }, [uncertainty, uncMax, grid])

  const putRaster = useCallback((key, url, opacity) => {
    const map = mapRef.current
    if (!map) return
    const prev = layersRef.current[key]
    if (prev) { map.removeLayer(prev); layersRef.current[key] = null }
    if (!url || !grid) return
    const ov = L.imageOverlay(url, grid.bounds, {
      pane: key === 'hatch' ? PANE.hatch : PANE.sic,
      opacity,
      interactive: false,
      smoothEdges: false,
    })
    ov.addTo(map)
    ov.bringToBack()
    layersRef.current[key] = ov
  }, [grid])

  useEffect(() => { putRaster('sic', fieldUrl, sicOpacity) }, [fieldUrl, sicOpacity, putRaster])
  useEffect(() => { putRaster('hatch', hatchUrl, 1) }, [hatchUrl, putRaster])
  useEffect(() => {
    putRaster('unc', layers.uncertainty && renderMode === 'sic' ? uncUrl : null, 0.4)
  }, [uncUrl, layers.uncertainty, renderMode, putRaster])

  /* ---------------------------------------------------------------- */
  /* Coastline — real polygons, outline only so the imagery shows      */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const prev = layersRef.current.coast
    if (prev) { map.removeLayer(prev); layersRef.current.coast = null }
    if (!coastline) return
    const gl = L.geoJSON(clampCoastline(coastline), {
      pane: PANE.geo,
      interactive: false,
      style: {
        color: 'rgba(190,225,255,0.75)',
        weight: 1.2,
        fill: false,
        lineJoin: 'round',
        // no vertex simplification: the coastline is drawn exactly as the
        // API delivered it
        smoothFactor: 0,
      },
    })
    gl.addTo(map)
    layersRef.current.coast = gl
  }, [coastline])

  /* ---------------------------------------------------------------- */
  /* The route — straight from the backend A* + CostMap response       */
  /* ---------------------------------------------------------------- */
  const toLL = useCallback((path) => (path || []).map(([r, c]) => [lat[r], lon[c]]), [lat, lon])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const L2 = layersRef.current
    // EVERYTHING this effect creates goes into ONE group, so the teardown
    // above is exhaustive. Markers added straight to the map leaked on
    // re-render and piled up on the chart.
    if (L2.leg) { map.removeLayer(L2.leg); L2.leg = null }
    L2.arrows = null
    L2.routePts = null
    const leg = L.layerGroup()
    L2.leg = leg
    leg.addTo(map)
    const show = routeVisible && layers.route && primaryRoute && primaryRoute.length > 1
    if (!show) return

    const pts = toLL(primaryRoute)

    // pre-reroute corridor: dashed, and a wide halo when the two corridors
    // are identical so the dashed line is not hidden under the primary one
    if (originRoute && originRoute.length > 1) {
      const op = toLL(originRoute)
      leg.addLayer(L.polyline(op, { pane: PANE.route, color: 'rgba(4,9,16,0.85)', weight: 5, smoothFactor: 0, interactive: false }))
      leg.addLayer(corridorUnchanged
        ? L.polyline(op, { pane: PANE.route, color: 'rgba(251,191,36,0.22)', weight: 12, smoothFactor: 0, interactive: false })
        : L.polyline(op, { pane: PANE.route, color: 'rgba(4,9,16,0.6)', weight: 3, smoothFactor: 0, interactive: false }))
      leg.addLayer(L.polyline(op, {
        pane: PANE.route, color: ORIGIN_CSS, weight: 2, smoothFactor: 0,
        dashArray: '9 7', interactive: false,
      }))
    }

    // changed cells
    if (layers.rerouteDiff && changedCells && changedCells.size) {
      for (const k of changedCells) {
        const [r, c] = k.split(',').map(Number)
        leg.addLayer(L.circleMarker([lat[r], lon[c]], {
          pane: PANE.route, radius: 3.2, color: 'rgba(2,6,12,0.8)',
          weight: 1, fillColor: '#fbbf24', fillOpacity: 0.95, interactive: false,
        }))
      }
    }

    // primary corridor: casing -> glow -> colour -> bright core
    for (const [color, weight] of [
      [ROUTE_CASING, 8], [ROUTE_GLOW, 7], [ROUTE_MAIN, 4.4], [ROUTE_CORE, 2.2],
    ]) {
      leg.addLayer(L.polyline(pts, { pane: PANE.route, color, weight, smoothFactor: 0, interactive: false }))
    }

    // direction arrows along the travelled corridor
    const stride = Math.max(1, Math.floor(pts.length / 18))
    const arrows = []
    for (let i = stride; i < pts.length; i += stride) {
      const m = L.marker([pts[i][0], pts[i][1]], {
        pane: PANE.pin, interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'rt-arrow-wrap', iconSize: [14, 14], iconAnchor: [7, 7], html: '<span class="rt-arrow"></span>' }),
      })
      leg.addLayer(m)
      arrows.push(m)
    }
    L2.arrows = arrows
    L2.routePts = { pts, stride }
    angleArrows(map, arrows, pts, stride)

    // endpoints
    const start = L.marker(pts[0], {
      pane: PANE.pin, interactive: false, keyboard: false,
      icon: L.divIcon({ className: 'pin-wrap pin-start', iconSize: [30, 30], iconAnchor: [15, 15], html: '<span class="pin"><span class="pin-dot"></span></span>' }),
    })
    const goal = L.marker(pts[pts.length - 1], {
      pane: PANE.pin, interactive: false, keyboard: false,
      icon: L.divIcon({ className: 'pin-wrap pin-goal', iconSize: [30, 30], iconAnchor: [15, 15], html: '<span class="pin"><span class="pin-star"></span></span>' }),
    })
    start.bindTooltip('START', { permanent: true, direction: 'left', offset: [-16, 0], className: 'pin-label pin-label-start', interactive: false })
    goal.bindTooltip('DESTINATION', { permanent: true, direction: 'right', offset: [16, 0], className: 'pin-label pin-label-goal', interactive: false })
    leg.addLayer(start)
    leg.addLayer(goal)

    if (pulseT != null) {
      const n = Math.max(2, Math.round(pulseT * (pts.length - 1)) + 1)
      leg.addLayer(L.polyline(pts.slice(0, n), {
        pane: PANE.route, color: '#bae6fd', weight: 3.4, opacity: 0.9, smoothFactor: 0, interactive: false,
      }))
    }
    if (vesselT != null && layers.vessel) {
      leg.addLayer(L.marker(interp(pts, vesselT), {
        pane: PANE.pin, interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'pin-wrap pin-vessel', iconSize: [24, 24], iconAnchor: [12, 12], html: '<span class="pin"></span>' }),
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryRoute, originRoute, changedCells, routeVisible, pulseT, vesselT, corridorUnchanged, lat, lon, renderMode, layers, grid])

  /* Arrow bearings depend on the projection, so they are recomputed on zoom. */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return undefined
    const onZoom = () => {
      const arrows = layersRef.current.arrows
      if (!arrows || !arrows.length) return
      const src = layersRef.current.routePts
      if (!src) return
      angleArrows(map, arrows, src.pts, src.stride)
    }
    map.on('zoom', onZoom)
    map.on('zoomend', onZoom)
    return () => { map.off('zoom', onZoom); map.off('zoomend', onZoom) }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const onMove = () => {
      const arrows = layersRef.current.arrows
      const src = layersRef.current.routePts
      if (arrows && src) angleArrows(map, arrows, src.pts, src.stride)
    }
    map.on('move', onMove)
    return () => map.off('move', onMove)
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const onZoom = () => setZoom(map.getZoom() ?? 2)
    if (map) { onZoom(); map.on('zoomend', onZoom) }
    return () => { if (map) map.off('zoomend', onZoom) }
  }, [])

  /* ---------------------------------------------------------------- */
  /* Pending endpoint selection (before any route exists)              */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const prev = layersRef.current.sel
    if (prev) { map.removeLayer(prev); layersRef.current.sel = null }
    if (!selection || routeVisible) return
    const g = []
    const a = selection.start
    const b = selection.goal
    const at = (s) => [selection.lat[s.row], selection.lon[s.col]]
    if (a && b) {
      g.push(L.polyline([at(a), at(b)], {
        pane: PANE.route, color: 'rgba(226,240,255,0.6)', weight: 1.6, smoothFactor: 0,
        dashArray: '4 5', interactive: false,
      }))
    }
    const pin = (s, label, ok) => {
      if (!s) return
      const col = ok === false ? '#f87171' : label === 'START' ? '#34d399' : '#fbbf24'
      const m = L.marker(at(s), {
        pane: PANE.pin, interactive: false, keyboard: false,
        icon: L.divIcon({ className: 'pin-wrap pin-sel', iconSize: [26, 26], iconAnchor: [13, 13], html: `<span class="pin" style="--c:${col}"><span class="pin-hollow"></span></span>` }),
      })
      m.bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -14], className: 'pin-label pin-label-sel', interactive: false })
      g.push(m)
    }
    pin(a, 'START', a.navigable)
    pin(b, 'DEST', b.navigable)
    const grp = L.layerGroup(g)
    grp.addTo(map)
    layersRef.current.sel = grp
  }, [selection, routeVisible, lat.length, lon.length])

  /* ---------------------------------------------------------------- */
  /* Model-domain limit + grid frame, from the real grid definition    */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const prev = layersRef.current.frame
    if (prev) { map.removeLayer(prev); layersRef.current.frame = null }
    if (!grid) return
    const g = [
      L.rectangle(grid.bounds, {
        pane: PANE.geo, color: 'rgba(120,175,225,0.45)', weight: 1,
        fill: false, interactive: false, dashArray: null,
      }),
    ]
    const mb = -49.75
    if (mb > grid.latMin && mb < grid.latMax) {
      g.push(L.polyline([[mb, grid.lonMin], [mb, grid.lonMax]], {
        pane: PANE.geo, color: 'rgba(251,191,36,0.6)', weight: 1.2,
        dashArray: '7 5', interactive: false,
      }))
      g.push(L.marker([mb, grid.lonMin + 1.5], {
        pane: PANE.pin, interactive: false, keyboard: false,
        icon: L.divIcon({
          className: 'grid-note', iconSize: [200, 16], iconAnchor: [0, 0],
          html: '<span>SIC model domain limit &minus;49.75&deg;</span>',
        }),
      }))
    }
    const grp = L.layerGroup(g)
    grp.addTo(map)
    layersRef.current.frame = grp
  }, [grid])

  /* ---------------------------------------------------------------- */
  /* Home view: the routing grid, or the real route when there is one  */
  /* ---------------------------------------------------------------- */
  const fit = useCallback((ll, animate = true) => {
    const map = mapRef.current
    if (!map || !ll || !ll.length) return
    map.fitBounds(L.latLngBounds(ll), {
      paddingTopLeft: [58, 92],
      paddingBottomRight: [58, 118],
      animate,
      maxZoom: 8,
    })
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !grid) return
    if (primaryRoute && primaryRoute.length > 1) fit(toLL(primaryRoute), false)
    else fit([[grid.latMin, grid.lonMin], [grid.latMax, grid.lonMax]], false)
    // only on first grid arrival
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid?.latMin, grid?.lonMin])

  useEffect(() => {
    if (!primaryRoute || primaryRoute.length < 2) return
    fit(toLL(primaryRoute))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryRoute])

  /* ---------------------------------------------------------------- */
  /* Pointer: hover readout and click-to-pick                         */
  /* ---------------------------------------------------------------- */
  const cellAt = useCallback((ll) => {
    if (!slice || !lat.length) return null
    const { lat: la, lng: lo } = ll
    if (la < grid.latMin || la > grid.latMax || lo < grid.lonMin || lo > grid.lonMax) return null
    const c = Math.min(slice.nCols - 1, Math.max(0, Math.round((lo - grid.lonMin) / ((grid.lonMax - grid.lonMin) / (slice.nCols - 1)))))
    const r = Math.min(slice.nRows - 1, Math.max(0, Math.round((grid.latMax - la) / ((grid.latMax - grid.latMin) / (slice.nRows - 1)))))
    return { row: r, col: c }
  }, [slice, grid, lat.length])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return undefined
    const onMove = (e) => {
      const cell = cellAt(e.latlng)
      if (!cell || !slice) { setHover(null); if (onHoverCell) onHoverCell(null); return }
      const i = cell.row * slice.nCols + cell.col
      const isValid = !!slice.valid[i]
      const info = {
        lat: lat[cell.row], lon: lon[cell.col], row: cell.row, col: cell.col,
        valid: isValid,
        sic: isValid ? slice.values[i] / 255 : null,
        unc: uncertainty && uncertainty.valid[i] ? uncertainty.values[i] / 255 : null,
        inModelBand: cell.row < 101 && cell.col < 361,
      }
      const p = map.latLngToContainerPoint(e.latlng)
      setHover({ ...info, tx: p.x, ty: p.y })
      if (onHoverCell) onHoverCell(info)
    }
    const onOut = () => { setHover(null); if (onHoverCell) onHoverCell(null) }
    map.on('mousemove', onMove)
    map.on('mouseout', onOut)
    return () => { map.off('mousemove', onMove); map.off('mouseout', onOut) }
  }, [mapRef, cellAt, slice, uncertainty, lat, lon, onHoverCell])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return undefined
    const onClick = (e) => {
      if (!onPickCell || !pickMode) return
      const cell = cellAt(e.latlng)
      if (!cell) return
      onPickCell({
        ...cell,
        lat: lat[cell.row],
        lon: lon[cell.col],
        valid: !!slice.valid[cell.row * slice.nCols + cell.col],
      })
    }
    map.on('click', onClick)
    return () => map.off('click', onClick)
  }, [mapRef, cellAt, pickMode, onPickCell, lat, lon, slice])

  useEffect(() => {
    const el = elRef.current
    if (el) el.classList.toggle('picking', !!pickMode)
  }, [pickMode])

  /* ---------------------------------------------------------------- */
  /* Custom controls                                                  */
  /* ---------------------------------------------------------------- */
  const zoomBy = (d) => { const m = mapRef.current; if (m) m.setZoom(m.getZoom() + d) }
  const resetView = () => {
    const m = mapRef.current
    if (!m || !grid) return
    if (primaryRoute && primaryRoute.length > 1) fit(toLL(primaryRoute))
    else fit([[grid.latMin, grid.lonMin], [grid.latMax, grid.lonMax]])
  }

  return (
    <div className="map-shell">
      <div ref={elRef} className="leaflet-host" />

      {/* ------------------------------------------- map controls (zoom) */}
      <div className="map-ctrls">
        <button type="button" onClick={() => zoomBy(1)} title="Zoom in" aria-label="zoom in">+</button>
        <button type="button" onClick={() => zoomBy(-1)} title="Zoom out" aria-label="zoom out">&minus;</button>
        <button type="button" onClick={resetView} title="Reset view" aria-label="reset view">&#9102;</button>
        <button type="button" onClick={() => fit(primaryRoute ? toLL(primaryRoute) : null)}
          disabled={!primaryRoute || primaryRoute.length < 2}
          title="Fit the current route" aria-label="fit route">&#9678;</button>
        <span className="map-zoom">z{(zoom ?? 0).toFixed(1)}</span>
      </div>

      {/* ------------------------------------------- basemap switcher */}
      <div className="basemap-switch" role="group" aria-label="basemap">
        {BASEMAPS.map((b) => (
          <button
            key={b.id}
            type="button"
            className={b.id === basemap ? 'on' : ''}
            title={b.label.replace(/&amp;/g, '&')}
            aria-pressed={b.id === basemap}
            onClick={() => onBasemap && onBasemap(b.id)}
          >
            {b.short}
          </button>
        ))}
      </div>

      {/* ---------------- TOP LEFT · which field is on screen ---------------- */}
      <div className="hud hud-tl">
        <div className="ovb">
          <div className="ovb-t ok"><span className="pdot" />REAL SIC</div>
          <div className="ovb-v">{hud.date}</div>
          <div className="ovb-s"><b>D{hud.timestep}</b> &middot; {hud.source}</div>
        </div>
        {statusChip && statusChip.lines && statusChip.lines.length ? (
          <div className={`ovb status-chip ${statusChip.tone}`}>
            {statusChip.lines.map((l, i) => <div key={i} className="chip-l">{l}</div>)}
          </div>
        ) : null}
      </div>

      {/* ---------------- TOP RIGHT · the route result ---------------- */}
      <div className="hud hud-tr">
        {hud.showRoute ? (
          <div className="ovb right ok">
            <div className="ovb-t">ROUTE {hud.routeLabel}</div>
            <div className="ovb-v">{hud.waypoints} <em>waypoints</em></div>
            <div className="ovb-s">
              {hud.length} grid units &middot; {hud.lengthKm}
            </div>
            <div className="ovb-s">mean SIC {hud.meanSic} &middot; max {hud.maxSic}</div>
          </div>
        ) : (
          <div className="ovb right idle">
            <div className="ovb-t">ROUTE</div>
            <div className="ovb-v">AWAITING OPTIMIZE</div>
            <div className="ovb-s">press &ldquo;Optimize Route&rdquo; for A* + CostMap</div>
          </div>
        )}
      </div>

      {/* ---------------- BOTTOM LEFT · colour key ---------------- */}
      <div className="hud hud-bl">
        <div className="ovb">
          <div className="ovb-t">SIC LEGEND</div>
          <div className="ovb-ramp" />
          <div className="ovb-ticks"><span>0.0</span><span>0.5</span><span>1.0</span></div>
          <div className="ovb-keys">
            {hud.nonNav ? <span><i className="sw-nonnav" />non-navigable</span> : null}
            {hud.showRoute ? (
              <>
                <span><i className="sw-route" />route</span>
                {hud.hasReroute ? <span><i className="sw-orig" />original (D{hud.originStep})</span> : null}
                {hud.changedCells ? <span><i className="sw-changed" />changed ({hud.changedCells})</span> : null}
                <span><i className="sw-start" />start</span>
                <span><i className="sw-goal" />dest</span>
              </>
            ) : null}
          </div>
          {hud.navStats ? <div className="ovb-legend-stats">{hud.navStats}</div> : null}
          <label className="ovb-opacity">
            <span>SIC layer</span>
            <input type="range" min="0" max="1" step="0.05" value={sicOpacity}
              onChange={(e) => setSicOpacity(Number(e.target.value))}
              aria-label="SIC layer opacity" />
            <b>{Math.round(sicOpacity * 100)}%</b>
          </label>
        </div>
      </div>

      {/* ---------------- BOTTOM RIGHT · the leg + the vessel ---------------- */}
      <div className="hud hud-br">
        <div className="ovb right">
          <div className="ovb-t">START &rarr; DESTINATION</div>
          <div className="ovb-leg">
            <span className="tag t-start">START</span>
            <b>{hud.start}</b>
          </div>
          <div className="ovb-leg">
            <span className="tag t-dest">DEST</span>
            <b>{hud.goal}</b>
          </div>
          {hud.vessel ? (
            <div className="ovb-leg">
              <span className="tag t-vessel">VESSEL</span>
              <b>
                {hud.vessel.lat.toFixed(2)}&deg;, {hud.vessel.lon.toFixed(2)}&deg; &middot;{' '}
                {(hud.vessel.progress * 100).toFixed(1)}% &middot; SIC{' '}
                {hud.vessel.sic == null ? 'NaN' : hud.vessel.sic.toFixed(3)}
              </b>
            </div>
          ) : null}
        </div>
      </div>

      {hover ? (
        <div
          className="map-tip"
          style={{
            left: Math.min(Math.max(8, hover.tx + 14), Math.max(8, (elRef.current?.clientWidth || 400) - 210)),
            top: Math.min(Math.max(8, hover.ty + 12), Math.max(8, (elRef.current?.clientHeight || 300) - 118)),
          }}
        >
          <div className="tip-h">{hover.lat.toFixed(2)}&deg;, {hover.lon.toFixed(2)}&deg;</div>
          <div className="tip-r"><span>SIC</span><b>{hover.valid ? hover.sic.toFixed(4) : '—'}</b></div>
          {hover.unc != null ? (
            <div className="tip-r"><span>Uncertainty</span><b>{hover.unc.toFixed(4)}</b></div>
          ) : null}
          <div className="tip-r"><span>Cell</span><b>{hover.row}, {hover.col}</b></div>
          <div className={`tip-r ${hover.valid ? '' : 'bad'}`}>
            <span>State</span>
            <b>{hover.valid ? 'navigable' : 'NON-NAVIGABLE (NaN)'}</b>
          </div>
          {!hover.inModelBand ? (
            <div className="tip-r"><span>Band</span><b>outside model domain</b></div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Point at fraction t along a polyline, by arc length of the vertices. */
function interp(pts, t) {
  const f = Math.max(0, Math.min(1, t)) * (pts.length - 1)
  const i0 = Math.floor(f)
  const i1 = Math.min(pts.length - 1, i0 + 1)
  const k = f - i0
  return [pts[i0][0] + (pts[i1][0] - pts[i0][0]) * k, pts[i0][1] + (pts[i1][1] - pts[i0][1]) * k]
}

/**
 * Rotate each direction arrow to the SCREEN angle of the corridor, taken
 * from the basemap's own projection. Geographic bearings are not screen
 * bearings on a Mercator chart, so the arrows are measured where they are
 * actually drawn.
 */
function angleArrows(map, arrows, pts, stride) {
  if (!map || !arrows || !arrows.length) return
  for (let k = 0; k < arrows.length; k++) {
    const i = (k + 1) * stride
    if (i >= pts.length) break
    const a = map.latLngToContainerPoint(pts[i - stride])
    const b = map.latLngToContainerPoint(pts[i])
    const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 90
    const el = arrows[k].getElement()?.querySelector('.rt-arrow')
    if (el) el.style.transform = `rotate(${deg.toFixed(1)}deg)`
  }
}

/**
 * Antarctica encircles the pole, and Web Mercator stops at 85.05 deg, so the
 * polygon is closed along the projection limit instead of by a chord across
 * the Southern Ocean, and a dateline crossing is split into two rings.
 */
function clampCoastline(fc) {
  const LIMIT = 85.0
  const out = { type: 'FeatureCollection', features: [] }
  for (const f of fc.features || []) {
    const g = f.geometry
    if (!g) continue
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []
    const rings = []
    for (const poly of polys) {
      for (const ring of poly) {
        if (!ring || ring.length < 3) continue
        const pieces = []
        let cur = []
        let prevLon = null
        for (const pt of ring) {
          const lon = pt[0]
          const lat = Math.max(-LIMIT, pt[1])
          if (prevLon != null && Math.abs(lon - prevLon) > 180) {
            if (cur.length > 2) pieces.push(cur)
            cur = []
          }
          cur.push([lon, lat])
          prevLon = lon
        }
        if (cur.length > 2) pieces.push(cur)
        for (const piece of pieces) {
          const closed = piece.slice()
          closed.push([piece[0][0], -LIMIT], [piece[piece.length - 1][0], -LIMIT])
          rings.push(closed)
        }
      }
    }
    if (rings.length) out.features.push({ type: 'Feature', properties: f.properties || {}, geometry: { type: 'Polygon', coordinates: rings } })
  }
  return out
}

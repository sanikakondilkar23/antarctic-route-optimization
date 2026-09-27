import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { sicColor, sicAlpha, uncColor, diffColor } from '../api.js'

const NONNAV_RGB = [46, 55, 68]
const ROUTE_RGB = [240, 250, 255]
const ORIGIN_RGB = [251, 191, 36]
const LAND_FILL = [27, 37, 49]
const COAST_STROKE = 'rgba(133,170,206,0.62)'
const MIN_ZOOM = 1
const MAX_ZOOM = 9

/**
 * Central Antarctic digital-navigation chart.
 *
 * Layers, bottom to top — geography first, decision last:
 *
 *   1. basemap plate      ocean tint + graticule
 *   2. coastline          real Antarctic land polygons (map context)
 *   3. SIC raster         real /api/sic/<t> payload, alpha-weighted so the
 *                         geography reads through the open water
 *   4. non-navigable      hatched NaN cells (never zero-filled)
 *   5. uncertainty        optional artifact overlay
 *   6. route              original dashed -> updated primary -> changed cells
 *   7. endpoints          start ring, destination star, direction arrows
 *
 * Every raster is real: routing_sic_2026.npy and uncertainty_2026.npy via the
 * API. No image frames, no static basemap tiles, nothing synthesised.
 */
export default function SicMap({
  slice, lat, lon,
  uncertainty = null,
  diff = null,
  renderMode = 'sic',
  uncMax = null,
  layers,
  primaryRoute,
  originRoute,
  changedCells,
  routeVisible,
  pulseT = null,
  vesselT = null,
  corridorUnchanged = false,
  statusChip = null,
  onHoverCell,
  onPickCell,
  pickMode = null,
  selection = null,
  coastline = null,
  hud,
}) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const [size, setSize] = useState({ w: 960, h: 560 })
  const [hover, setHover] = useState(null)

  // fill the container exactly (no fixed pixel size -> always fits the viewport)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    const measure = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) {
        setSize({ w: Math.max(320, Math.floor(r.width)), h: Math.max(240, Math.floor(r.height)) })
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [])

  /* ------------------------------------------------------------------ */
  /* View state: zoom + pan over the fitted plate                        */
  /* ------------------------------------------------------------------ */
  const [view, setView] = useState({ zoom: 1, px: 0, py: 0 })
  const viewRef = useRef(view)
  viewRef.current = view
  const dragRef = useRef(null)

  const geo = useMemo(() => {
    const latMin = lat[0]
    const latMax = lat[lat.length - 1]
    const lonMin = lon[0]
    const lonMax = lon[lon.length - 1]
    const midLat = (latMin + latMax) / 2
    const aspect = 1 / Math.cos((Math.abs(midLat) * Math.PI) / 180)
    // The plate owns the frame. Horizontal padding is minimal (the raster is
    // wide) and the vertical padding is sized to clear the four HUD overlays,
    // which are absolutely positioned over the canvas corners.
    //
    // This matters: the verified leg runs Cape Town (-32.0, 82.0) -> Maitri
    // (-70.0, 10.5), so START sits on the exact top-right corner of the grid.
    // If the plate ran under the top-right overlay the start marker would be
    // hidden and the leg would read as unlabelled. Measured overlay heights are
    // ~55px (top) and ~63px (bottom) with a 9px inset, hence 68 / 74.
    const padX = 26
    const padTop = 68
    const padBottom = 74
    const availW = Math.max(40, size.w - padX * 2)
    const availH = Math.max(40, size.h - padTop - padBottom)
    const dataW = lonMax - lonMin
    const dataH = (latMax - latMin) * aspect
    const scale = Math.min(availW / dataW, availH / dataH)
    const w = dataW * scale
    const h = dataH * scale
    const x0 = padX + (availW - w) / 2
    const y0 = padTop + (availH - h) / 2

    const z = view.zoom
    const s = scale * z
    // Latitude is stretched by the aspect factor, longitude is not: that is
    // what makes a 0.25 deg cell square-ish on the plate at this latitude.
    // Every vertical measure below uses `sy`, never `s`, or the raster and the
    // route drawn on top of it drift apart.
    const sy = s * aspect
    const vw = dataW * s
    const vh = (latMax - latMin) * sy
    const px = view.px
    const py = view.py
    return {
      latMin, latMax, lonMin, lonMax, aspect, scale, x0, y0, w, h,
      zoom: z, vw, vh, px, py,
      x: (lo) => x0 + px + (lo - lonMin) * s,
      y: (la) => y0 + py + (latMax - la) * sy,
      cellW: s * 0.25,
      cellH: sy * 0.25,
    }
  }, [lat, lon, size, view])

  const clampPan = useCallback((px, py, z) => {
    if (!lat.length || !lon.length) return { px, py }
    const latMin = lat[0]
    const latMax = lat[lat.length - 1]
    const lonMin = lon[0]
    const lonMax = lon[lon.length - 1]
    const midLat = (latMin + latMax) / 2
    const aspect = 1 / Math.cos((Math.abs(midLat) * Math.PI) / 180)
    const padX = 26
    const padTop = 68
    const padBottom = 74
    const availW = Math.max(40, size.w - padX * 2)
    const availH = Math.max(40, size.h - padTop - padBottom)
    const dataW = lonMax - lonMin
    const dataH = (latMax - latMin) * aspect
    const scale = Math.min(availW / dataW, availH / dataH)
    const s = scale * z
    const vw = dataW * s
    const vh = dataH * s
    const x0 = padX + (availW - dataW * scale) / 2
    const y0 = padTop + (availH - dataH * scale) / 2
    // Keep at least 110px of the plate on screen, and never let more than
    // ~120px of empty margin accumulate on the far side.
    const limX = Math.max(0, (vw - 110) / 2) + Math.max(0, (size.w - vw) / 2)
    const limY = Math.max(0, (vh - 110) / 2) + Math.max(0, (size.h - vh) / 2)
    return {
      px: Math.max(-x0 - limX, Math.min(size.w - x0 - vw + limX, px)),
      py: Math.max(-y0 - limY, Math.min(size.h - y0 - vh + limY, py)),
    }
  }, [lat, lon, size])

  const zoomBy = useCallback((factor, cx, cy) => {
    setView((v) => {
      const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.zoom * factor))
      if (z === v.zoom) return v
      // keep the point under the cursor fixed
      const k = z / v.zoom
      const px = cx - (cx - v.px) * k
      const py = cy - (cy - v.py) * k
      const c = clampPan(px, py, z)
      return { zoom: z, px: c.px, py: c.py }
    })
  }, [clampPan])

  const resetView = useCallback(() => setView({ zoom: 1, px: 0, py: 0 }), [])

  /** Fit the view to a route's bounding box, keeping the aspect correction. */
  const fitToRoute = useCallback((path) => {
    if (!path || path.length < 2 || !lat.length) return
    let r0 = Infinity; let r1 = -Infinity; let c0 = Infinity; let c1 = -Infinity
    for (const [r, c] of path) {
      if (r < r0) r0 = r; if (r > r1) r1 = r
      if (c < c0) c0 = c; if (c > c1) c1 = c
    }
    // Margin in degrees, so short legs still get breathing room.
    const padLon = 3
    const padLat = 2
    const latMin0 = lat[0]
    const latMax0 = lat[lat.length - 1]
    const lonMin0 = lon[0]
    const lonMax0 = lon[lon.length - 1]
    const boxLonMin = Math.max(lonMin0, lon[c0] - padLon)
    const boxLonMax = Math.min(lonMax0, lon[c1] + padLon)
    const boxLatMax = Math.min(latMax0, lat[r1] + padLat)
    const boxLatMin = Math.max(latMin0, lat[r0] - padLat)
    if (!(boxLonMax > boxLonMin) || !(boxLatMax > boxLatMin)) return

    const midLat = (latMin0 + latMax0) / 2
    const aspect = 1 / Math.cos((Math.abs(midLat) * Math.PI) / 180)
    const spanLon = boxLonMax - boxLonMin
    const spanLat = (boxLatMax - boxLatMin) * aspect
    const padX = 26; const padTop = 68; const padBottom = 74
    const availW = Math.max(40, size.w - padX * 2)
    const availH = Math.max(40, size.h - padTop - padBottom)
    const dataW = lonMax0 - lonMin0
    const dataH = (latMax0 - latMin0) * aspect
    const base = Math.min(availW / dataW, availH / dataH)
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM,
      Math.min(availW / (spanLon * base), availH / (spanLat * base))))
    const s = base * z
    const sy = s * aspect
    const w = dataW * s
    const h = dataH * s
    const x0 = padX + (availW - dataW * base) / 2
    const y0 = padTop + (availH - dataH * base) / 2
    // centre the route's box on the plate. boxH is measured in RAW latitude
    // degrees because `sy` is px per raw degree; spanLat (projected degrees)
    // is only used above to solve for the zoom.
    const boxX = x0 + (boxLonMin - lonMin0) * s
    const boxY = y0 + (latMax0 - boxLatMax) * sy
    const boxW = spanLon * s
    const boxH = (boxLatMax - boxLatMin) * sy
    const c = clampPan(size.w / 2 - boxX - boxW / 2,
      size.h / 2 - boxY - boxH / 2, z)
    setView({ zoom: z, px: c.px, py: c.py })
  }, [lat, lon, size, clampPan])

  // Re-fit only when a genuinely different route arrives, so the operator's
  // own zoom/pan is not thrown away by unrelated re-renders.
  const fitKey = primaryRoute ? `${primaryRoute.length}:${primaryRoute[0]}:${primaryRoute[primaryRoute.length - 1]}` : ''
  const lastFit = useRef('')
  useEffect(() => {
    if (fitKey && fitKey !== lastFit.current) {
      lastFit.current = fitKey
      fitToRoute(primaryRoute)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey])

  /* ---------------------------------------------------------------- */
  /* Base raster — one canvas, rebuilt only when the frame changes.     */
  /* ---------------------------------------------------------------- */
  const fieldCanvas = useMemo(() => {
    const src = renderMode === 'uncertainty' ? uncertainty : slice
    if (!src) return null
    const nR = src.nRows
    const nC = src.nCols
    const c = document.createElement('canvas')
    c.width = nR
    c.height = nC
    const ctx = c.getContext('2d')
    const img = ctx.createImageData(nR, nC)
    const d = img.data
    const umax = uncMax || src.stats?.max || 1
    const dmax = diff?.vmax || 1
    for (let r = 0; r < nR; r++) {
      for (let cIdx = 0; cIdx < nC; cIdx++) {
        const srcRow = nR - 1 - r
        const i = srcRow * nC + cIdx
        const p = (r * nC + cIdx) * 4
        let rgb
        let alpha = 255
        if (renderMode === 'diff') {
          if (!diff) rgb = [10, 16, 26]
          else if (diff.navChange[i] === -1) rgb = [250, 205, 21]        // became non-navigable
          else if (diff.navChange[i] === 1) rgb = [56, 189, 248]         // became navigable
          else if (!Number.isFinite(diff.delta[i])) rgb = NONNAV_RGB
          else rgb = diffColor(diff.delta[i], dmax)
        } else if (renderMode === 'uncertainty') {
          if (!src.valid[i]) { rgb = [26, 31, 39]; alpha = 190 }
          else rgb = uncColor(src.values[i] / 255, umax)
        } else {
          // Real SIC. Open water is nearly transparent so the coastline and
          // graticule underneath stay readable; the ice edge and the pack
          // build up to full opacity. The values themselves are untouched.
          if (!src.valid[i]) {
            rgb = NONNAV_RGB
            alpha = 0 // non-navigable is drawn by the hatch layer, not here
          } else if (!layers.sic) {
            rgb = [10, 20, 34]
            alpha = 90
          } else {
            const v = src.values[i] / 255
            rgb = sicColor(v)
            alpha = sicAlpha(v)
          }
        }
        d[p] = rgb[0]; d[p + 1] = rgb[1]; d[p + 2] = rgb[2]; d[p + 3] = alpha
      }
    }
    ctx.putImageData(img, 0, 0)
    return c
  }, [slice, uncertainty, diff, renderMode, uncMax, layers.nonNav, layers.sic])

  /**
   * Hatch overlay for NON-NAVIGABLE cells only.
   *
   * Built once per frame at 4x raster resolution and simply scaled onto
   * the plate, so hatching is cheap and — importantly — marks only the real
   * NaN cells. Hatching the whole plate would misrepresent 83 % of the grid
   * (navigable) as closed water.
   */
  const hatchCanvas = useMemo(() => {
    const src = renderMode === 'uncertainty' ? uncertainty : slice
    if (!src || !layers.nonNav) return null
    const S = 4
    const w = src.nRows * S
    const h = src.nCols * S
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    ctx.fillStyle = 'rgba(84,98,120,0.5)'
    for (let r = 0; r < src.nRows; r++) {
      for (let cIdx = 0; cIdx < src.nCols; cIdx++) {
        if (src.valid[r * src.nCols + cIdx]) continue
        ctx.fillRect(cIdx * S, (src.nRows - 1 - r) * S, S, S)
      }
    }
    ctx.strokeStyle = 'rgba(190,205,225,0.42)'
    ctx.lineWidth = 1.4
    for (let d = -h; d < w; d += 14) {
      ctx.beginPath()
      ctx.moveTo(d, 0)
      ctx.lineTo(d + h, h)
      ctx.stroke()
    }
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    const octx = out.getContext('2d')
    octx.drawImage(c, 0, 0)
    octx.globalCompositeOperation = 'destination-in'
    const mask = document.createElement('canvas')
    mask.width = w
    mask.height = h
    const mctx = mask.getContext('2d')
    mctx.fillStyle = '#fff'
    for (let r = 0; r < src.nRows; r++) {
      for (let cIdx = 0; cIdx < src.nCols; cIdx++) {
        if (src.valid[r * src.nCols + cIdx]) continue
        mctx.fillRect(cIdx * S, (src.nRows - 1 - r) * S, S, S)
      }
    }
    octx.drawImage(mask, 0, 0)
    return out
  }, [slice, uncertainty, renderMode, layers.nonNav])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (canvas.width !== Math.floor(size.w * dpr) || canvas.height !== Math.floor(size.h * dpr)) {
      canvas.width = Math.floor(size.w * dpr)
      canvas.height = Math.floor(size.h * dpr)
    }
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)

    ctx.fillStyle = '#04070d'
    ctx.fillRect(0, 0, size.w, size.h)

    // The grid arrives asynchronously; there is nothing to project until it
    // does, and a non-finite projection would throw inside the gradient.
    if (!lat.length || !lon.length || !Number.isFinite(geo.vw) || geo.vw <= 0) return

    const { x0, y0, w, h, x, y } = geo
    // Zoom/pan-aware destination rect for the raster layers.
    const rx = x(geo.lonMin)
    const ry = y(geo.latMax)
    const rw = geo.vw
    const rh = geo.vh

    /* ------------------------------------------------ 1. basemap plate */
    const g = ctx.createLinearGradient(rx, ry, rx, ry + rh)
    g.addColorStop(0, '#071320')
    g.addColorStop(0.55, '#06101c')
    g.addColorStop(1, '#050d17')
    ctx.fillStyle = g
    ctx.fillRect(rx, ry, rw, rh)

    /* --------------------------------- 2. real Antarctic coastline  */
    if (coastline) drawCoastline(ctx, coastline, x, y, ry + rh)

    /* --------------------------------------------- 3. real SIC raster  */
    if (fieldCanvas) {
      ctx.save()
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(fieldCanvas, rx, ry, rw, rh)
      ctx.restore()
    }

    if (hatchCanvas) {
      ctx.save()
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(hatchCanvas, rx, ry, rw, rh)
      ctx.restore()
    }

    // uncertainty layer: a confidence veil over the SIC plate
    if (layers.uncertainty && renderMode === 'sic' && uncertainty) {
      ctx.save()
      ctx.globalAlpha = 0.42
      ctx.globalCompositeOperation = 'screen'
      const ve = document.createElement('canvas')
      ve.width = uncertainty.nRows
      ve.height = uncertainty.nCols
      const vctx = ve.getContext('2d')
      const vimg = vctx.createImageData(uncertainty.nRows, uncertainty.nCols)
      const umax = uncMax || uncertainty.stats?.max || 1
      for (let r = 0; r < uncertainty.nRows; r++) {
        for (let c = 0; c < uncertainty.nCols; c++) {
          const i = r * uncertainty.nCols + c
          const p = ((uncertainty.nRows - 1 - r) * uncertainty.nCols + c) * 4
          if (!uncertainty.valid[i]) { vimg.data[p + 3] = 0; continue }
          const [rr, gg, bb] = uncColor(uncertainty.values[i] / 255, umax)
          vimg.data[p] = rr; vimg.data[p + 1] = gg; vimg.data[p + 2] = bb; vimg.data[p + 3] = 255
        }
      }
      vctx.putImageData(vimg, 0, 0)
      ctx.imageSmoothingEnabled = true
      // The uncertainty artifact only covers the model band (top-left of the
      // plate), so it is clipped to that band rather than smeared across the
      // extension rows, which have no uncertainty value at all.
      ctx.beginPath()
      ctx.rect(rx, ry, Math.min(rw, (uncertainty.nCols / slice.nCols) * rw),
        Math.min(rh, (uncertainty.nRows / slice.nRows) * rh))
      ctx.clip()
      ctx.drawImage(ve, rx, ry, rw, rh)
      ctx.restore()
    }

    /* ------------------------------------ 4. frame + graticule (subtle) */
    ctx.strokeStyle = 'rgba(120,160,200,0.30)'
    ctx.lineWidth = 1
    ctx.strokeRect(rx, ry, rw, rh)
    ctx.fillStyle = 'rgba(190,214,240,0.62)'
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
    for (let la = -75; la <= -30; la += 5) {
      const yy = y(la)
      if (yy < ry || yy > ry + rh) continue
      ctx.strokeStyle = 'rgba(120,160,200,0.13)'
      ctx.beginPath(); ctx.moveTo(rx, yy); ctx.lineTo(rx + rw, yy); ctx.stroke()
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
      ctx.fillText(`${la}\u00b0`, rx - 6, yy)
    }
    // Guard bands, proportional to the plate: wide enough to clear the
    // bottom-corner HUD overlays, never so wide that the graticule loses its
    // labels on a short screen.
    const guardL = Math.min(210, rw * 0.17)
    const guardR = Math.min(220, rw * 0.18)
    for (let lo = -10; lo <= 80; lo += 10) {
      const xx = x(lo)
      if (xx < rx || xx > rx + rw) continue
      // The two bottom HUD overlays occupy the plate's lower corners; drop any
      // longitude label that would render underneath one of them rather than
      // let the text collide with the SIC legend / leg readout.
      if (xx < rx + guardL || xx > rx + rw - guardR) continue
      ctx.strokeStyle = 'rgba(120,160,200,0.13)'
      ctx.beginPath(); ctx.moveTo(xx, ry); ctx.lineTo(xx, ry + rh); ctx.stroke()
      ctx.fillStyle = 'rgba(190,214,240,0.62)'
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'
      ctx.fillText(`${lo}°`, xx, ry + rh + 5)
    }

    // ---- scale bar: real 0.25 deg grid, labelled in km at the mid latitude
    // Centred on the lower edge of the plate, which is the only strip left
    // free by the two bottom HUD overlays.
    {
      const midLat = (geo.latMin + geo.latMax) / 2
      const kmPerDeg = 111.32 * Math.cos((Math.abs(midLat) * Math.PI) / 180)
      // pick a round distance that lands near 130px at the current zoom
      const targetKm = [50, 100, 200, 500, 1000, 2000]
        .reduce((a, b) => (Math.abs((b / kmPerDeg) * geo.scale * geo.zoom - 130)
          < Math.abs((a / kmPerDeg) * geo.scale * geo.zoom - 130) ? b : a))
      const px = (targetKm / kmPerDeg) * geo.scale * geo.zoom
      const bx = rx + rw / 2 - px / 2
      const by = ry + rh - 15
      ctx.save()
      ctx.fillStyle = 'rgba(4,9,16,0.72)'
      ctx.strokeStyle = 'rgba(120,160,210,0.28)'
      ctx.lineWidth = 1
      ctx.beginPath()
      if (ctx.roundRect) ctx.roundRect(bx - 7, by - 17, px + 14, 26, 6)
      else ctx.rect(bx - 7, by - 17, px + 14, 26)
      ctx.fill()
      ctx.stroke()
      ctx.strokeStyle = 'rgba(232,244,255,0.9)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(bx, by - 5); ctx.lineTo(bx, by); ctx.lineTo(bx + px, by)
      ctx.lineTo(bx + px, by - 5)
      ctx.stroke()
      ctx.fillStyle = 'rgba(232,244,255,0.95)'
      ctx.font = 'bold 9px ui-monospace, monospace'
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
      ctx.fillText(`${targetKm.toLocaleString()} km`, bx + px / 2, by - 6)
      ctx.restore()
    }

    // model-domain limit
    const mb = -49.75
    if (mb > geo.latMin && mb < geo.latMax) {
      ctx.save()
      ctx.setLineDash([7, 5])
      ctx.strokeStyle = 'rgba(251,191,36,0.55)'
      ctx.lineWidth = 1.1
      ctx.beginPath(); ctx.moveTo(rx, y(mb)); ctx.lineTo(rx + rw, y(mb)); ctx.stroke()
      ctx.restore()
      ctx.fillStyle = 'rgba(251,191,36,0.7)'
      ctx.font = '9px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'
      ctx.fillText('SIC model domain limit  -49.75' + String.fromCharCode(176), rx + 5, y(mb) - 3)
    }

    if (!routeVisible || !layers.route) {
      // No route yet: still draw the operator's pending start / destination so
      // the selection is visible on the chart before anything is optimized.
      if (selection) {
        drawSelection(ctx, x, y, selection,
          Math.max(1, Math.min(1.6, size.w / 1100)), geo)
      }
      return
    }

    const toXY = (path) => path.map(([r, c]) => [x(lon[c]), y(lat[r])])
    const stroke = (pts, color, width, dash) => {
      ctx.save()
      if (dash) ctx.setLineDash(dash)
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'
      ctx.beginPath()
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)))
      ctx.stroke()
      ctx.restore()
    }
    const pointAt = (pts, t) => {
      const fi = Math.max(0, Math.min(1, t)) * (pts.length - 1)
      const i0 = Math.floor(fi)
      const i1 = Math.min(pts.length - 1, i0 + 1)
      const f = fi - i0
      return [pts[i0][0] + (pts[i1][0] - pts[i0][0]) * f, pts[i0][1] + (pts[i1][1] - pts[i0][1]) * f]
    }

    const primary = primaryRoute && primaryRoute.length > 1 ? toXY(primaryRoute) : null
    // Stroke weight grows a little with zoom so the corridor keeps its
    // presence when the operator dives into the ice edge.
    const scale = Math.max(1, Math.min(2.1, size.w / 1100 + (geo.zoom - 1) * 0.16))

    // ---- secondary: pre-reroute original path (dashed, amber) ----
    // When the re-optimised corridor is identical to the original (verified
    // case: 0 changed cells) the dashed line would be hidden under the
    // primary stroke, so it is drawn as a wide halo *behind* it. That keeps
    // both visible and honest: nothing is invented, the two paths simply
    // overlap.
    if (originRoute && originRoute.length > 1) {
      const op = toXY(originRoute)
      stroke(op, 'rgba(4,9,16,0.85)', 5, null)
      if (corridorUnchanged) {
        stroke(op, `rgba(${ORIGIN_RGB.join(',')},0.20)`, 11 * scale, null)
      }
      stroke(op, `rgba(${ORIGIN_RGB.join(',')},0.95)`, 2.0, [9, 7])
    }

    if (!primary) return

    // ---- changed cells emphasis ----
    if (layers.rerouteDiff && changedCells && changedCells.size) {
      ctx.fillStyle = 'rgba(251,191,36,0.95)'
      for (const key of changedCells) {
        const [r, c] = key.split(',').map(Number)
        ctx.beginPath()
        ctx.arc(x(lon[c]), y(lat[r]), Math.max(2.8, geo.cellW * 0.5), 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // ---- primary route: dark casing, wide glow, bright core ----
    stroke(primary, 'rgba(2,6,12,0.92)', 8 * scale, null)
    stroke(primary, 'rgba(56,189,248,0.34)', 7 * scale, null)
    stroke(primary, 'rgba(56,189,248,0.85)', 4.4 * scale, null)
    stroke(primary, `rgba(${ROUTE_RGB.join(',')},0.99)`, 2.4 * scale, null)

    // action sweep: a comet running the full length + fading bloom
    if (pulseT != null) {
      const fade = Math.max(0, 1 - pulseT)
      ctx.save()
      ctx.globalAlpha = 0.35 + 0.65 * fade
      ctx.strokeStyle = 'rgba(56,189,248,0.95)'
      ctx.lineWidth = 3.2 * scale
      ctx.shadowColor = 'rgba(56,189,248,0.95)'
      ctx.shadowBlur = 20 * fade + 6
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'
      ctx.beginPath()
      primary.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)))
      ctx.stroke()
      ctx.restore()

      const [cx, cy] = pointAt(primary, pulseT)
      ctx.beginPath(); ctx.arc(cx, cy, 11 * scale, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(56,189,248,${0.16 + 0.24 * fade})`; ctx.fill()
      ctx.beginPath(); ctx.arc(cx, cy, 5 * scale, 0, Math.PI * 2)
      ctx.fillStyle = '#e8f7ff'; ctx.fill()
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(56,189,248,1)'; ctx.stroke()
    }

    // direction arrows — route direction
    const stride = Math.max(1, Math.floor(primary.length / 16))
    ctx.fillStyle = 'rgba(232,247,255,0.85)'
    for (let i = stride; i < primary.length; i += stride) {
      const [x1, y1] = primary[i - 1]
      const [x2, y2] = primary[i]
      const a = Math.atan2(y2 - y1, x2 - x1)
      const mx = (x1 + x2) / 2
      const my = (y1 + y2) / 2
      const s = 5.5 * scale
      ctx.beginPath()
      ctx.moveTo(mx + Math.cos(a) * s, my + Math.sin(a) * s)
      ctx.lineTo(mx + Math.cos(a + 2.5) * s, my + Math.sin(a + 2.5) * s)
      ctx.lineTo(mx + Math.cos(a - 2.5) * s, my + Math.sin(a - 2.5) * s)
      ctx.closePath()
      ctx.fill()
    }

    // start / goal — the decision points, drawn last and largest
    const [sx, sy] = primary[0]
    const [gx, gy] = primary[primary.length - 1]

    ctx.save()
    ctx.shadowColor = 'rgba(0,0,0,0.85)'
    ctx.shadowBlur = 10
    ctx.beginPath(); ctx.arc(sx, sy, 13, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(52,211,153,0.20)'; ctx.fill()
    ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2)
    ctx.fillStyle = '#34d399'; ctx.fill()
    ctx.lineWidth = 2.6; ctx.strokeStyle = '#ffffff'; ctx.stroke()
    ctx.restore()
    drawStar(ctx, gx, gy, 15, '#f87171')

    // Marker labels are always placed INSIDE the plate. Both endpoints of the
    // real leg sit on the domain boundary (START is the top-right grid
    // corner), so a naive outward offset would push the text off the raster.
    ctx.font = 'bold 12.5px ui-sans-serif, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    const label = (text, px, py, preferLeft) => {
      const tw = ctx.measureText(text).width
      let left = preferLeft
    if (preferLeft && px - 14 - tw < geo.x(geo.lonMin) + 2) left = false
    if (!preferLeft && px + 14 + tw > geo.x(geo.lonMin) + geo.vw - 2) left = true
      let ty = py
      if (py + 15 > geo.y0 + geo.h - 2) ty = py - 16
      if (ty - 6 < geo.y0 + 2) ty = py + 16
      ctx.textAlign = left ? 'right' : 'left'
      ctx.fillStyle = left ? '#a7f3d0' : '#fecaca'
      ctx.fillText(text, px + (left ? -14 : 14), ty)
    }
    // START hugs the top-right corner -> read it to the left of the dot.
    label('START', sx, sy, true)
    label('DEST', gx, gy, false)

    // vessel
    if (vesselT != null && layers.vessel) {
      const [vx, vy] = pointAt(primary, vesselT)
      ctx.beginPath(); ctx.arc(vx, vy, 13, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(56,189,248,0.24)'; ctx.fill()
      ctx.beginPath(); ctx.arc(vx, vy, 6, 0, Math.PI * 2)
      ctx.fillStyle = '#38bdf8'; ctx.fill()
      ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke()
      ctx.font = 'bold 10px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
      ctx.fillStyle = '#bae6fd'
      ctx.fillText('VESSEL', vx, vy - 14)
    }

    // ---- action status chip: makes the result of a click unmistakable ----
    if (statusChip && statusChip.lines && statusChip.lines.length) {
      const lines = statusChip.lines
      const fs = 12
      const padX = 11
      const padY = 8
      const lh = 16
      ctx.font = `bold ${fs}px ui-sans-serif, system-ui, sans-serif`
      const wBox = Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2
      const hBox = lines.length * lh + padY * 2 - 4
      const bx = rx + 12
      const by = geo.y0 + 12
      ctx.save()
      ctx.beginPath()
      if (ctx.roundRect) ctx.roundRect(bx, by, wBox, hBox, 9)
      else ctx.rect(bx, by, wBox, hBox)
      ctx.fillStyle = statusChip.tone === 'ok'
        ? 'rgba(4,26,18,0.92)'
        : statusChip.tone === 'warn'
          ? 'rgba(38,26,4,0.92)'
          : 'rgba(6,12,22,0.92)'
      ctx.fill()
      ctx.lineWidth = 1.4
      ctx.strokeStyle = statusChip.tone === 'ok'
        ? 'rgba(52,211,153,0.85)'
        : statusChip.tone === 'warn'
          ? 'rgba(251,191,36,0.85)'
          : 'rgba(56,189,248,0.85)'
      ctx.stroke()
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      ctx.fillStyle = statusChip.tone === 'ok'
        ? '#d1fae5'
        : statusChip.tone === 'warn'
          ? '#fde68a'
          : '#e0f2fe'
      lines.forEach((l, i) => ctx.fillText(l, bx + padX, by + padY + i * lh))
      ctx.restore()
    }
  }, [fieldCanvas, hatchCanvas, geo, lon, lat, primaryRoute, originRoute, changedCells,
      routeVisible, pulseT, vesselT, size, corridorUnchanged, statusChip,
      renderMode, uncertainty, uncMax, diff, layers, selection, coastline])

  useEffect(() => { draw() }, [draw])

  /** Pixel -> grid cell, or null when the pointer is off the plate. */
  const cellAt = (ev) => {
    const canvas = canvasRef.current
    if (!canvas || !slice) return null
    const r = canvas.getBoundingClientRect()
    const px = ev.clientX - r.left
    const py = ev.clientY - r.top
    const rx = geo.x(geo.lonMin)
    const ry = geo.y(geo.latMax)
    if (px < rx || px > rx + geo.vw || py < ry || py > ry + geo.vh) return null
    const c = Math.min(slice.nCols - 1, Math.max(0,
      Math.floor(((px - rx) / geo.vw) * slice.nCols)))
    const rIdx = Math.min(slice.nRows - 1, Math.max(0,
      Math.floor((1 - (py - ry) / geo.vh) * slice.nRows)))
    return { row: rIdx, col: c }
  }

  const localPos = (ev) => {
    const canvas = canvasRef.current
    if (!canvas) return { px: 0, py: 0 }
    const r = canvas.getBoundingClientRect()
    return { px: ev.clientX - r.left, py: ev.clientY - r.top }
  }

  const handleMove = (ev) => {
    const cell = cellAt(ev)
    if (!cell || !slice) { setHover(null); if (onHoverCell) onHoverCell(null); return }
    const { row: rIdx, col: c } = cell
    const i = rIdx * slice.nCols + c
    const isValid = !!slice.valid[i]
    const { px, py } = localPos(ev)
    const info = {
      lat: lat[rIdx], lon: lon[c], row: rIdx, col: c,
      valid: isValid,
      sic: isValid ? slice.values[i] / 255 : null,
      unc: uncertainty && uncertainty.valid[i] ? uncertainty.values[i] / 255 : null,
      inModelBand: rIdx < 101 && c < 361,
    }
    setHover({ ...info, tx: px, ty: py })
    if (onHoverCell) onHoverCell(info)
  }

  /* --------------------------------------------------- pan and zoom */
  // React attaches wheel as a PASSIVE listener, so preventDefault() inside the
  // synthetic handler is rejected by the browser and the page scrolls/zooms
  // underneath the chart. A native non-passive listener is the only way to
  // own the wheel on the plate.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const onWheelNative = (ev) => {
      ev.preventDefault()
      const r = canvas.getBoundingClientRect()
      zoomBy(ev.deltaY < 0 ? 1.22 : 1 / 1.22, ev.clientX - r.left, ev.clientY - r.top)
    }
    canvas.addEventListener('wheel', onWheelNative, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheelNative)
  }, [zoomBy])

  const onPointerDown = (ev) => {
    if (ev.button !== 0) return
    // While placing an endpoint a click means "put it here", not "drag".
    if (pickMode) return
    const { px, py } = localPos(ev)
    dragRef.current = { px, py, vx: viewRef.current.px, vy: viewRef.current.py }
    ev.currentTarget.setPointerCapture?.(ev.pointerId)
  }

  const onPointerMove = (ev) => {
    if (!dragRef.current) { handleMove(ev); return }
    const { px, py } = localPos(ev)
    const d = dragRef.current
    const nx = d.vx + (px - d.px)
    const ny = d.vy + (py - d.py)
    setView((v) => {
      const c = clampPan(nx, ny, v.zoom)
      return { zoom: v.zoom, px: c.px, py: c.py }
    })
  }

  const endDrag = (ev) => {
    if (!dragRef.current) return
    dragRef.current = null
    ev.currentTarget.releasePointerCapture?.(ev.pointerId)
  }

  /**
   * Click-to-place. The cell is handed to the parent as grid indices; the
   * parent turns it into lat/lon and the BACKEND decides whether that cell is
   * an acceptable endpoint. The chart never decides navigability itself.
   */
  const handleClick = (ev) => {
    if (!onPickCell || !pickMode) return
    const cell = cellAt(ev)
    if (!cell) return
    onPickCell({
      ...cell,
      lat: lat[cell.row],
      lon: lon[cell.col],
      valid: !!slice.valid[cell.row * slice.nCols + cell.col],
    })
  }

  return (
    <div className="map-shell">
      <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }}>
        <canvas
          ref={canvasRef}
          style={{
            width: size.w,
            height: size.h,
            cursor: pickMode ? 'crosshair' : (dragRef.current ? 'grabbing' : 'grab'),
          }}
          onMouseMove={onPointerMove}
          onPointerDown={onPointerDown}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={() => { endDrag({ currentTarget: canvasRef.current }); setHover(null); if (onHoverCell) onHoverCell(null) }}
          onClick={handleClick}
        />
      </div>

      {/* ------------------------------------------- map controls (zoom) */}
      <div className="map-ctrls">
        <button type="button" onClick={() => zoomBy(1.35, size.w / 2, size.h / 2)}
          title="Zoom in" aria-label="zoom in">+</button>
        <button type="button" onClick={() => zoomBy(1 / 1.35, size.w / 2, size.h / 2)}
          title="Zoom out" aria-label="zoom out">−</button>
        <button type="button" onClick={resetView} title="Reset view"
          aria-label="reset view">⤢</button>
        <button type="button" onClick={() => fitToRoute(primaryRoute)}
          disabled={!primaryRoute || primaryRoute.length < 2}
          title="Fit the current route" aria-label="fit route">◎</button>
        {geo.zoom > 1.01 ? (
          <span className="map-zoom">{geo.zoom.toFixed(1)}×</span>
        ) : null}
      </div>

      {/* ---------------- TOP LEFT · which field is on screen ---------------- */}
      <div className="hud hud-tl">
        <div className="ovb">
          <div className="ovb-t ok"><span className="pdot" />REAL SIC</div>
          <div className="ovb-v">{hud.date}</div>
          <div className="ovb-s"><b>D{hud.timestep}</b> &middot; {hud.source}</div>
        </div>
      </div>

      {/* ---------------- TOP RIGHT · the route result ---------------- */}
      <div className="hud hud-tr">
        {hud.showRoute ? (
          <div className="ovb right ok">
            <div className="ovb-t">ROUTE {hud.routeLabel}</div>
            <div className="ovb-v">{hud.waypoints} <em>waypoints</em></div>
            <div className="ovb-s">
              {hud.length} grid units &middot; mean SIC {hud.meanSic} &middot; max {hud.maxSic}
            </div>
          </div>
        ) : (
          <div className="ovb right idle">
            <div className="ovb-t">ROUTE</div>
            <div className="ovb-v">AWAITING OPTIMIZE</div>
            <div className="ovb-s">press “Optimize Route” for A* + CostMap</div>
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
                {hud.vessel.lat.toFixed(2)}°, {hud.vessel.lon.toFixed(2)}° ·{' '}
                {(hud.vessel.progress * 100).toFixed(1)}% · SIC{' '}
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
            left: Math.min(Math.max(8, hover.tx + 14), Math.max(8, size.w - 196)),
            top: Math.min(Math.max(8, hover.ty + 12), Math.max(8, size.h - 112)),
          }}
        >
          <div className="tip-h">{hover.lat.toFixed(2)}°, {hover.lon.toFixed(2)}°</div>
          <div className="tip-r"><span>SIC</span><b>{hover.valid ? hover.sic.toFixed(4) : '\u2014'}</b></div>
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

/**
 * Real Antarctic land polygons, drawn as a dark cartographic basemap.
 *
 * The continent is filled slightly lighter than the ocean and outlined with a
 * cool hairline, so the coastline reads as geography rather than as data. It
 * is drawn UNDER the SIC raster, whose open water is nearly transparent, so
 * the two layers compose instead of fighting.
 *
 * Rings are clipped against Antarctica's polar wrap: a polygon edge that
 * leaves the visible longitude window is closed along the window edge instead
 * of being drawn as a line across the plate.
 */
function drawCoastline(ctx, coastline, x, y, maxY) {
  const feats = coastline?.features
  if (!feats || !feats.length) return

  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  for (const f of feats) {
    const geom = f.geometry
    if (!geom) continue
    const polys = geom.type === 'Polygon' ? [geom.coordinates]
      : geom.type === 'MultiPolygon' ? geom.coordinates : []
    for (const poly of polys) {
      for (const ring of poly) {
        if (!ring || ring.length < 3) continue

        // Split the ring wherever it wraps the antimeridian so each piece can
        // be closed cleanly inside the projected window.
        const pieces = []
        let cur = []
        let prevX = null
        for (const pt of ring) {
          const px = x(pt[0])
          const py = Math.min(y(pt[1]), maxY)
          if (prevX != null && Math.abs(px - prevX) > 4000) {
            if (cur.length > 2) pieces.push(cur)
            cur = []
          }
          cur.push([px, py])
          prevX = px
        }
        if (cur.length > 2) pieces.push(cur)

        for (const piece of pieces) {
          // Antarctica encircles the pole, so its ring must be closed along the
          // bottom of the view rather than by a straight chord from the last
          // vertex back to the first — that chord would cut a false line
          // straight across the Southern Ocean.
          ctx.beginPath()
          piece.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)))
          ctx.lineTo(piece[piece.length - 1][0], maxY)
          ctx.lineTo(piece[0][0], maxY)
          ctx.closePath()
          ctx.fillStyle = `rgba(${LAND_FILL.join(',')},0.95)`
          ctx.fill()
          ctx.strokeStyle = COAST_STROKE
          ctx.lineWidth = 1.2
          ctx.stroke()
        }
      }
    }
  }
  ctx.restore()
}

/**
 * Pending start / destination, drawn before a route exists.
 *
 * These are operator selections, not results: they are shown as hollow rings
 * with a dashed link so it is obvious no route has been computed between them
 * yet. Non-navigable cells are ringed in red — a warning, not a rejection;
 * the backend still has the final say when the route is requested.
 */
function drawSelection(ctx, x, y, selection, scale, geo) {
  // Clamp labels against the CURRENT (possibly zoomed/panned) plate rect.
  const rx = x(geo.lonMin)
  const rw = geo.vw
  const ring = (cell, color, label) => {
    if (!cell) return
    const px = x(selection.lon[cell.col])
    const py = y(selection.lat[cell.row])
    ctx.save()
    ctx.beginPath(); ctx.arc(px, py, 15 * scale, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(4,9,16,0.6)'; ctx.fill()
    ctx.setLineDash([5, 4])
    ctx.lineWidth = 2.2; ctx.strokeStyle = color; ctx.stroke()
    ctx.setLineDash([])
    ctx.beginPath(); ctx.arc(px, py, 5 * scale, 0, Math.PI * 2)
    ctx.fillStyle = color; ctx.fill()
    ctx.font = 'bold 11px ui-sans-serif, system-ui, sans-serif'
    ctx.textBaseline = 'bottom'
    const leftEdge = px - 60 < rx
    ctx.textAlign = leftEdge ? 'left' : 'right'
    ctx.fillStyle = color
    ctx.fillText(label, px + (leftEdge ? 20 : -20), py - 8)
    ctx.restore()
  }
  const a = selection.start
  const b = selection.goal
  if (a && b) {
    ctx.save()
    ctx.setLineDash([4, 5])
    ctx.lineWidth = 1.4
    ctx.strokeStyle = 'rgba(226,240,255,0.5)'
    ctx.beginPath()
    ctx.moveTo(x(selection.lon[a.col]), y(selection.lat[a.row]))
    ctx.lineTo(x(selection.lon[b.col]), y(selection.lat[b.row]))
    ctx.stroke()
    ctx.restore()
  }
  ring(a, a && a.navigable === false ? '#f87171' : '#34d399', 'START')
  ring(b, b && b.navigable === false ? '#f87171' : '#fbbf24', 'DEST')
}

function drawStar(ctx, cx, cy, r, color) {  ctx.save()
  ctx.beginPath()
  for (let k = 0; k < 10; k++) {
    const rad = k % 2 === 0 ? r : r * 0.45
    const a = (Math.PI / 5) * k - Math.PI / 2
    const px = cx + Math.cos(a) * rad
    const py = cy + Math.sin(a) * rad
    if (k === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = '#fff'
  ctx.stroke()
  ctx.restore()
}

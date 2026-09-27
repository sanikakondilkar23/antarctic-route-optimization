import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { sicColor, uncColor, diffColor } from '../api.js'

const NONNAV_RGB = [40, 47, 56]
const NONNAV_OUTSIDE_RGB = [26, 31, 39] // outside the model domain (no value at all)
const ROUTE_RGB = [232, 247, 255]
const ORIGIN_RGB = [251, 191, 36]

/**
 * Central Antarctic digital-navigation chart.
 *
 * Renders the REAL raster returned by the backend for the selected timestep
 * and overlays only API-returned geometry:
 *
 *   primaryRoute  – the plan on screen (white-cyan, glowing, dominant)
 *   originRoute   – the pre-reroute path (amber, dashed, secondary)
 *   changedCells  – cells that differ between the two plans
 *   pulseT        – 0..1 sweep used to make an action unmistakable
 *   vesselT       – 0..1 vessel position along the primary route
 *
 * Three rasters are possible, all real:
 *   'sic'         – routing_sic_2026.npy           (default)
 *   'uncertainty' – uncertainty_2026.npy, 1 horizon
 *   'diff'        – arithmetic difference of two real SIC frames
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
    return {
      latMin, latMax, lonMin, lonMax, scale, x0, y0, w, h,
      x: (lo) => x0 + (lo - lonMin) * scale,
      y: (la) => y0 + (latMax - la) * scale,
      cellW: scale * 0.25,
    }
  }, [lat, lon, size])

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
        if (renderMode === 'diff') {
          if (!diff) rgb = [10, 16, 26]
          else if (diff.navChange[i] === -1) rgb = [250, 205, 21]        // became non-navigable
          else if (diff.navChange[i] === 1) rgb = [56, 189, 248]         // became navigable
          else if (!Number.isFinite(diff.delta[i])) rgb = NONNAV_RGB
          else rgb = diffColor(diff.delta[i], dmax)
        } else if (renderMode === 'uncertainty') {
          if (!src.valid[i]) rgb = layers.nonNav ? NONNAV_OUTSIDE_RGB : [6, 12, 22]
          else rgb = uncColor(src.values[i] / 255, umax)
        } else {
          if (!src.valid[i]) {
            rgb = layers.nonNav ? NONNAV_RGB : [8, 16, 28]
          } else if (!layers.sic) rgb = [10, 20, 34]
          else rgb = sicColor(src.values[i] / 255)
        }
        d[p] = rgb[0]; d[p + 1] = rgb[1]; d[p + 2] = rgb[2]; d[p + 3] = 255
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

    ctx.fillStyle = '#040910'
    ctx.fillRect(0, 0, size.w, size.h)

    const { x0, y0, w, h, x, y } = geo

    // ocean plate + real raster
    ctx.fillStyle = '#060e18'
    ctx.fillRect(x0, y0, w, h)
    if (fieldCanvas) {
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(fieldCanvas, x0, y0, w, h)
    }

    if (hatchCanvas) {
      ctx.save()
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(hatchCanvas, x0, y0, w, h)
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
      ctx.drawImage(ve, x0, y0, w, h)
      ctx.restore()
    }

    // frame + graticule
    ctx.strokeStyle = 'rgba(130,175,215,0.45)'
    ctx.lineWidth = 1
    ctx.strokeRect(x0, y0, w, h)
    ctx.fillStyle = 'rgba(200,220,245,0.7)'
    ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
    for (let la = -75; la <= -30; la += 5) {
      const yy = y(la)
      if (yy < y0 || yy > y0 + h) continue
      ctx.beginPath(); ctx.moveTo(x0, yy); ctx.lineTo(x0 + w, yy); ctx.stroke()
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
      ctx.fillText(`${la}\u00b0`, x0 - 6, yy)
    }
    // Guard bands, proportional to the plate: wide enough to clear the
    // bottom-corner HUD overlays, never so wide that the graticule loses its
    // labels on a short screen.
    const guardL = Math.min(210, w * 0.17)
    const guardR = Math.min(220, w * 0.18)
    for (let lo = -10; lo <= 80; lo += 10) {
      const xx = x(lo)
      if (xx < x0 || xx > x0 + w) continue
      // The two bottom HUD overlays occupy the plate's lower corners; drop any
      // longitude label that would render underneath one of them rather than
      // let the text collide with the SIC legend / leg readout.
      if (xx < x0 + guardL || xx > x0 + w - guardR) continue
      ctx.beginPath(); ctx.moveTo(xx, y0); ctx.lineTo(xx, y0 + h); ctx.stroke()
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'
      ctx.fillText(`${lo}\u00b0`, xx, y0 + h + 5)
    }

    // ---- scale bar: real 0.25 deg grid, labelled in km at the mid latitude
    // Centred on the lower edge of the plate, which is the only strip left
    // free by the two bottom HUD overlays.
    {
      const midLat = (geo.latMin + geo.latMax) / 2
      const kmPerDeg = 111.32 * Math.cos((Math.abs(midLat) * Math.PI) / 180)
      const targetKm = 500
      const px = (targetKm / kmPerDeg) * geo.scale
      const bx = x0 + w / 2 - px / 2
      const by = y0 + h - 15
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
      ctx.fillText('500 km', bx + px / 2, by - 6)
      ctx.restore()
    }

    // model-domain limit
    const mb = -49.75
    if (mb > geo.latMin && mb < geo.latMax) {
      ctx.save()
      ctx.setLineDash([7, 5])
      ctx.strokeStyle = 'rgba(251,191,36,0.7)'
      ctx.lineWidth = 1.1
      ctx.beginPath(); ctx.moveTo(x0, y(mb)); ctx.lineTo(x0 + w, y(mb)); ctx.stroke()
      ctx.restore()
      ctx.fillStyle = 'rgba(251,191,36,0.75)'
      ctx.font = '9px ui-sans-serif, system-ui, sans-serif'
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'
      ctx.fillText('model domain limit  -49.75\u00b0', x0 + 5, y(mb) - 3)
    }

    if (!routeVisible || !layers.route) return

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
    const scale = Math.max(1, Math.min(1.6, size.w / 1100))

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

    // start / goal
    const [sx, sy] = primary[0]
    const [gx, gy] = primary[primary.length - 1]
    ctx.beginPath(); ctx.arc(sx, sy, 11, 0, Math.PI * 2)
    ctx.fillStyle = 'rgba(52,211,153,0.22)'; ctx.fill()
    ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2)
    ctx.fillStyle = '#34d399'; ctx.fill()
    ctx.lineWidth = 2.4; ctx.strokeStyle = '#ffffff'; ctx.stroke()
    drawStar(ctx, gx, gy, 13, '#f87171')

    // Marker labels are always placed INSIDE the plate. Both endpoints of the
    // real leg sit on the domain boundary (START is the top-right grid
    // corner), so a naive outward offset would push the text off the raster.
    ctx.font = 'bold 12.5px ui-sans-serif, system-ui, sans-serif'
    ctx.textBaseline = 'middle'
    const label = (text, px, py, preferLeft) => {
      const tw = ctx.measureText(text).width
      let left = preferLeft
      if (preferLeft && px - 14 - tw < geo.x0 + 2) left = false
      if (!preferLeft && px + 14 + tw > geo.x0 + geo.w - 2) left = true
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
      const bx = geo.x0 + 12
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
      renderMode, uncertainty, uncMax, diff, layers])

  useEffect(() => { draw() }, [draw])

  const handleMove = (ev) => {
    const canvas = canvasRef.current
    if (!canvas || !slice) return
    const r = canvas.getBoundingClientRect()
    const px = ev.clientX - r.left
    const py = ev.clientY - r.top
    const { x0, y0, w, h } = geo
    if (px < x0 || px > x0 + w || py < y0 || py > y0 + h) { setHover(null); if (onHoverCell) onHoverCell(null); return }
    const c = Math.min(slice.nCols - 1, Math.max(0, Math.floor(((px - x0) / w) * slice.nCols)))
    const rIdx = Math.min(slice.nRows - 1, Math.max(0, Math.floor((1 - (py - y0) / h) * slice.nRows)))
    const i = rIdx * slice.nCols + c
    const isValid = !!slice.valid[i]
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

  return (
    <div className="map-shell">
      <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }}>
        <canvas
          ref={canvasRef}
          style={{ width: size.w, height: size.h }}
          onMouseMove={handleMove}
          onMouseLeave={() => { setHover(null); if (onHoverCell) onHoverCell(null) }}
        />
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
                {hud.hasReroute ? <span><i className="sw-orig" />original</span> : null}
                <span><i className="sw-start" />start</span>
                <span><i className="sw-goal" />dest</span>
              </>
            ) : null}
          </div>
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

function drawStar(ctx, cx, cy, r, color) {
  ctx.save()
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

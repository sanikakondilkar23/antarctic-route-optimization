import React, { useEffect, useMemo, useRef, useState } from 'react'
import { sicColor, uncColor, diffColor } from '../api.js'

const NONNAV = [40, 47, 56]
const NONE = [10, 16, 26]

/**
 * Small single-frame raster used by the BEFORE / AFTER / DIFFERENCE triptych
 * and by the uncertainty side-by-side view. It draws exactly the same pixels
 * as the main chart, from exactly the same decoded backend payload, so the
 * thumbnails can never disagree with the map.
 */
export default function MiniField({
  slice, lat, lon, mode = 'sic', max = null, diff = null, route = null, label,
  sub, tone = 'neutral', onClick, active,
}) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const [size, setSize] = useState({ w: 200, h: 110 })

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    const m = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 8 && r.height > 8) {
        setSize({ w: Math.max(60, Math.floor(r.width)), h: Math.max(40, Math.floor(r.height)) })
      }
    }
    m()
    const ro = new ResizeObserver(m)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const geo = useMemo(() => {
    const latMin = lat[0]
    const latMax = lat[lat.length - 1]
    const lonMin = lon[0]
    const lonMax = lon[lon.length - 1]
    const aspect = 1 / Math.cos((Math.abs((latMin + latMax) / 2) * Math.PI) / 180)
    const dataW = lonMax - lonMin
    const dataH = (latMax - latMin) * aspect
    const s = Math.min(size.w / dataW, size.h / dataH)
    const w = dataW * s
    const h = dataH * s
    return {
      s, w, h,
      x0: (size.w - w) / 2,
      y0: (size.h - h) / 2,
      x: (lo) => (size.w - w) / 2 + (lo - lonMin) * s,
      y: (la) => (size.h - h) / 2 + (latMax - la) * s,
    }
  }, [lat, lon, size])

  useEffect(() => {
    const c = canvasRef.current
    if (!c || !slice) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = Math.floor(size.w * dpr)
    c.height = Math.floor(size.h * dpr)
    const ctx = c.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    ctx.fillStyle = '#050b14'
    ctx.fillRect(0, 0, size.w, size.h)

    const nR = slice.nRows
    const nC = slice.nCols
    const off = document.createElement('canvas')
    off.width = nR
    off.height = nC
    const octx = off.getContext('2d')
    const img = octx.createImageData(nR, nC)
    const d = img.data
    const umax = max || slice.stats?.max || 1
    const dmax = diff?.vmax || 1
    for (let r = 0; r < nR; r++) {
      for (let cI = 0; cI < nC; cI++) {
        const i = (nR - 1 - r) * nC + cI
        const p = (r * nC + cI) * 4
        let rgb
        if (mode === 'diff') {
          if (!diff) rgb = NONE
          else if (diff.navChange[i] === -1) rgb = [250, 205, 21]
          else if (diff.navChange[i] === 1) rgb = [56, 189, 248]
          else if (!Number.isFinite(diff.delta[i])) rgb = NONNAV
          else rgb = diffColor(diff.delta[i], dmax)
        } else if (mode === 'uncertainty') {
          rgb = slice.valid[i] ? uncColor(slice.values[i] / 255, umax) : NONNAV
        } else {
          rgb = slice.valid[i] ? sicColor(slice.values[i] / 255) : NONNAV
        }
        d[p] = rgb[0]; d[p + 1] = rgb[1]; d[p + 2] = rgb[2]; d[p + 3] = 255
      }
    }
    octx.putImageData(img, 0, 0)
    ctx.imageSmoothingEnabled = true
    ctx.drawImage(off, geo.x0, geo.y0, geo.w, geo.h)

    // route overlay
    if (route && route.length > 1) {
      ctx.save()
      ctx.strokeStyle = 'rgba(2,6,12,0.9)'
      ctx.lineWidth = 3
      ctx.beginPath()
      route.forEach(([r, c], i) => {
        const px = geo.x(lon[c]); const py = geo.y(lat[r])
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py)
      })
      ctx.stroke()
      ctx.strokeStyle = 'rgba(232,247,255,0.95)'
      ctx.lineWidth = 1.2
      ctx.stroke()
      ctx.restore()
    }

    ctx.strokeStyle = 'rgba(120,160,210,0.22)'
    ctx.lineWidth = 1
    ctx.strokeRect(geo.x0, geo.y0, geo.w, geo.h)
  }, [slice, size, geo, lat, lon, mode, max, diff, route])

  return (
    <button
      type="button"
      ref={wrapRef}
      className={`mini mini-${tone} ${active ? 'active' : ''}`}
      onClick={onClick}
      disabled={!onClick}
      title={label}
    >
      <canvas ref={canvasRef} style={{ width: size.w, height: size.h, display: 'block' }} />
      <span className="mini-lbl">{label}</span>
      {sub ? <span className="mini-sub">{sub}</span> : null}
    </button>
  )
}

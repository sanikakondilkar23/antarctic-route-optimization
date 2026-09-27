import React, { useEffect, useRef, useState, useCallback } from 'react'
import { sicColor } from '../api.js'

/**
 * ROUTE RISK PROFILE
 *
 * X axis  : route progress (km along the real 0.25 deg grid)
 * Y axis  : real SIC at the cell the route occupies
 *
 * Every sample comes from GET /api/route/profile/<t>, which reads the real
 * SIC artifact along the real A* path. Cells that are NaN are drawn as gaps,
 * never interpolated. The maximum-SIC crossing is marked explicitly because
 * that is the number a captain actually cares about.
 */
export default function RouteProfile({ profile, vesselT = null, loading }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const [size, setSize] = useState({ w: 320, h: 132 })
  const [tip, setTip] = useState(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    const m = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 4 && r.height > 4) {
        setSize({ w: Math.max(180, Math.floor(r.width)), h: Math.max(90, Math.floor(r.height)) })
      }
    }
    m()
    const ro = new ResizeObserver(m)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const draw = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    c.width = Math.floor(size.w * dpr)
    c.height = Math.floor(size.h * dpr)
    const ctx = c.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    ctx.fillStyle = 'rgba(3,8,16,0.55)'
    ctx.fillRect(0, 0, size.w, size.h)

    const padL = 32
    const padR = 8
    const padT = 12
    const padB = 18
    const w = size.w - padL - padR
    const h = size.h - padT - padB
    if (w < 20 || h < 20) return

    const S = profile?.samples || []
    const totalKm = profile?.great_circle_length_km || 0
    const finite = S.filter((s) => s.sic != null)
    const vmax = finite.length ? Math.max(0.05, ...finite.map((s) => s.sic)) : 1
    const yTop = Math.min(1, vmax * 1.18)

    // frame + gridlines
    ctx.strokeStyle = 'rgba(120,160,210,0.16)'
    ctx.lineWidth = 1
    ctx.font = '9px ui-monospace, monospace'
    ctx.fillStyle = 'rgba(140,165,195,0.85)'
    for (let f = 0; f <= 4; f++) {
      const v = (yTop * f) / 4
      const yy = padT + h - (v / yTop) * h
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + w, yy); ctx.stroke()
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle'
      ctx.fillText(v.toFixed(2), padL - 4, yy)
    }

    if (!S.length) {
      ctx.fillStyle = 'rgba(120,140,170,0.9)'
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.font = '10px ui-sans-serif, system-ui, sans-serif'
      ctx.fillText(loading ? 'reading route profile\u2026' : 'no route profile yet', padL + w / 2, padT + h / 2)
      return
    }

    const X = (km) => padL + (totalKm > 0 ? km / totalKm : 0) * w
    const Y = (v) => padT + h - (v / yTop) * h

    // filled area under the profile, coloured by the same SIC ramp as the map
    const grad = ctx.createLinearGradient(0, padT, 0, padT + h)
    grad.addColorStop(0, 'rgba(56,189,248,0.30)')
    grad.addColorStop(1, 'rgba(56,189,248,0.02)')
    ctx.beginPath()
    let pen = false
    for (let i = 0; i < S.length; i++) {
      if (S[i].sic == null) { pen = false; continue }
      const x = X(S[i].cum_km)
      if (!pen) { ctx.moveTo(x, Y(0)); ctx.lineTo(x, Y(S[i].sic)); pen = true }
      else ctx.lineTo(x, Y(S[i].sic))
    }
    ctx.lineTo(X(S[S.length - 1].cum_km), Y(0))
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()

    // sample dots: the colour IS the SIC value, consistent with the map legend
    for (let i = 0; i < S.length; i++) {
      const s = S[i]
      if (s.sic == null) continue
      const [r, g, b] = sicColor(s.sic)
      ctx.fillStyle = `rgba(${r},${g},${b},0.95)`
      ctx.fillRect(X(s.cum_km) - 0.9, Y(s.sic) - 0.9, 1.8, 1.8)
    }

    // the profile line
    ctx.beginPath()
    pen = false
    for (let i = 0; i < S.length; i++) {
      if (S[i].sic == null) { pen = false; continue }
      const x = X(S[i].cum_km)
      const y = Y(S[i].sic)
      if (!pen) { ctx.moveTo(x, y); pen = true } else ctx.lineTo(x, y)
    }
    ctx.strokeStyle = 'rgba(232,247,255,0.92)'
    ctx.lineWidth = 1.2
    ctx.stroke()

    // MIZ reference (0.15): the repository's routing default threshold
    if (0.15 < yTop) {
      const yy = Y(0.15)
      ctx.save()
      ctx.setLineDash([4, 4])
      ctx.strokeStyle = 'rgba(251,191,36,0.6)'
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + w, yy); ctx.stroke()
      ctx.restore()
      ctx.fillStyle = 'rgba(251,191,36,0.8)'
      ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'
      ctx.font = '8px ui-monospace, monospace'
      ctx.fillText('MIZ 0.15', padL + 3, yy - 1)
    }

    // maximum-SIC crossing
    if (profile.max_sic != null && profile.max_sic_index >= 0) {
      const s = S[profile.max_sic_index]
      if (s) {
        const mx = X(s.cum_km)
        const my = Y(s.sic)
        ctx.save()
        ctx.strokeStyle = 'rgba(248,113,113,0.9)'
        ctx.lineWidth = 1.2
        ctx.beginPath(); ctx.moveTo(mx, padT); ctx.lineTo(mx, padT + h); ctx.stroke()
        ctx.beginPath(); ctx.arc(mx, my, 4.5, 0, Math.PI * 2)
        ctx.fillStyle = '#f87171'; ctx.fill()
        ctx.lineWidth = 1.6; ctx.strokeStyle = '#fff'; ctx.stroke()
        ctx.restore()
        ctx.fillStyle = '#fecaca'
        ctx.font = 'bold 9px ui-monospace, monospace'
        ctx.textAlign = mx > padL + w * 0.7 ? 'right' : 'left'
        ctx.textBaseline = 'top'
        ctx.fillText(`MAX ${profile.max_sic.toFixed(3)} @ ${s.cum_km.toFixed(0)} km`,
          mx + (mx > padL + w * 0.7 ? -6 : 6), padT + 1)
      }
    }

    // vessel position along the same progress axis
    if (vesselT != null) {
      const vx = padL + vesselT * w
      ctx.save()
      ctx.strokeStyle = 'rgba(56,189,248,0.75)'
      ctx.setLineDash([2, 3])
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(vx, padT); ctx.lineTo(vx, padT + h); ctx.stroke()
      ctx.restore()
      ctx.beginPath(); ctx.arc(vx, padT - 5, 3, 0, Math.PI * 2)
      ctx.fillStyle = '#38bdf8'; ctx.fill()
    }

    // x axis
    ctx.strokeStyle = 'rgba(120,160,210,0.35)'
    ctx.beginPath(); ctx.moveTo(padL, padT + h); ctx.lineTo(padL + w, padT + h); ctx.stroke()
    ctx.fillStyle = 'rgba(140,165,195,0.8)'
    ctx.font = '8.5px ui-monospace, monospace'
    ctx.textBaseline = 'top'
    ctx.textAlign = 'left'
    ctx.fillText('0 km', padL, padT + h + 4)
    ctx.textAlign = 'right'
    ctx.fillText(`${totalKm.toFixed(0)} km`, padL + w, padT + h + 4)
  }, [profile, size, vesselT, loading])

  useEffect(() => { draw() }, [draw])

  const onMove = (ev) => {
    const S = profile?.samples || []
    if (!S.length) return
    const r = canvasRef.current.getBoundingClientRect()
    const padL = 32
    const padR = 8
    const w = r.width - padL - padR
    const totalKm = profile.great_circle_length_km || 1
    const km = ((ev.clientX - r.left - padL) / w) * totalKm
    let best = null
    for (const s of S) if (!best || Math.abs(s.cum_km - km) < Math.abs(best.cum_km - km)) best = s
    if (best) {
      setTip({
        km: best.cum_km, sic: best.sic, lat: best.lat, lon: best.lon,
        wp: best.i + 1,
      })
    }
  }

  return (
    <div className="prof" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h, display: 'block' }}
        onMouseMove={onMove}
        onMouseLeave={() => setTip(null)}
      />
      {tip ? (
        <div className="prof-tip">
          <b>WP {tip.wp}</b> · {tip.lat.toFixed(2)}&deg;, {tip.lon.toFixed(2)}&deg; · {tip.km.toFixed(0)} km
          <br />
          SIC {tip.sic == null ? 'NaN (non-navigable)' : tip.sic.toFixed(4)}
        </div>
      ) : null}
    </div>
  )
}

import { useMemo } from 'react'
import { sicColor } from '../../lib/auroraApi'

const PAD = { top: 14, right: 16, bottom: 34, left: 46 }

const rgb = (c) => (Array.isArray(c) ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : c)

/**
 * Distance-along-route vs sea-ice concentration, drawn straight from
 * GET /api/route/profile/<timestep>.
 *
 * Every x/y pair is a real sample: x is the great-circle distance from the
 * route origin (sample.cum_km) and y is the SIC read out of
 * backend/cache/routing_sic_2026.npy at that cell (sample.sic). Cells whose
 * SIC is NaN are never drawn as zero - the line simply breaks there.
 */
export default function RouteSicChart({ profile, height = 208 }) {
  const geo = useMemo(() => {
    const samples = profile?.samples
    if (!Array.isArray(samples) || !samples.length) return null

    const W = 720
    const H = height
    const innerW = W - PAD.left - PAD.right
    const innerH = H - PAD.top - PAD.bottom
    const totalKm = Number(profile.great_circle_length_km) || 0
    const span = totalKm > 0 ? totalKm : 1

    const x = (km) => PAD.left + (Math.max(0, Math.min(span, km)) / span) * innerW
    const y = (v) => PAD.top + (1 - Math.max(0, Math.min(1, v))) * innerH

    // Split the polyline wherever SIC is unavailable so a NaN gap stays a gap.
    const runs = []
    let current = []
    for (const s of samples) {
      if (s.sic == null) {
        if (current.length) runs.push(current)
        current = []
        continue
      }
      current.push(`${x(s.cum_km).toFixed(2)},${y(s.sic).toFixed(2)}`)
    }
    if (current.length) runs.push(current)

    const markers = samples
      .filter((s) => s.sic != null && (s.sic >= 0.4 || s.i % 12 === 0))
      .map((s) => ({
        cx: x(s.cum_km),
        cy: y(s.sic),
        color: rgb(sicColor(s.sic)),
        title: `${s.sic.toFixed(3)} SIC · ${s.cum_km.toFixed(1)} km · ${s.lat}°, ${s.lon}° · ${s.band}`,
      }))

    return { W, H, innerW, innerH, span, x, y, runs, markers, totalKm }
  }, [profile, height])

  if (!geo) return null

  const bands = [
    { lo: 0, hi: 0.15, label: 'open water' },
    { lo: 0.15, hi: 0.4, label: 'marginal ice' },
    { lo: 0.4, hi: 0.7, label: 'moderate pack' },
    { lo: 0.7, hi: 0.85, label: 'hard pack' },
    { lo: 0.85, hi: 1, label: 'impassable' },
  ]

  const yTicks = [0, 0.25, 0.5, 0.75, 1]
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * geo.span)

  return (
    <div className="border border-graphite-600 bg-graphite-900">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-graphite-700 px-3 py-2">
        <p className="mono-label">SIC along route · distance profile</p>
        <p className="num text-[11.5px] text-mist">
          {geo.totalKm.toFixed(1)} km · {profile.samples.length} cells
        </p>
      </div>

      <svg
        viewBox={`0 0 ${geo.W} ${geo.H}`}
        className="block h-auto w-full"
        role="img"
        aria-label="Sea-ice concentration sampled along the optimised route"
      >
        {/* band backgrounds */}
        {bands.map((b) => (
          <rect
            key={b.label}
            x={PAD.left}
            y={geo.y(b.hi)}
            width={geo.innerW}
            height={Math.max(0, geo.y(b.lo) - geo.y(b.hi))}
            fill={rgb(sicColor((b.lo + b.hi) / 2))}
            opacity={0.13}
          />
        ))}

        {/* grid */}
        {yTicks.map((t) => (
          <g key={`y-${t}`}>
            <line
              x1={PAD.left}
              x2={PAD.left + geo.innerW}
              y1={geo.y(t)}
              y2={geo.y(t)}
              stroke="#1E3040"
              strokeWidth={1}
            />
            <text x={PAD.left - 8} y={geo.y(t) + 3.5} textAnchor="end" fontSize="10" fill="#7C8C99">
              {t.toFixed(2)}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <g key={`x-${i}`}>
            <line
              x1={geo.x(t)}
              x2={geo.x(t)}
              y1={PAD.top}
              y2={PAD.top + geo.innerH}
              stroke="#1E3040"
              strokeWidth={1}
            />
            <text
              x={geo.x(t)}
              y={PAD.top + geo.innerH + 15}
              textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
              fontSize="10"
              fill="#7C8C99"
            >
              {t.toFixed(0)}
            </text>
          </g>
        ))}

        {/* high-ice threshold */}
        <line
          x1={PAD.left}
          x2={PAD.left + geo.innerW}
          y1={geo.y(0.4)}
          y2={geo.y(0.4)}
          stroke="#E0A64A"
          strokeWidth={1.4}
          strokeDasharray="5 4"
        />
        <text x={PAD.left + geo.innerW - 4} y={geo.y(0.4) - 5} textAnchor="end" fontSize="9.5" fill="#E0A64A">
          high-ice threshold 0.40
        </text>

        {/* route profile */}
        {geo.runs.map((pts, i) => (
          <polyline
            key={`run-${i}`}
            points={pts.join(' ')}
            fill="none"
            stroke="#A8CFE6"
            strokeWidth={2.2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* sampled points */}
        {geo.markers.map((m, i) => (
          <circle key={`m-${i}`} cx={m.cx} cy={m.cy} r={3} fill={m.color} stroke="#0B0E11" strokeWidth={0.8}>
            <title>{m.title}</title>
          </circle>
        ))}

        {/* frame */}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={geo.innerW}
          height={geo.innerH}
          fill="none"
          stroke="#2A3B4A"
          strokeWidth={1}
        />

        <text x={PAD.left + geo.innerW / 2} y={geo.H - 6} textAnchor="middle" fontSize="10" fill="#7C8C99">
          distance from route origin (km)
        </text>
        <text
          x={12}
          y={PAD.top + geo.innerH / 2}
          fontSize="10"
          fill="#7C8C99"
          transform={`rotate(-90 12 ${PAD.top + geo.innerH / 2})`}
          textAnchor="middle"
        >
          sea-ice concentration
        </text>
      </svg>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-graphite-700 px-3 py-2">
        {bands.map((b) => (
          <span key={b.label} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 border border-graphite-600"
              style={{ background: rgb(sicColor((b.lo + b.hi) / 2)) }}
            />
            <span className="text-[10.5px] text-steel">
              {b.lo.toFixed(2)}–{b.hi.toFixed(2)} {b.label}
            </span>
          </span>
        ))}
      </div>
    </div>
  )
}

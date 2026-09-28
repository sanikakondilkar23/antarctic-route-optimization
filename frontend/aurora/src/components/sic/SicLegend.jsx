/**
 * SicLegend.jsx — renders the legend the API sends with every raster.
 *
 * The colour scale is never hardcoded in the frontend. The backend owns the
 * palette (backend/app/serialize.py) and publishes it as `legend` alongside each
 * field, so the map, the legend and the raster can never disagree.
 */

function sequentialBar(stops) {
  const parts = []
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i]
    const b = stops[i + 1]
    const span = Math.max(b.t - a.t, 1e-6)
    parts.push(`${a.color} ${((a.t / 1) * 100).toFixed(1)}%`)
    parts.push(`${b.color} ${((b.t / 1) * 100).toFixed(1)}%`)
  }
  return `linear-gradient(90deg, ${parts.join(', ')})`
}

export default function SicLegend({ legend, stats, className = '' }) {
  if (!legend) return null

  if (legend.type === 'categorical') {
    return (
      <div className={className}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          {legend.classes.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1.5 text-xs text-mist">
              <span
                className="h-2.5 w-2.5 rounded-sm"
                style={{
                  backgroundColor: c.color ?? 'transparent',
                  border: c.color ? 'none' : '1px dashed rgba(148,163,184,0.6)',
                }}
              />
              {c.label}
              {stats?.counts?.[c.id] != null && (
                <span className="font-mono text-white/80">
                  {stats.counts[c.id].toLocaleString()}
                </span>
              )}
            </span>
          ))}
        </div>
      </div>
    )
  }

  const vmin = legend.vmin ?? 0
  const vmax = legend.vmax ?? 1
  const fmt = (v) => (legend.units === 'SIC fraction' ? v.toFixed(2) : v.toFixed(3))

  return (
    <div className={className}>
      <div
        className="h-2.5 w-full max-w-[320px] rounded-full border border-white/10"
        style={{ background: sequentialBar(legend.stops ?? []) }}
      />
      <div className="mt-1 flex max-w-[320px] justify-between text-[10px] font-mono text-mist">
        <span>{fmt(vmin)}</span>
        <span>{fmt((vmin + vmax) / 2)}</span>
        <span>{fmt(vmax)}</span>
      </div>
      {legend.description && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-mist/80">{legend.description}</p>
      )}
      {stats?.kind === 'sic' && (
        <p className="mt-1 text-[10px] font-mono text-mist">
          mean {stats.mean.toFixed(3)} · p90 {stats.p90.toFixed(3)} · max {stats.max.toFixed(3)} ·
          cells {stats.valid_cells.toLocaleString()} · masked {stats.masked_cells.toLocaleString()}
        </p>
      )}
      {stats?.kind === 'confidence_class' && (
        <p className="mt-1 text-[10px] font-mono text-mist">
          masked cells {stats.masked_cells.toLocaleString()}
        </p>
      )}
    </div>
  )
}

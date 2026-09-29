/**
 * SicLegend.jsx - legend for the rasters the AURORA frontend draws.
 *
 * The colour scale is exported by src/lib/auroraApi.js, the same module that
 * rasterises the frame, so the legend and the picture are built from one stop
 * table and cannot drift apart. Every number printed is read from the `stats`
 * block the backend sent with that frame.
 */

function sequentialBar(stops) {
  if (!stops?.length) return 'transparent'
  const parts = stops.flatMap((s) => [`${s.color} ${(s.t * 100).toFixed(1)}%`])
  return `linear-gradient(90deg, ${parts.join(', ')})`
}

const n = (v) => (typeof v === 'number' ? v.toLocaleString() : '-')
const f = (v, d = 3) => (typeof v === 'number' ? v.toFixed(d) : '-')

export default function SicLegend({ legend, stats, kind = 'sic', className = '' }) {
  if (!legend) return null

  return (
    <div className={className}>
      <div
        className="h-2.5 w-full max-w-[320px] rounded-full border border-white/10"
        style={{ background: sequentialBar(legend.stops) }}
      />
      <div className="mt-1 flex max-w-[320px] justify-between text-[10px] font-mono text-mist">
        <span>{f(legend.vmin, 2)}</span>
        <span>{f(((legend.vmin ?? 0) + (legend.vmax ?? 1)) / 2, 2)}</span>
        <span>{f(legend.vmax, 2)}</span>
      </div>
      {legend.description && (
        <p className="mt-1.5 max-w-[360px] text-[10px] leading-relaxed text-mist/80">
          {legend.description}
        </p>
      )}

      {stats && kind === 'sic' && (
        <p className="mt-1 text-[10px] font-mono text-mist">
          mean {f(stats.mean)} · min {f(stats.min)} · max {f(stats.max)} · navigable cells{' '}
          {n(stats.n_navigable)} · non-navigable {n(stats.n_non_navigable)}
        </p>
      )}

      {stats && kind === 'uncertainty' && (
        <p className="mt-1 text-[10px] font-mono text-mist">
          mean {f(stats.mean)} · p90 {f(stats.p90)} · max {f(stats.max)} · in-domain cells{' '}
          {n(stats.n_within_model_domain)} · outside domain {n(stats.n_outside_model_domain)}
        </p>
      )}
    </div>
  )
}

import { cn } from '../../lib/utils'
import { SIC_LEGEND, UNCERTAINTY_LEGEND } from '../../lib/auroraApi'

/** A docked/overlaid instrument panel. Solid surface, hairline border. */
export function FloatPanel({ title, action, children, className = '', bodyClass = 'px-3 py-2.5' }) {
  return (
    <section className={cn('border border-graphite-600 bg-graphite-850 shadow-overlay', className)}>
      {title && (
        <header className="flex items-center justify-between gap-2 border-b border-graphite-600 px-3 py-2">
          <h2 className="eyebrow">{title}</h2>
          {action}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  )
}

/** One checkbox row of the layer stack. */
export function LayerRow({ checked, onChange, label, status, note, disabled }) {
  return (
    <label
      className={cn(
        'flex items-start gap-2 py-1',
        disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-[3px] h-3.5 w-3.5 shrink-0 rounded-[2px] accent-ice"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="text-[12px] leading-tight text-white/90">{label}</span>
          {status && <span className="mono-label shrink-0">{status}</span>}
        </span>
        {note && <span className="mt-0.5 block text-[10.5px] leading-snug text-steel">{note}</span>}
      </span>
    </label>
  )
}

/** Sequential ramp built from the same stops the raster was rendered with. */
function Ramp({ legend, className = '' }) {
  const gradient = legend.stops
    .map((s) => `${s.color} ${Math.round(s.t * 100)}%`)
    .join(', ')
  return (
    <div className={className}>
      <div className="h-2.5 w-full border border-graphite-600" style={{ background: `linear-gradient(90deg, ${gradient})` }} />
      <div className="mono-label mt-1 flex justify-between">
        <span>{legend.vmin}</span>
        {legend.vmax != null && <span>{legend.vmax}</span>}
        <span>{legend.units}</span>
      </div>
    </div>
  )
}

export function SicLegend({ className = '', title = 'Sea-ice concentration' }) {
  return (
    <div className={className}>
      <p className="mono-label mb-1.5">{title}</p>
      <Ramp legend={SIC_LEGEND} />
      <p className="mt-1.5 text-[10.5px] leading-snug text-steel">{SIC_LEGEND.description}</p>
    </div>
  )
}

export function UncertaintyLegend({ className = '' }) {
  return (
    <div className={className}>
      <p className="mono-label mb-1.5">Forecast uncertainty (1σ)</p>
      <Ramp legend={UNCERTAINTY_LEGEND} />
      <p className="mt-1.5 text-[10.5px] leading-snug text-steel">{UNCERTAINTY_LEGEND.description}</p>
    </div>
  )
}

/** Cursor position inside the served grid. */
export function CoordReadout({ cursor, className = '' }) {
  const inside =
    cursor && cursor.lat >= -75 && cursor.lat <= -32 && cursor.lon >= -10 && cursor.lon <= 82
  return (
    <div className={cn('font-mono text-[11px] leading-relaxed text-mist', className)}>
      <span className="num text-white/90">
        {cursor
          ? `${Math.abs(cursor.lat).toFixed(3)}°${cursor.lat < 0 ? 'S' : 'N'}  ${Math.abs(cursor.lon).toFixed(3)}°${cursor.lon < 0 ? 'W' : 'E'}`
          : '—'}
      </span>
      <span className="ml-2 text-steel">{cursor ? (inside ? 'IN GRID' : 'OUTSIDE GRID') : ''}</span>
    </div>
  )
}

/** Small inline legend entries for route lines drawn on the chart. */
export function LineLegend({ items, className = '' }) {
  if (!items?.length) return null
  return (
    <ul className={cn('space-y-1.5', className)}>
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-2 text-[11.5px] text-mist">
          <svg width="22" height="6" aria-hidden="true">
            <line
              x1="0"
              y1="3"
              x2="22"
              y2="3"
              stroke={it.color}
              strokeWidth={it.width ?? 2.5}
              strokeDasharray={it.dash}
            />
          </svg>
          <span className="text-white/85">{it.label}</span>
        </li>
      ))}
    </ul>
  )
}

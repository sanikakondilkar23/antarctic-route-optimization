import { cn } from '../../lib/utils'
import { SIC_LEGEND, UNCERTAINTY_LEGEND } from '../../lib/auroraApi'

/** A docked/overlaid instrument panel. Translucent glass surface, delicate border. */
export function FloatPanel({ title, action, children, className = '', bodyClass = 'px-3.5 py-3' }) {
  return (
    <section className={cn('rounded-2xl border border-white/10 bg-[#071D33]/90 backdrop-blur-xl shadow-2xl overflow-hidden', className)}>
      {title && (
        <header className="flex items-center justify-between gap-2 border-b border-white/10 bg-[#0A2A4A]/40 px-3.5 py-2.5">
          <h2 className="text-[10px] font-mono uppercase tracking-widest text-[#22E5F0] font-bold">{title}</h2>
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
        'flex items-start gap-2.5 py-1.5 px-1 rounded-lg transition-colors hover:bg-white/5',
        disabled ? 'cursor-not-allowed opacity-45' : 'cursor-pointer'
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-[3px] h-3.5 w-3.5 shrink-0 rounded accent-[#22E5F0]"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-medium leading-tight text-white/90">{label}</span>
          {status && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-[#A9DFFF] border border-white/10 shrink-0">{status}</span>}
        </span>
        {note && <span className="mt-0.5 block text-[10.5px] leading-snug text-mist/70">{note}</span>}
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
      <div className="h-2.5 w-full rounded-md border border-white/10 overflow-hidden shadow-inner" style={{ background: `linear-gradient(90deg, ${gradient})` }} />
      <div className="mono-label mt-1.5 flex justify-between text-[9.5px]">
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

/**
 * LayerManagerPanel — Interactive layer visibility and opacity controller.
 * Ported and adapted from Samira's LayerManager architecture for EPSG:3031.
 */
export function LayerManagerPanel({
  layers = {},
  opacities = {},
  onToggle,
  onOpacityChange,
  sicAwaitingData = false,
  className = '',
}) {
  const categories = [
    {
      id: 'base_chart',
      title: 'BASE CHART',
      items: [
        { id: 'enc', label: 'ENC Chart', hasOpacity: true },
        { id: 'coast', label: 'Coastline', hasOpacity: true },
      ],
    },
    {
      id: 'reference',
      title: 'REFERENCE',
      items: [
        { id: 'graticule', label: 'Graticule', hasOpacity: true },
        { id: 'corridor', label: 'Reference corridor', hasOpacity: true },
        { id: 'stations', label: 'Stations', hasOpacity: true },
      ],
    },
    {
      id: 'ice',
      title: 'ICE',
      items: [
        { id: 'sic', label: 'Sea ice forecast', awaiting: sicAwaitingData, hasOpacity: true },
        { id: 'unc', label: 'Ice forecast uncertainty', hasOpacity: true },
        { id: 'drift', label: 'Drift cones', hasOpacity: true },
        { id: 'icebergs', label: 'Icebergs', hasOpacity: true },
      ],
    },
    {
      id: 'route',
      title: 'ROUTE',
      items: [
        { id: 'alt_routes', label: 'Alternative routes', hasOpacity: true },
        { id: 'route', label: 'Recommended route', hasOpacity: true },
        { id: 'alarms', label: 'Alarms', hasOpacity: true },
      ],
    },
  ]

  return (
    <div className={cn('space-y-3', className)}>
      {categories.map((cat) => (
        <div key={cat.id} className="space-y-1 border-b border-white/10 pb-2 last:border-b-0 last:pb-0">
          <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-ocean-400 text-[#22E5F0]">
            {cat.title}
          </p>
          <div className="space-y-1">
            {cat.items.map((item) => {
              const checked = layers[item.id] !== false
              const opacity = opacities[item.id] ?? (item.id === 'alt_routes' ? 0.9 : 1.0)
              const isAwaiting = item.awaiting

              return (
                <div key={item.id} className="py-1">
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 cursor-pointer select-none min-w-0 flex-1">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isAwaiting}
                        onChange={() => onToggle?.(item.id)}
                        className="h-3.5 w-3.5 shrink-0 rounded accent-[#22E5F0] disabled:opacity-40"
                      />
                      <span className={cn('truncate text-[12px] font-medium', checked ? 'text-white' : 'text-mist')}>
                        {item.label}
                      </span>
                    </label>

                    <span className="font-mono text-[10px] text-mist w-8 text-right">
                      {Math.round(opacity * 100)}%
                    </span>
                  </div>

                  <div className={cn('mt-1 flex items-center pl-5 transition-opacity', checked ? 'opacity-100' : 'opacity-30')}>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      value={Math.round(opacity * 100)}
                      disabled={!checked || isAwaiting}
                      onChange={(e) => onOpacityChange?.(item.id, Number(e.target.value) / 100)}
                      className="h-1 w-full accent-[#22E5F0] bg-white/10 rounded cursor-pointer"
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * LegendPanel — S-52 Polar Maritime symbology legend.
 * Ported and adapted from Samira's LegendPanel architecture.
 */
export function LegendPanel({ className = '', showSic = true, showUncertainty = false }) {
  const chartSymbols = [
    { label: 'Charted Land & Coastline', color: '#22E5F0', note: 'Natural Earth S-52 CSTLN' },
    { label: 'Lat/Lon Polar Graticule', color: '#22E5F0', dashed: true, note: 'Sampled concentric parallels' },
    { label: 'Cape Town Corridor', color: '#5FB0DD', dashed: true, note: 'Maritime transit corridor' },
    { label: 'Research Stations & Ports', color: '#FFB300', isDisc: true, note: 'Staging & scientific bases' },
    { label: 'Iceberg Hazard', color: '#FF4560', isTriangle: true, note: 'SAR Sentinel-1 & USNIC' },
    { label: 'Standoff Safety Perimeter', color: '#FFB020', dashed: true, note: 'Dynamic safety buffer (NM)' },
    { label: 'Recommended Route Track', color: '#22E5F0', note: 'Geodesic A* minimal risk' },
    { label: 'Alternative / Prior Route', color: '#FFB020', dashed: true, note: 'Re-routed avoidance' },
  ]

  return (
    <div className={cn('space-y-2.5', className)}>
      <div>
        <p className="text-[10px] font-mono font-bold uppercase tracking-wider text-[#22E5F0]">
          Polar Maritime Symbology
        </p>
        <div className="mt-2 space-y-1.5">
          {chartSymbols.map((s) => (
            <div key={s.label} className="flex items-center gap-2.5 text-[11px]">
              {s.isDisc ? (
                <span className="flex h-3 w-4 shrink-0 items-center justify-center">
                  <span className="h-2.5 w-2.5 rounded-full border border-white bg-[#FFB300] shadow-[0_0_6px_#FFB300]" />
                </span>
              ) : s.isTriangle ? (
                <span className="flex h-3 w-4 shrink-0 items-center justify-center">
                  <span className="h-0 w-0 border-x-[5px] border-b-[9px] border-x-transparent border-b-[#FF4560]" />
                </span>
              ) : (
                <span
                  className={cn(
                    'h-1.5 w-4 shrink-0 rounded-[1px]',
                    s.dashed ? 'border-t-2 border-dashed' : ''
                  )}
                  style={s.dashed ? { borderColor: s.color, backgroundColor: 'transparent' } : { backgroundColor: s.color }}
                />
              )}
              <span className="min-w-0 flex-1 truncate text-white/90">{s.label}</span>
              <span className="text-[9px] font-mono text-mist/60 shrink-0">{s.note}</span>
            </div>
          ))}
        </div>
      </div>

      {showSic && (
        <div className="border-t border-white/10 pt-2">
          <SicLegend />
        </div>
      )}

      {showUncertainty && (
        <div className="border-t border-white/10 pt-2">
          <UncertaintyLegend />
        </div>
      )}
    </div>
  )
}


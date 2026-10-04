import { cn } from '../../lib/utils'

/**
 * A single measured quantity. Flat, bordered, no ornament: label, value,
 * unit, and an optional source note. Values are rendered exactly as supplied.
 */
export default function StatCard({
  label,
  value,
  unit,
  subtitle,
  note,
  tone = '',
  size = 'md',
  className = '',
}) {
  return (
    <div className={cn('border border-graphite-600 bg-graphite-850 px-3.5 py-3', className)}>
      <p className="eyebrow">{label}</p>
      <p className={cn('mt-1.5 flex items-baseline gap-1.5', tone)}>
        <span
          className={cn(
            'num font-medium leading-none text-white',
            size === 'lg' ? 'text-[26px]' : size === 'sm' ? 'text-[16px]' : 'text-[21px]'
          )}
        >
          {value}
        </span>
        {unit && <span className="text-[11px] font-medium text-mist">{unit}</span>}
      </p>
      {subtitle && <p className="mt-1.5 text-[11.5px] leading-snug text-mist">{subtitle}</p>}
      {note && <p className="mono-label mt-2 truncate border-t border-graphite-700 pt-1.5">{note}</p>}
    </div>
  )
}

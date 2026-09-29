import { cn } from '../../lib/utils'

export default function PageHeader({ title, subtitle, actions, meta, className = '' }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-4 border-b border-graphite-600 pb-4', className)}>
      <div className="min-w-0">
        <h1 className="text-[19px] font-semibold leading-tight tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-mist">{subtitle}</p>}
        {meta && <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function MetaItem({ label, value, className = '' }) {
  return (
    <span className={cn('inline-flex items-baseline gap-1.5', className)}>
      <span className="mono-label">{label}</span>
      <span className="num text-[12px] text-white/90">{value}</span>
    </span>
  )
}

export function LiveChip({ label = 'Demo mode', dot = 'cyan', className = '' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-mist',
        className
      )}
    >
      <span className="relative flex h-2 w-2">
        <span
          className={cn(
            'absolute h-full w-full rounded-full opacity-50',
            dot === 'cyan' && 'bg-cyan',
            dot === 'safe' && 'bg-safe',
            dot === 'warn' && 'bg-warn',
            dot === 'danger' && 'bg-danger'
          )}
        />
        <span
          className={cn(
            'relative h-2 w-2 rounded-full',
            dot === 'cyan' && 'bg-cyan',
            dot === 'safe' && 'bg-safe',
            dot === 'warn' && 'bg-warn',
            dot === 'danger' && 'bg-danger'
          )}
        />
      </span>
      {label}
    </span>
  )
}

import { cn } from '../../lib/utils'

export default function PageHeader({
  title,
  subtitle,
  actions,
  meta,
  status,
  className = '',
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-4', className)}>
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight text-white md:text-[1.7rem]">
          {title}
        </h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-sm text-mist">{subtitle}</p>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-mist/80">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      {status}
    </div>
  )
}

export function LiveChip({ label = 'Demo mode', dot = 'cyan', className = '' }) {
  return (
    <span className={cn('inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-wider text-mist', className)}>
      <span className="relative flex h-2 w-2">
        <span className={cn('absolute h-full w-full animate-ping rounded-full opacity-50', dot === 'cyan' && 'bg-cyan', dot === 'safe' && 'bg-safe', dot === 'warn' && 'bg-warn', dot === 'danger' && 'bg-danger')} />
        <span className={cn('relative h-2 w-2 rounded-full', dot === 'cyan' && 'bg-cyan', dot === 'safe' && 'bg-safe', dot === 'warn' && 'bg-warn', dot === 'danger' && 'bg-danger')} />
      </span>
      {label}
    </span>
  )
}
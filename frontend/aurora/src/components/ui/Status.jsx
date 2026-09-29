import { cn } from '../../lib/utils'

export function EmptyState({ icon: Icon, title, message, action, className = '' }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2.5 border border-dashed border-graphite-600 px-6 py-10 text-center',
        className
      )}
    >
      {Icon && <Icon size={20} className="text-steel" />}
      <div>
        <h4 className="text-[13px] font-semibold text-white/85">{title}</h4>
        {message && <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-mist">{message}</p>}
      </div>
      {action}
    </div>
  )
}

export function LoadingState({ label = 'Loading', compact = false, className = '' }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-2.5 border border-graphite-600 bg-graphite-850 px-6 py-8',
        compact && 'px-3 py-2.5',
        className
      )}
    >
      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-graphite-500 border-t-ice" />
      <span className="mono-label">{label}</span>
    </div>
  )
}

/**
 * The canonical treatment for a value the backend does not publish.
 * Never replaced by an estimate.
 */
export function Unavailable({ label = 'Data unavailable', reason, className = '' }) {
  return (
    <div className={cn('border border-graphite-600 bg-graphite-850 px-3 py-2.5', className)}>
      <p className="mono-label text-steel">{label}</p>
      {reason && <p className="mt-1 text-[11.5px] leading-relaxed text-mist">{reason}</p>}
    </div>
  )
}

export function ErrorState({ title = 'Request failed', message, onRetry, compact = false, className = '' }) {
  return (
    <div
      className={cn(
        'border border-danger/40 bg-danger/[0.07] px-4 py-3',
        compact && 'px-3 py-2.5',
        className
      )}
    >
      <p className="text-[12.5px] font-semibold text-danger">{title}</p>
      {message && <p className="mt-1 break-words font-mono text-[11.5px] leading-relaxed text-mist">{message}</p>}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded border border-graphite-500 bg-graphite-750 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-graphite-700"
        >
          Retry
        </button>
      )}
    </div>
  )
}

export function RefreshSpinner({ className = '' }) {
  return <span className={cn('inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-graphite-500 border-t-ice', className)} />
}

import { cn } from '../../lib/utils'

export function EmptyState({ icon: Icon, title, message, action, className = '' }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center', className)}>
      {Icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-mist">
          <Icon size={24} />
        </div>
      )}
      <div>
        <h4 className="text-sm font-semibold text-white/80">{title}</h4>
        {message && <p className="mt-1 max-w-sm text-xs text-mist">{message}</p>}
      </div>
      {action}
    </div>
  )
}

export function LoadingState({ label = 'Loading data…', className = '' }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/5 bg-navy-mid/40 px-6 py-12', className)}>
      <div className="relative h-8 w-8">
        <div className="absolute inset-0 rounded-full border-2 border-white/10" />
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-cyan" />
      </div>
      <p className="text-xs font-medium uppercase tracking-widest text-mist">{label}</p>
    </div>
  )
}

export function RefreshSpinner() {
  return (
    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-mist/30 border-t-cyan" />
  )
}
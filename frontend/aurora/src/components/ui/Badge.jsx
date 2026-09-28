import { cn } from '../../lib/utils'

const severityStyles = {
  Critical: 'bg-danger/15 text-danger border-danger/20',
  High: 'bg-danger/15 text-danger border-danger/20',
  Warning: 'bg-warn/15 text-warn border-warn/20',
  Moderate: 'bg-warn/15 text-warn border-warn/20',
  Low: 'bg-safe/15 text-safe border-safe/20',
  Information: 'bg-cyan/10 text-cyan border-cyan/15',
  Active: 'bg-danger/15 text-danger border-danger/20',
  Monitoring: 'bg-warn/15 text-warn border-warn/20',
  Acknowledged: 'bg-cyan/10 text-cyan border-cyan/15',
  Resolved: 'bg-safe/10 text-safe border-safe/15',
  Available: 'bg-white/5 text-mist border-white/10',
  Recommended: 'bg-safe/15 text-safe border-safe/20',
  'En Route': 'bg-cyan/15 text-cyan border-cyan/20',
  'At Station': 'bg-safe/10 text-safe border-safe/15',
  Alert: 'bg-danger/15 text-danger border-danger/20',
}

export default function Badge({ value, className = '', children }) {
  const label = value ?? children
  const style = severityStyles[label] ?? 'bg-white/5 text-mist border-white/10'
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold', style, className)}>
      <span className="relative flex h-1.5 w-1.5">
        <span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-40', label === 'Critical' ? 'bg-danger' : label === 'Warning' ? 'bg-warn' : 'bg-cyan')} />
        <span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', label === 'Critical' ? 'bg-danger' : label === 'Warning' ? 'bg-warn' : label === 'Low' || label === 'Resolved' ? 'bg-safe' : 'bg-cyan')} />
      </span>
      {label}
    </span>
  )
}

export function Dot({ color = 'cyan', className = '' }) {
  const c = {
    cyan: 'bg-cyan',
    safe: 'bg-safe',
    warn: 'bg-warn',
    danger: 'bg-danger',
    mist: 'bg-mist',
  }[color] ?? 'bg-mist'
  return <span className={cn('inline-block h-2 w-2 rounded-full', c, className)} />
}
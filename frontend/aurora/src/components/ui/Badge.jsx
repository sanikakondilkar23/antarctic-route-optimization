import { cn } from '../../lib/utils'

/**
 * Compact status tags. Colours are muted and used only to reinforce a state
 * that is also written out in text - never as decoration.
 */
const tones = {
  ok: 'border-safe/40 bg-safe/10 text-safe',
  warn: 'border-warn/40 bg-warn/10 text-warn',
  bad: 'border-danger/40 bg-danger/10 text-danger',
  info: 'border-ice/40 bg-ice/10 text-ice',
  neutral: 'border-graphite-500 bg-graphite-800 text-mist',
}

const labelTone = {
  REAL: 'ok',
  PARTIAL: 'warn',
  NOT_AVAILABLE: 'neutral',
  NOT_CONNECTED: 'neutral',
  SYNTHETIC: 'warn',
  DEMO: 'warn',
  Available: 'ok',
  Ready: 'ok',
  READY: 'ok',
  'INTEGRATION READY': 'warn',
  BLOCKED: 'bad',
  Active: 'bad',
  Warning: 'warn',
  Critical: 'bad',
  High: 'bad',
  Moderate: 'warn',
  Low: 'ok',
}

export default function Badge({ value, tone, className = '', children, dot = true }) {
  const label = value ?? children
  const t = tone ?? labelTone[label] ?? 'neutral'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-[1px] font-mono text-[10px] font-medium uppercase tracking-[0.08em]',
        tones[t] ?? tones.neutral,
        className
      )}
    >
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full bg-current opacity-70')} />}
      {label}
    </span>
  )
}

export function Dot({ color = 'ice', className = '' }) {
  const c = {
    ice: 'bg-ice',
    safe: 'bg-safe',
    warn: 'bg-warn',
    danger: 'bg-danger',
    mist: 'bg-mist',
    steel: 'bg-steel',
  }[color] ?? 'bg-mist'
  return <span className={cn('inline-block h-2 w-2 rounded-full', c, className)} />
}

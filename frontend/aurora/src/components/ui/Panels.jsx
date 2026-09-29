import { Link } from 'react-router-dom'
import { ArrowUpRight, CircleSlash, Clock3, Info } from 'lucide-react'
import Badge from './Badge'
import { cn } from '../../lib/utils'

/**
 * Shared readout primitives for the AURORA console.
 *
 * Every component here renders a value (or an explicit absence of one) that
 * the caller already received from the backend. Nothing in this file derives,
 * estimates or defaults a measurement: when a caller passes no value the
 * component prints the state name instead - "Unavailable", "Integration
 * pending", "No data".
 */

/* ------------------------------------------------------------------ */
/* Status vocabulary                                                   */
/* ------------------------------------------------------------------ */

const TONE = {
  ok: 'text-safe',
  ready: 'text-safe',
  warn: 'text-warn',
  pending: 'text-warn',
  bad: 'text-danger',
  unavailable: 'text-warn',
  info: 'text-ice',
  neutral: 'text-mist',
}

const DOT = {
  ok: 'bg-safe',
  ready: 'bg-safe',
  warn: 'bg-warn',
  pending: 'bg-warn',
  bad: 'bg-danger',
  unavailable: 'bg-warn',
  info: 'bg-ice',
  neutral: 'bg-steel',
}

/** Maps the backend's own status vocabulary onto a visual tone. */
export function toneFor(status) {
  const s = String(status ?? '').toUpperCase()
  if (s === 'READY' || s === 'REAL' || s === 'AVAILABLE') return 'ok'
  if (s === 'INTEGRATION READY' || s === 'PARTIAL') return 'pending'
  if (s === 'DATA UNAVAILABLE' || s === 'GEOREFERENCING UNAVAILABLE') return 'unavailable'
  if (s === 'MODEL UNAVAILABLE' || s === 'ERROR' || s === 'BLOCKED') return 'bad'
  return 'neutral'
}

/* ------------------------------------------------------------------ */
/* Section header                                                      */
/* ------------------------------------------------------------------ */

export function SectionHeader({ eyebrow, title, description, action, className = '' }) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-3 border-b border-graphite-600 pb-2.5', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className={cn('mt-1 text-[15px] font-semibold tracking-tight text-white', !eyebrow && 'mt-0')}>
          {title}
        </h2>
        {description && <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-mist">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* StatusCard - one component's reported state                         */
/* ------------------------------------------------------------------ */

export function StatusCard({
  icon: Icon,
  label,
  status,
  detail,
  to,
  lines = [],
  className = '',
}) {
  const tone = toneFor(status)
  const Body = to ? Link : 'div'

  return (
    <Body
      {...(to ? { to } : {})}
      className={cn(
        'group flex h-full flex-col border border-graphite-600 bg-graphite-850 px-4 py-3.5 transition',
        to && 'hover:border-ice/50 hover:bg-graphite-800',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          {Icon && (
            <span className="flex h-8 w-8 shrink-0 items-center justify-center border border-graphite-600 bg-graphite-950 text-ice">
              <Icon size={15} />
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-white">{label}</p>
            <p className={cn('mt-0.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em]', TONE[tone])}>
              <span className={cn('h-1.5 w-1.5 rounded-full', DOT[tone])} />
              {status ?? 'unknown'}
            </p>
          </div>
        </div>
        {to && (
          <ArrowUpRight
            size={15}
            className="shrink-0 text-steel transition group-hover:-translate-y-0.5 group-hover:text-ice"
          />
        )}
      </div>

      {detail && (
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-mist">{detail}</p>
      )}

      {lines.length > 0 && (
        <dl className="mt-2.5 space-y-1 border-t border-graphite-700 pt-2.5">
          {lines.map(([k, v, cls]) => (
            <div key={k} className="flex items-baseline justify-between gap-3">
              <dt className="shrink-0 text-[11.5px] text-mist">{k}</dt>
              <dd
                className={cn('num truncate text-right text-[12px]', cls ?? 'text-white/90')}
                title={v == null ? '' : String(v)}
              >
                {v == null ? '—' : v}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Body>
  )
}

/* ------------------------------------------------------------------ */
/* MetricCard - one measured value, or an explicit absence of one      */
/* ------------------------------------------------------------------ */

export function MetricCard({ label, value, unit, state, note, tone, className = '' }) {
  const resolved = state ?? (value == null ? 'unavailable' : 'ok')
  const unavailable = resolved !== 'ok'

  return (
    <div className={cn('border border-graphite-600 bg-graphite-850 px-3.5 py-3', className)}>
      <p className="eyebrow">{label}</p>

      {unavailable ? (
        <p className={cn('mt-2 flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.1em]', TONE[resolved] ?? 'text-warn')}>
          {resolved === 'pending' ? <Clock3 size={12} /> : <CircleSlash size={12} />}
          {value ?? (resolved === 'pending' ? 'Integration pending' : 'Unavailable')}
        </p>
      ) : (
        <p className={cn('mt-1.5 flex items-baseline gap-1.5', tone)}>
          <span className="num text-[21px] font-medium leading-none text-white">{value}</span>
          {unit && <span className="text-[11px] font-medium text-mist">{unit}</span>}
        </p>
      )}

      {note && <p className="mt-2 border-t border-graphite-700 pt-1.5 text-[11px] leading-snug text-mist">{note}</p>}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* ModelCard - the three intelligence components                       */
/* ------------------------------------------------------------------ */

export function ModelCard({
  index,
  name,
  purpose,
  input,
  output,
  status,
  statusTone,
  integration,
  endpoint,
  to,
  loading,
  children,
}) {
  return (
    <article className="group flex h-full flex-col border border-graphite-600 bg-graphite-850 transition hover:border-ice/45">
      <header className="flex items-start justify-between gap-3 border-b border-graphite-600 bg-graphite-800 px-4 py-3">
        <div className="min-w-0">
          <p className="mono-label">MODEL {index}</p>
          <h3 className="mt-1 text-[14.5px] font-semibold leading-tight text-white">{name}</h3>
        </div>
        <Badge value={status} tone={statusTone ?? toneFor(status)} />
      </header>

      <div className="flex flex-1 flex-col gap-3 px-4 py-3.5">
        <div>
          <p className="mono-label">Purpose</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-white/85">{purpose}</p>
        </div>

        <dl className="space-y-1.5 border-t border-graphite-700 pt-3">
          <div>
            <dt className="mono-label">Input</dt>
            <dd className="mt-0.5 text-[12px] leading-relaxed text-mist">{input}</dd>
          </div>
          <div>
            <dt className="mono-label">Output</dt>
            <dd className="mt-0.5 text-[12px] leading-relaxed text-mist">{output}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 pt-1">
            <dt className="text-[11.5px] text-mist">Integration status</dt>
            <dd className={cn('num text-right text-[12px]', TONE[toneFor(integration)] ?? 'text-white/90')}>
              {integration}
            </dd>
          </div>
        </dl>

        {loading && (
          <p className="flex items-center gap-2 border border-graphite-700 bg-graphite-900 px-3 py-2 font-mono text-[10.5px] uppercase tracking-wider text-steel">
            <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-graphite-500 border-t-ice" />
            probing backend…
          </p>
        )}

        {children}

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-graphite-700 pt-3">
          <span className="mono-label truncate" title={endpoint}>
            {endpoint}
          </span>
          {to && (
            <Link
              to={to}
              className="inline-flex shrink-0 items-center gap-1.5 border border-graphite-500 bg-graphite-750 px-2.5 py-1.5 text-[12px] font-medium text-white transition hover:border-ice/50 hover:bg-graphite-700"
            >
              Open <ArrowUpRight size={13} className="text-ice" />
            </Link>
          )}
        </div>
      </div>
    </article>
  )
}

/* ------------------------------------------------------------------ */
/* Notice blocks                                                       */
/* ------------------------------------------------------------------ */

/** A limitation the system reports about itself. Never decorative. */
export function Notice({ icon: Icon = Info, title, children, tone = 'warn', className = '' }) {
  const styles = {
    warn: 'border-warn/35 bg-warn/[0.06] text-warn',
    info: 'border-ice/30 bg-ice/[0.05] text-ice',
    danger: 'border-danger/40 bg-danger/[0.07] text-danger',
  }[tone]

  return (
    <div className={cn('flex items-start gap-3 border px-4 py-3', styles, className)}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        {title && <p className="text-[13px] font-semibold">{title}</p>}
        <div className={cn('text-[12px] leading-relaxed text-mist', title && 'mt-1')}>{children}</div>
      </div>
    </div>
  )
}

/** Compact label/value row used inside panels. */
export function Row({ k, v, tone = '' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-graphite-700 py-[5px] last:border-0">
      <dt className="shrink-0 text-[11.5px] text-mist">{k}</dt>
      <dd className={cn('num truncate text-right text-[12px]', tone || 'text-white/90')} title={v == null ? '' : String(v)}>
        {v == null ? '—' : v}
      </dd>
    </div>
  )
}

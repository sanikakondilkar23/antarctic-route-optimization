import { cn } from '../../lib/utils'

export function Card({ className = '', children, ...props }) {
  return (
    <div className={cn('card', className)} {...props}>
      {children}
    </div>
  )
}

Card.Header = function CardHeader({ title, subtitle, icon: Icon, action, className = '' }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-graphite-600 px-4 py-3', className)}>
      <div className="flex items-center gap-2.5">
        {Icon && <Icon size={14} className="shrink-0 text-ice" />}
        <div>
          <h3 className="section-title">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11.5px] leading-snug text-mist">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

Card.Body = function CardBody({ className = '', children }) {
  return <div className={cn('px-4 py-3.5', className)}>{children}</div>
}

export default Card

export function Panel({ className = '', children }) {
  return <Card className={className}>{children}</Card>
}

/** A labelled key/value row used throughout the readouts. */
export function KeyValue({ label, value, hint, tone = '', className = '' }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 border-b border-graphite-700 py-1.5 last:border-0', className)}>
      <span className="text-[11.5px] text-mist">{label}</span>
      <span className={cn('num text-right text-[12.5px] text-white', tone)}>{value}</span>
      {hint && <span className="mono-label shrink-0">{hint}</span>}
    </div>
  )
}

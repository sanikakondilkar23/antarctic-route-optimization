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
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-white/5 px-5 py-4', className)}>
      <div className="flex items-center gap-3">
        {Icon && (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan/10 text-cyan">
            <Icon className="h-4.5 w-4.5" size={18} />
          </div>
        )}
        <div>
          <h3 className="section-title">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-mist">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

Card.Body = function CardBody({ className = '', children }) {
  return <div className={cn('px-5 py-4', className)}>{children}</div>
}

export default Card

export function Panel({ className = '', children }) {
  return <Card className={className}>{children}</Card>
}
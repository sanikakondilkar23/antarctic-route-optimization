import Card from '../ui/Card'

const AXIS = { stroke: 'rgba(148,163,184,0.4)', fontSize: 11 }
const TICK = { fill: '#7c8ea6', fontSize: 11 }
const GRID = { stroke: 'rgba(148,163,184,0.08)' }

export function ChartTooltip({ active, payload, label, unit = '' }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-white/10 bg-navy-mid px-3 py-2 shadow-card">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-mist">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-2 text-xs text-white/85">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color || p.fill }} />
          <span className="capitalize">{p.name}:</span>
          <span className="font-semibold text-cyan">
            {typeof p.value === 'number' ? p.value.toLocaleString() : p.value}
            {unit}
          </span>
        </p>
      ))}
    </div>
  )
}

export const chartTheme = {
  AXIS,
  TICK,
  GRID,
}

export function ChartCard({ title, subtitle, action, children, className = '', height = 250 }) {
  return (
    <Card className={className}>
      <Card.Header title={title} subtitle={subtitle} action={action} />
      <Card.Body>
        <div style={{ height }}>{children}</div>
      </Card.Body>
    </Card>
  )
}

export { Card }
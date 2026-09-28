import Card from './Card'
import { cn } from '../../lib/utils'

export default function StatCard({
  label,
  value,
  subtitle,
  icon: Icon,
  tone = 'cyan',
  note,
  trend,
  className = '',
}) {
  const tones = {
    cyan: 'text-mint bg-mint/10 border-mint/25',
    safe: 'text-mint bg-mint/10 border-mint/25',
    warn: 'text-warn bg-warn/10 border-warn/25',
    danger: 'text-danger bg-danger/10 border-danger/25',
    ocean: 'text-azure bg-azure/10 border-azure/25',
    ice: 'text-ice-pale bg-ice-pale/10 border-ice-pale/25',
  }

  return (
    <Card className={cn('relative overflow-hidden p-4 card-hover group border border-white/10 bg-abyssal-card/90', className)}>
      {/* Polar instrument crosshair top-left */}
      <span className="pointer-events-none absolute top-2 left-2 text-[10px] font-mono text-white/15">＋</span>
      <span className="pointer-events-none absolute top-2 right-2 text-[9px] font-mono text-mist/40">INSTRUMENT_READOUT</span>

      <div className="flex items-start justify-between gap-3 pt-2">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-mist">{label}</p>
          <p className="mt-1.5 font-display text-3xl font-extrabold tracking-tight text-white">
            {value}
            {trend && <span className="ml-1.5 align-middle font-mono text-xs font-semibold text-mint">{trend}</span>}
          </p>
        </div>
        {Icon && (
          <div className={cn('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-transform group-hover:scale-105', tones[tone] || tones.cyan)}>
            <Icon size={20} />
          </div>
        )}
      </div>

      {subtitle && <p className="mt-2 text-xs leading-relaxed text-mist">{subtitle}</p>}

      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-[10px]">
        {note && (
          <span className="inline-flex items-center gap-1 font-mono uppercase tracking-wider text-mist/70">
            <span className="h-1.5 w-1.5 rounded-full bg-mint" />
            {note}
          </span>
        )}
        <span className="font-mono text-mist/40">SYS_OK</span>
      </div>
    </Card>
  )
}
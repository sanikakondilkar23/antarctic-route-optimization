import { cn } from '../../lib/utils'

export default function Logo({ className = '', iconOnly = false }) {
  return (
    <div className={cn('flex items-center gap-2.5 select-none', className)}>
      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-mint via-azure to-ocean-deep shadow-glow ring-1 ring-mint/40">
        <svg viewBox="0 0 36 36" className="h-6 w-6" aria-hidden="true">
          {/* outer diamond shield */}
          <polygon points="18,3 33,18 18,33 3,18" fill="none" stroke="#FFFFFF" strokeOpacity="0.85" strokeWidth="1.5" />
          <polygon points="18,7 29,18 18,29 7,18" fill="none" stroke="#00F2C3" strokeOpacity="0.6" strokeWidth="0.8" strokeDasharray="2 2" />
          {/* ice crystal core */}
          <polygon points="18,7 25,18 18,24 11,18" fill="#FFFFFF" fillOpacity="0.95" />
          <polygon points="18,24 25,18 18,29 11,18" fill="#00F2C3" fillOpacity="0.75" />
          {/* directional needle */}
          <line x1="18" y1="5" x2="18" y2="15" stroke="#080C14" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="18" cy="18" r="2.2" fill="#080C14" stroke="#00F2C3" strokeWidth="1.2" />
        </svg>
        <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-mint ring-2 ring-abyssal animate-pulse" />
      </div>
      {!iconOnly && (
        <div className="leading-tight">
          <div className="font-display text-base font-extrabold tracking-[0.14em] text-white">
            NAVIGLACE<span className="text-mint"> AI</span>
          </div>
          <div className="text-[10px] font-mono font-medium uppercase tracking-[0.2em] text-mist">
            Antarctic Maritime Intelligence
          </div>
        </div>
      )}
    </div>
  )
}
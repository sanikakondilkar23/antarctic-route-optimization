import { cn } from '../../lib/utils'

export default function Logo({ className = '', size = 'md' }) {
  const box = size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'
  const glyph = size === 'sm' ? 'h-4 w-4' : 'h-5 w-5'
  return (
    <div className={cn('flex items-center gap-2.5 select-none', className)}>
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-[3px] border border-graphite-500 bg-graphite-800',
          box
        )}
      >
        <svg viewBox="0 0 24 24" className={glyph} aria-hidden="true">
          {/* meridian + parallel cross, the chart symbol */}
          <path
            d="M12 2.5c3.6 2.4 5.6 5.8 5.6 9.5S15.6 19.1 12 21.5c-3.6-2.4-5.6-5.8-5.6-9.5S8.4 4.9 12 2.5Z"
            fill="none"
            stroke="#A8CFE6"
            strokeWidth="1.2"
          />
          <path d="M2.5 12h19" stroke="#7FB4D4" strokeWidth="1.1" />
          <path d="M4.6 7.2h14.8M4.6 16.8h14.8" stroke="#7FB4D4" strokeWidth="0.8" strokeOpacity="0.65" />
          <circle cx="12" cy="12" r="1.7" fill="#E9ECEF" />
        </svg>
      </span>
      <span className="leading-none">
        <span className="block font-display text-[15px] font-semibold tracking-[0.26em] text-white">
          AURORA
        </span>
        <span className="mt-[3px] block max-w-[220px] text-[8.5px] font-medium uppercase leading-[1.35] tracking-[0.11em] text-steel">
          Antarctic Unified Routing &amp; Operational Risk Analytics
        </span>
      </span>
    </div>
  )
}

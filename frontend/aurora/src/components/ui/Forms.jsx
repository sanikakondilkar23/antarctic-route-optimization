import { cn } from '../../lib/utils'

export function Toggle({ checked, onChange, label, description, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex w-full items-center justify-between gap-4 rounded-xl border border-white/5 bg-navy-deep/50 px-4 py-3 text-left transition',
        !disabled && 'hover:border-white/10'
      )}
    >
      <span>
        {label && <span className="block text-sm font-medium text-white/85">{label}</span>}
        {description && <span className="mt-0.5 block text-xs text-mist">{description}</span>}
      </span>
      <span
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition',
          checked ? 'bg-cyan' : 'bg-white/10'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
            checked ? 'left-[22px]' : 'left-0.5'
          )}
        />
      </span>
    </button>
  )
}

export function SelectField({ label, value, onChange, options, hint, className = '' }) {
  return (
    <label className={cn('block', className)}>
      {label && <span className="input-label">{label}</span>}
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="input appearance-none pr-9"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value} className="bg-navy-mid text-white">
              {o.label}
            </option>
          ))}
        </select>
        <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mist" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      {hint && <p className="mt-1 text-[11px] text-mist/70">{hint}</p>}
    </label>
  )
}

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      {label && <span className="input-label">{label}</span>}
      {children}
      {hint && <p className="mt-1 text-[11px] text-mist/70">{hint}</p>}
    </label>
  )
}
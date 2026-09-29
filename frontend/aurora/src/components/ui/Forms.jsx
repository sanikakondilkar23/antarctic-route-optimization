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
        'flex w-full items-start justify-between gap-4 border border-graphite-600 bg-graphite-800 px-3 py-2.5 text-left transition',
        !disabled && 'hover:border-graphite-500',
        disabled && 'cursor-not-allowed opacity-55'
      )}
    >
      <span className="min-w-0">
        {label && <span className="block text-[12.5px] font-medium leading-snug text-white/90">{label}</span>}
        {description && <span className="mt-0.5 block text-[11px] leading-snug text-steel">{description}</span>}
      </span>
      <span
        className={cn(
          'relative mt-0.5 h-4 w-8 shrink-0 rounded-full border transition-colors',
          checked ? 'border-ice-dim bg-ice-dim/70' : 'border-graphite-500 bg-graphite-950'
        )}
      >
        <span
          className={cn(
            'absolute top-[1px] h-[12px] w-[12px] rounded-full transition-all',
            checked ? 'left-[17px] bg-white' : 'left-[1px] bg-steel'
          )}
        />
      </span>
    </button>
  )
}

export function SelectField({ label, value, onChange, options, hint, disabled, className = '' }) {
  return (
    <label className={cn('block', className)}>
      {label && <span className="input-label">{label}</span>}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="select"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-graphite-850 text-white">
            {o.label}
          </option>
        ))}
      </select>
      {hint && <p className="mt-1 text-[11px] leading-snug text-steel">{hint}</p>}
    </label>
  )
}

export function Field({ label, children, hint }) {
  return (
    <label className="block">
      {label && <span className="input-label">{label}</span>}
      {children}
      {hint && <p className="mt-1 text-[11px] leading-snug text-steel">{hint}</p>}
    </label>
  )
}

export function Checkbox({ checked, onChange, label, hint, disabled }) {
  return (
    <label className={cn('flex items-start gap-2 text-[12px] leading-snug', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-[2px] h-3.5 w-3.5 shrink-0 rounded-[2px] border-graphite-500 bg-graphite-950 accent-ice"
      />
      <span>
        <span className="text-white/85">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] text-steel">{hint}</span>}
      </span>
    </label>
  )
}

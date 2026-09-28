import { cn } from '../../lib/utils'

export default function Button({ variant = 'primary', size = 'md', className = '', children, ...props }) {
  const variants = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'btn-ghost',
    danger: 'inline-flex items-center justify-center gap-2 rounded-xl bg-danger/15 border border-danger/25 px-4 py-2 text-sm font-semibold text-danger hover:bg-danger/25',
  }
  const sizes = {
    sm: '!px-3 !py-1.5 !text-xs',
    md: '',
    lg: '!px-6 !py-3 !text-base',
  }
  return (
    <button className={cn(variants[variant], sizes[size], className)} {...props}>
      {children}
    </button>
  )
}
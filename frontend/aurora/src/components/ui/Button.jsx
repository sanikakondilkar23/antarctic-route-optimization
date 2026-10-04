import { cn } from '../../lib/utils'

export default function Button({ variant = 'primary', size = 'md', className = '', children, ...props }) {
  const variants = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    ghost: 'btn-ghost',
    danger: 'btn-danger',
  }
  const sizes = {
    sm: '!px-2.5 !py-1 !text-[12px]',
    md: '',
    lg: '!px-5 !py-2.5 !text-sm',
  }
  return (
    <button className={cn(variants[variant], sizes[size], className)} {...props}>
      {children}
    </button>
  )
}

import { Info } from 'lucide-react'

export default function Disclaimer({ className = '' }) {
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border border-white/5 bg-navy-deep/40 px-4 py-3 ${className}`}>
      <Info size={15} className="mt-0.5 shrink-0 text-mist" />
      <p className="text-[11px] leading-relaxed text-mist">
        This platform is a prototype for research and demonstration. Forecasts, routes, risk levels, and
        vessel data shown in demo mode are illustrative and must not be used as the sole basis for
        real-world navigation.
      </p>
    </div>
  )
}
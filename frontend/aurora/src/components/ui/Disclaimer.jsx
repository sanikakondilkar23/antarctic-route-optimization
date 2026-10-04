import { Info } from 'lucide-react'

export default function Disclaimer({ className = '' }) {
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border border-white/5 bg-navy-deep/40 px-4 py-3 ${className}`}>
      <Info size={15} className="mt-0.5 shrink-0 text-mist" />
      <p className="text-[11px] leading-relaxed text-mist">
        AURORA is a research prototype (SIH 26059). Sea-ice fields, uncertainty and routes shown are
        real outputs of this repository's committed artifacts, but the system does not provide
        charting-grade safety, live vessel or iceberg tracking, or ice-pilot judgement, and must not
        be used for real-world navigation.
      </p>
    </div>
  )
}

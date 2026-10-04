import { useState } from 'react'
import { Info, ShieldCheck, ChevronDown, ChevronUp } from 'lucide-react'

export default function AboutModelBlock({
  modelName,
  architecture,
  purpose,
  inputs,
  outputs,
  endpoint,
  checkpoint,
  limitations,
  defaultOpen = false,
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="rounded-xl border border-white/10 bg-[#071D33]/80 p-3 backdrop-blur-xl text-xs space-y-2.5">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between text-left group"
      >
        <div className="flex items-center gap-1.5 font-bold text-white text-xs font-display">
          <Info size={14} className="text-[#22E5F0] group-hover:scale-110 transition" />
          <span>About {modelName}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-emerald-400 font-semibold flex items-center gap-1">
            <ShieldCheck size={12} /> Verified Model Pipeline
          </span>
          <span className="text-mist group-hover:text-white transition">
            {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </div>
      </button>

      <p className="text-mist leading-relaxed text-[11px]">{purpose}</p>

      {isOpen && (
        <>
          <div className="grid gap-2 border-t border-white/5 pt-2 text-[11px] font-mono">
            <div>
              <span className="text-mist uppercase tracking-wider text-[9.5px]">Architecture</span>
              <p className="text-white font-medium">{architecture}</p>
            </div>
            <div>
              <span className="text-mist uppercase tracking-wider text-[9.5px]">Input Parameters</span>
              <p className="text-[#A9DFFF]">{inputs}</p>
            </div>
            <div>
              <span className="text-mist uppercase tracking-wider text-[9.5px]">Output Format</span>
              <p className="text-[#22E5F0]">{outputs}</p>
            </div>
            {endpoint && (
              <div>
                <span className="text-mist uppercase tracking-wider text-[9.5px]">Direct Endpoint</span>
                <p className="text-white/80">{endpoint}</p>
              </div>
            )}
            {checkpoint && (
              <div>
                <span className="text-mist uppercase tracking-wider text-[9.5px]">Checkpoint Path</span>
                <p className="text-mist truncate">{checkpoint}</p>
              </div>
            )}
          </div>

          {limitations && (
            <div className="border-t border-white/5 pt-2 text-[10.5px] text-mist/90 leading-normal">
              <span className="font-semibold text-amber-300">Technical Note: </span>
              {limitations}
            </div>
          )}
        </>
      )}
    </div>
  )
}

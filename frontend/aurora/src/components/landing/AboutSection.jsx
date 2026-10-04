import { ShieldCheck, Compass, Anchor, Scale, AlertCircle, FileCode } from 'lucide-react'

export default function AboutSection() {
  const verifiedFacts = [
    { label: 'Environmental Grid', value: '173 × 369 cells @ 0.25° spatial resolution' },
    { label: 'Forecast Temporal Horizon', value: '167 daily timesteps (2026-01-06 → 2026-06-21)' },
    { label: 'Baseline Voyage Benchmark', value: 'Cape Town Offshore → Maitri Station Approach' },
    { label: 'Primary Safety Rule', value: 'NaN (unknown) cells are impassable; never zero-filled' },
    { label: 'Validation Principle', value: 'Learned policy proposes, A* validation disposes' },
    { label: 'Problem Statement', value: 'Smart India Hackathon SIH 26059 Research Prototype' },
  ]

  return (
    <section id="about" className="relative py-24 px-5 sm:px-8 bg-[#05182B] border-t border-white/10 overflow-hidden">
      {/* Background ambient circular glow */}
      <div className="pointer-events-none absolute -bottom-32 left-1/3 h-[500px] w-[500px] rounded-full bg-[#0A2A4A]/50 blur-3xl" />

      <div className="relative mx-auto max-w-7xl">
        <div className="grid gap-12 lg:grid-cols-12 items-center">
          {/* Left Column: Mission Narrative */}
          <div className="lg:col-span-7 space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#22E5F0]/30 bg-[#22E5F0]/10 px-3.5 py-1 text-xs font-semibold text-[#22E5F0] tracking-wider uppercase">
              <Compass size={13} />
              <span>Project Mission &amp; Science</span>
            </div>

            <h2 className="font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl lg:text-5xl">
              Antarctic Unified Routing &amp; Operational Risk Analytics
            </h2>

            <p className="text-sm sm:text-base text-mist leading-relaxed">
              Resupply and scientific expeditions to Antarctic research stations (such as Maitri
              and Bharati) must traverse the highly dynamic Marginal Ice Zone (MIZ). Historical
              static charts often force ships into severe ice packs or excessive fuel-wasting
              detours.
            </p>

            <p className="text-sm sm:text-base text-mist leading-relaxed">
              <strong className="text-white">Aurora (IceRoute-Robust)</strong> addresses this challenge
              with a trajectory-aware decision support system. Instead of relying on static maps, it
              evaluates navigation against a time-indexed deep learning forecast of sea-ice
              concentration, coupling neural proposal policies with an authoritative, mathematical
              safety gate that strictly refuses non-navigable cells.
            </p>

            {/* Core Philosophy Callout */}
            <div className="rounded-2xl border border-[#22E5F0]/25 bg-gradient-to-r from-[#071D33] to-[#0A2A4A]/60 p-5 backdrop-blur-xl">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#22E5F0]/15 text-[#22E5F0]">
                  <Scale size={18} />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white">
                    The Model Proposes, Safety Validation Disposes
                  </h4>
                  <p className="mt-1 text-xs text-mist leading-relaxed">
                    No neural network output is ever accepted blindly. Proposed actions must pass
                    continuous 8-connectivity checks, land mask exclusion, and strict ice
                    concentration thresholds before reaching vessel operators.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Verified Project Facts & Limitations Panel */}
          <div className="lg:col-span-5 space-y-5">
            <div className="rounded-2xl border border-white/10 bg-[#071D33]/85 p-6 backdrop-blur-xl shadow-2xl">
              <h3 className="flex items-center gap-2 font-display text-base font-bold text-white">
                <FileCode size={17} className="text-[#22E5F0]" />
                <span>Verified System Specifications</span>
              </h3>

              <div className="mt-4 divide-y divide-white/5 space-y-3 pt-1">
                {verifiedFacts.map((f, idx) => (
                  <div key={idx} className="pt-3 first:pt-0">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-mist">
                      {f.label}
                    </span>
                    <p className="mt-0.5 font-mono text-xs font-semibold text-[#EAF6FF]">
                      {f.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Honest Scientific Limitations Badge */}
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4.5 text-xs text-mist leading-relaxed">
              <div className="flex items-center gap-2 font-bold text-amber-300 mb-1">
                <AlertCircle size={14} />
                <span>Scientific Prototype Disclosure</span>
              </div>
              <p className="text-[11px] text-white/80">
                Aurora is an engineering and research prototype developed for SIH 26059. In this deployment,
                wind, bathymetry, and current layers are reported as unavailable rather than simulated.
                This software is decision support, not an authorized IMO navigational aid.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

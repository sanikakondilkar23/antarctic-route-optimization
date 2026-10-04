import { MapPin, BrainCircuit, Route, BarChart3, CheckCircle, ArrowRight } from 'lucide-react'

export default function WorkflowTimeline() {
  const steps = [
    {
      num: '01',
      title: 'Input Journey',
      subtitle: 'Voyage Parameters & Coordinates',
      icon: MapPin,
      color: 'from-[#3AA7FF] to-[#22E5F0]',
      desc: 'Specify geographic start and goal coordinates (e.g. Cape Town 33.9°S to Maitri 70.8°S or Bharati), select your voyage departure date across the 167-day forecast window, and enable endpoint ocean-snapping.',
      techPoints: [
        'Geographic origin & goal resolution',
        'Automatic land-avoiding ocean snapping',
        'Time-indexed 2026 forecast temporal selector',
      ],
    },
    {
      num: '02',
      title: 'AI / Environmental Analysis',
      subtitle: 'Ensemble Forecasting & Hazard Detection',
      icon: BrainCircuit,
      color: 'from-[#22E5F0] to-[#3AA7FF]',
      desc: 'The 3-seed ConvLSTM deep ensemble models the spatiotemporal evolution of sea-ice concentration (SIC) with conformal 1σ uncertainty intervals; YOLOv8 analyzes Sentinel-1 SAR tiles for iceberg hazards.',
      techPoints: [
        '173 × 369 grid @ 0.25° resolution field',
        'Conformal 90% confidence uncertainty spread',
        'Real-time SAR tile iceberg feature inference',
      ],
    },
    {
      num: '03',
      title: 'Route Optimization',
      subtitle: 'CostMap Optimization & Safety Authority',
      icon: Route,
      color: 'from-[#3AA7FF] to-[#A9DFFF]',
      desc: 'Deterministic 8-connected A* search navigates the multi-term CostMap alongside learned policy proposals. Unsafe actions (NaN cells, land, SIC > 0.95) are rejected by the authoritative validation gate.',
      techPoints: [
        'Multi-term cost: w_sic=1.0, w_distance=1.0',
        'Strict safety authority: NaN cells impassable',
        'Dynamic reroute engine with Jaccard validation',
      ],
    },
    {
      num: '04',
      title: 'Route Visualization',
      subtitle: 'Interactive Chart & Trajectory Telemetry',
      icon: BarChart3,
      color: 'from-[#22E5F0] to-[#EAF6FF]',
      desc: 'Inspect the resulting geodesic trajectory, total length in kilometers, waypoint-by-waypoint coordinates, cumulative SIC exposure profile, and initiate dynamic mid-voyage replanning.',
      techPoints: [
        'Interactive Leaflet polar stereographic chart',
        'Waypoint-by-waypoint telemetry & distance',
        'Provenanced JSON route artifact export',
      ],
    },
  ]

  return (
    <section id="workflow" className="relative py-24 px-5 sm:px-8 bg-[#071D33]/60 border-t border-white/10 overflow-hidden">
      {/* Background glow accents */}
      <div className="pointer-events-none absolute right-0 top-1/3 h-96 w-96 rounded-full bg-[#22E5F0]/5 blur-3xl" />
      <div className="pointer-events-none absolute left-0 bottom-1/4 h-96 w-96 rounded-full bg-[#3AA7FF]/5 blur-3xl" />

      <div className="relative mx-auto max-w-7xl">
        {/* Section Title */}
        <div className="text-center max-w-3xl mx-auto">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#3AA7FF]/30 bg-[#3AA7FF]/10 px-3.5 py-1 text-xs font-semibold text-[#3AA7FF] tracking-wider uppercase">
            Four-Phase Pipeline
          </span>
          <h2 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl lg:text-5xl">
            How Aurora Plans Antarctic Routes
          </h2>
          <p className="mt-4 text-sm sm:text-base text-mist leading-relaxed">
            From satellite SAR radar imagery to neural ensemble sea-ice forecasting and
            safety-authoritative A* optimization — every stage is mathematically verifiable.
          </p>
        </div>

        {/* Workflow Timeline Cards */}
        <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-4 relative">
          {/* Connector line for desktop */}
          <div className="hidden lg:block absolute top-1/2 left-8 right-8 h-0.5 -translate-y-16 bg-gradient-to-r from-[#3AA7FF]/30 via-[#22E5F0]/50 to-[#EAF6FF]/30 pointer-events-none" />

          {steps.map((s, idx) => (
            <div
              key={s.num}
              className="group relative flex flex-col justify-between rounded-2xl border border-white/10 bg-[#05182B]/85 p-6 backdrop-blur-xl transition-all duration-300 hover:border-[#22E5F0]/40 hover:shadow-[0_12px_30px_rgba(5,24,43,0.8),0_0_20px_rgba(34,229,240,0.15)] hover:-translate-y-1"
            >
              <div>
                {/* Step badge & icon */}
                <div className="flex items-center justify-between">
                  <span className="font-display text-2xl font-black tracking-tight text-[#22E5F0]/90">
                    STEP {s.num}
                  </span>
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#0A2A4A] to-[#071D33] border border-[#22E5F0]/30 text-[#22E5F0] shadow-[0_0_12px_rgba(34,229,240,0.2)]">
                    <s.icon size={20} />
                  </div>
                </div>

                {/* Subtitle & Title */}
                <div className="mt-5">
                  <p className="text-[10px] font-mono uppercase tracking-wider text-[#A9DFFF]">
                    {s.subtitle}
                  </p>
                  <h3 className="mt-1 font-display text-lg font-bold text-white">
                    {s.title}
                  </h3>
                </div>

                {/* Description */}
                <p className="mt-3 text-xs leading-relaxed text-mist">
                  {s.desc}
                </p>

                {/* Tech Bullet Points */}
                <ul className="mt-5 space-y-2 border-t border-white/5 pt-4">
                  {s.techPoints.map((pt, pIdx) => (
                    <li key={pIdx} className="flex items-start gap-2 text-[11px] text-white/80">
                      <CheckCircle size={12} className="text-[#22E5F0] shrink-0 mt-0.5" />
                      <span>{pt}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Step indicator arrow */}
              <div className="mt-6 flex items-center gap-1.5 text-[11px] font-mono font-semibold text-[#22E5F0]/70 group-hover:text-[#22E5F0]">
                <span>Phase {s.num} Active</span>
                <ArrowRight size={12} className="transition-transform group-hover:translate-x-1" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

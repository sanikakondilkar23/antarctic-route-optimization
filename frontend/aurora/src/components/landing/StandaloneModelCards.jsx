import { Link } from 'react-router-dom'
import {
  Waves,
  Route,
  Eye,
  ArrowRight,
  ShieldCheck,
  Cpu,
  Layers,
  Sparkles,
  Compass,
  Activity,
  CheckCircle2,
} from 'lucide-react'

export default function StandaloneModelCards() {
  const models = [
    {
      id: 'model-1',
      number: 'CAPABILITY 01',
      role: 'Sea-Ice Analysis & Forecasting',
      name: 'Spatiotemporal Sea-Ice Intelligence',
      to: '/sic-forecast',
      description:
        'Predicts Antarctic sea-ice concentration and 90% conformal risk boundaries up to 167 daily forecast steps across a 173 × 369 grid.',
      icon: Waves,
      accentColor: 'text-[#22E5F0]',
      borderColor: 'border-[#22E5F0]/30 hover:border-[#22E5F0]',
      shadowColor: 'hover:shadow-[0_0_35px_rgba(34,229,240,0.25)]',
      gradient: 'from-[#22E5F0] to-[#3AA7FF]',
      bgGlow: 'bg-[#22E5F0]/10',
      badge: 'Calibrated Risk Bounds',
      statusText: 'Integrated in Route Planner',
      inspectLabel: 'View Sea-Ice Analysis',
      inputSummary: 'Forecast Timestep (0–166) & Lead-Time Horizon (D+1 to D+3)',
      outputSummary: '173 × 369 SIC Grid @ 0.25° Resolution + Conformal 90% Spread',
      endpoint: 'GET /api/sic/<t> & /api/uncertainty/<t>',
    },
    {
      id: 'model-2',
      number: 'CAPABILITY 02',
      role: 'Antarctic Route Optimization',
      name: 'Geodesic Navigation Controller',
      to: '/route-planner',
      description:
        'Multi-term geodesic path planner calculating safe, fuel-efficient vessel transit avoiding dense pack ice and non-navigable zones.',
      icon: Route,
      accentColor: 'text-[#3AA7FF]',
      borderColor: 'border-[#3AA7FF]/30 hover:border-[#3AA7FF]',
      shadowColor: 'hover:shadow-[0_0_35px_rgba(58,167,255,0.25)]',
      gradient: 'from-[#3AA7FF] to-[#22E5F0]',
      bgGlow: 'bg-[#3AA7FF]/10',
      badge: 'Safety-Authoritative Gate',
      statusText: 'Core Navigation Engine',
      inspectLabel: 'Launch Route Planner',
      inputSummary: 'Start & Goal Geographic Coordinates (or Presets) + Departure Date',
      outputSummary: '8-Connected Trajectory + Distance (km) + Cumulative Ice Exposure',
      endpoint: 'POST /api/route/optimize & /api/route/reroute',
    },
    {
      id: 'model-3',
      number: 'CAPABILITY 03',
      role: 'Operational Risk & Hazard Detection',
      name: 'Satellite Radar Iceberg Detection',
      to: '/icebergs',
      description:
        'Scans Sentinel-1 satellite radar imagery to pinpoint iceberg hazards and execute automated dynamic rerouting.',
      icon: Eye,
      accentColor: 'text-[#A9DFFF]',
      borderColor: 'border-[#A9DFFF]/30 hover:border-[#A9DFFF]',
      shadowColor: 'hover:shadow-[0_0_35px_rgba(169,223,255,0.25)]',
      gradient: 'from-[#A9DFFF] to-[#3AA7FF]',
      bgGlow: 'bg-[#A9DFFF]/10',
      badge: 'Sentinel-1 SAR Radar',
      statusText: 'Active Hazard Shield',
      inspectLabel: 'View Radar Detections',
      inputSummary: 'Sentinel-1 SAR Radar Imagery Tile (JPG/PNG) + Confidence Threshold',
      outputSummary: 'Iceberg Bounding Boxes + Pixel Space Coordinates + Confidence %',
      endpoint: 'POST /api/icebergs/detect',
    },
  ]

  return (
    <section id="models" className="relative py-24 px-5 sm:px-8 bg-[#05182B] border-t border-white/10 overflow-hidden">
      {/* Ambient background lighting */}
      <div className="pointer-events-none absolute left-1/2 top-10 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-gradient-to-b from-[#22E5F0]/8 via-[#0A2A4A]/25 to-transparent blur-3xl" />

      <div className="relative mx-auto max-w-7xl">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#22E5F0]/30 bg-[#22E5F0]/10 px-3.5 py-1 text-xs font-semibold text-[#22E5F0] tracking-wider uppercase">
            <Sparkles size={13} />
            <span>Maritime Decision Support</span>
          </div>
          <h2 className="mt-4 font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white">
            Navigation Intelligence for Antarctic Operations
          </h2>
          <p className="mt-4 text-sm sm:text-base text-mist leading-relaxed">
            Aurora integrates sea-ice forecasting, geodesic path optimization, and satellite radar hazard detection into a unified operational chart. Plan routes, evaluate risks, and navigate safely with authoritative maritime decision support.
          </p>
        </div>

        {/* 3 Coordinated Model Layers */}
        <div className="mt-16 grid gap-8 lg:grid-cols-3">
          {models.map((m) => (
            <div
              key={m.id}
              className={`group relative flex flex-col justify-between rounded-2xl border bg-gradient-to-b from-[#071D33]/90 to-[#0A2A4A]/40 p-6 sm:p-8 backdrop-blur-xl transition-all duration-300 ${m.borderColor} ${m.shadowColor} hover:-translate-y-1.5`}
            >
              <div>
                {/* Header Row */}
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold tracking-widest text-[#A9DFFF]">
                    {m.number}
                  </span>
                  <span className="inline-flex items-center rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-mono text-white/90">
                    {m.badge}
                  </span>
                </div>

                {/* Role Tag */}
                <div className="mt-3">
                  <span className="inline-block text-[11px] font-mono uppercase tracking-wider text-[#22E5F0]">
                    {m.role}
                  </span>
                </div>

                {/* Icon & Title */}
                <div className="mt-3 flex items-center gap-4">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${m.bgGlow} ${m.accentColor} border border-white/10 shadow-[0_0_15px_rgba(34,229,240,0.15)]`}>
                    <m.icon size={24} />
                  </div>
                  <div>
                    <h3 className="font-display text-xl font-bold text-white group-hover:text-[#EAF6FF]">
                      {m.name}
                    </h3>
                    <span className="text-[10px] font-mono text-mist">{m.endpoint}</span>
                  </div>
                </div>

                {/* One-Line Plain Language Description */}
                <p className="mt-4 text-sm text-[#EAF6FF]/90 leading-relaxed font-normal">
                  {m.description}
                </p>

                {/* Input & Output Specifications */}
                <div className="mt-6 space-y-3 rounded-xl border border-white/5 bg-[#05182B]/70 p-4 text-xs font-mono">
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-mist">Input Specification</span>
                    <p className="text-white/90 mt-0.5 leading-snug">{m.inputSummary}</p>
                  </div>
                  <div className="border-t border-white/5 pt-2">
                    <span className="text-[10px] uppercase tracking-wider text-mist">Output Specification</span>
                    <p className="text-[#A9DFFF] mt-0.5 leading-snug">{m.outputSummary}</p>
                  </div>
                </div>
              </div>

              {/* Status and Diagnostics Link (NO "Open Model" language) */}
              <div className="mt-8 pt-4 border-t border-white/10 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-xs font-mono font-medium text-emerald-400">
                  <CheckCircle2 size={14} />
                  <span>{m.statusText}</span>
                </span>
                <Link
                  to={m.to}
                  className="inline-flex items-center gap-1 text-xs font-mono text-mist hover:text-[#22E5F0] transition"
                  title={m.inspectLabel}
                >
                  <span>{m.inspectLabel}</span>
                  <ArrowRight size={13} />
                </Link>
              </div>
            </div>
          ))}
        </div>

        {/* Global Unified CTA Banner */}
        <div className="mt-16 rounded-2xl border border-[#22E5F0]/30 bg-gradient-to-r from-[#071D33] via-[#0A2A4A] to-[#071D33] p-8 sm:p-10 shadow-2xl backdrop-blur-xl relative overflow-hidden">
          <div className="absolute right-0 top-0 h-full w-1/3 bg-[radial-gradient(circle_at_center,_rgba(34,229,240,0.15),_transparent_70%)] pointer-events-none" />
          <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-[#22E5F0]/30 bg-[#22E5F0]/10 px-3 py-1 text-xs font-semibold text-[#22E5F0] tracking-wider uppercase mb-3">
                <Compass size={13} />
                <span>Unified Polar Mission System</span>
              </div>
              <h3 className="font-display text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Plan Your Antarctic Route
              </h3>
              <p className="mt-2 text-sm text-mist leading-relaxed">
                Launch the Antarctic Polar Stereographic navigation map. Plan voyages between Cape Town, Hobart, Maitri, and Bharati stations with live ice forecasts and automatic hazard avoidance.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4 shrink-0">
              <Link
                to="/route-planner"
                className="group relative inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-[#22E5F0] to-[#3AA7FF] px-6 py-3.5 text-sm font-bold text-[#05182B] shadow-[0_0_25px_rgba(34,229,240,0.4)] transition-all duration-300 hover:shadow-[0_0_35px_rgba(34,229,240,0.6)] hover:scale-[1.02] active:scale-[0.98]"
              >
                <Compass size={18} className="transition-transform group-hover:rotate-45" />
                <span>Launch Route Planner</span>
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                to="/dashboard"
                className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-[#05182B]/70 px-5 py-3.5 text-sm font-semibold text-white hover:border-[#22E5F0]/40 hover:bg-[#071D33] transition"
              >
                <Activity size={16} className="text-[#22E5F0]" />
                <span>Mission Control</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

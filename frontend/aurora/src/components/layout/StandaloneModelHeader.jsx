import { Link } from 'react-router-dom'
import { ArrowLeft, Waves, Route, Eye, Sparkles } from 'lucide-react'

export default function StandaloneModelHeader({
  currentModelId, // 'model-1' | 'model-2' | 'model-3'
  modelNumber = 'MODEL 01',
  title,
  subtitle,
  accentColor = 'text-[#22E5F0]',
  accentBorder = 'border-[#22E5F0]/30',
  accentBg = 'bg-[#22E5F0]/10',
  icon: Icon,
}) {
  const models = [
    {
      id: 'model-1',
      name: 'SIC Forecaster',
      fullName: 'ConvLSTM SIC Forecaster',
      to: '/sic-forecast',
      icon: Waves,
      color: 'text-[#22E5F0]',
    },
    {
      id: 'model-2',
      name: 'Route Optimizer',
      fullName: 'A* & Policy Route Optimizer',
      to: '/route-planner',
      icon: Route,
      color: 'text-[#3AA7FF]',
    },
    {
      id: 'model-3',
      name: 'Iceberg Detector',
      fullName: 'YOLOv8 SAR Iceberg Detector',
      to: '/icebergs',
      icon: Eye,
      color: 'text-[#A9DFFF]',
    },
  ]

  return (
    <div className="shrink-0 border-b border-white/10 bg-[#071D33]/90 px-4 py-3 backdrop-blur-xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        {/* Left: Back Link & Model Identity */}
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-mist hover:text-white hover:bg-white/10 transition"
            title="Back to Home / Overview"
          >
            <ArrowLeft size={14} />
            <span className="hidden sm:inline">Overview</span>
          </Link>

          <div className="h-5 w-px bg-white/10 mx-0.5" />

          <div className="flex items-center gap-2.5">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${accentBg} ${accentColor} border ${accentBorder}`}>
              {Icon && <Icon size={16} />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#A9DFFF]">
                  {currentModelId === 'model-2' ? 'Aurora Antarctic Route Planner' : `${modelNumber} · AI Engine Layer`}
                </span>
                <span className="rounded bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.2 text-[9px] font-mono text-emerald-400 font-semibold">
                  {currentModelId === 'model-2' ? 'Unified 3-Model System' : 'Integrated Pipeline'}
                </span>
              </div>
              <h1 className="font-display text-sm sm:text-base font-bold text-white tracking-tight leading-tight">
                {title}
              </h1>
            </div>
          </div>
        </div>

        {/* Right: Quick Switcher / Diagnostics Links */}
        <div className="flex items-center gap-1.5 text-xs font-mono">
          <span className="text-mist text-[11px] mr-1 hidden md:inline">Mission Views:</span>
          {models.map((m) => {
            const isCurrent = m.id === currentModelId
            return (
              <Link
                key={m.id}
                to={m.to}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition ${
                  isCurrent
                    ? `${accentBg} ${accentColor} font-bold border ${accentBorder}`
                    : 'text-mist hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                <m.icon size={13} className={isCurrent ? accentColor : 'text-mist'} />
                <span>{m.name}</span>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}

import { Waves, Cpu, Eye, CheckCircle2, ShieldCheck, Database, Layers, Sparkles } from 'lucide-react'

export default function ModelFeatureCards() {
  const models = [
    {
      id: 'sic-model',
      name: 'ConvLSTM SIC Forecaster',
      category: 'Spatiotemporal Environmental Analysis',
      badge: '3-Seed Ensemble',
      status: 'Committed Checkpoint',
      icon: Waves,
      iconColor: 'text-[#22E5F0]',
      glowColor: 'group-hover:border-[#22E5F0]/50 group-hover:shadow-[0_0_30px_rgba(34,229,240,0.2)]',
      accentBg: 'bg-[#22E5F0]/10',
      description:
        'A 3-seed ensemble ConvLSTM trained to forecast Antarctic Sea-Ice Concentration (SIC) up to 167 daily timesteps across a 173 × 369 grid at 0.25° resolution.',
      specs: [
        { label: 'Checkpoints', val: 'seed0, seed1, seed2 (270k params ea.)' },
        { label: 'Coverage', val: '90% nominal conformal intervals (0.910 measured)' },
        { label: 'Skill (MIZ RMSE)', val: '0.69 vs persistence in 2025 & 2026' },
        { label: 'Uncertainty', val: '1σ ensemble spread + MC-dropout' },
      ],
      pathTag: 'backend/runs/final_10ch_3f_seed{0,1,2}/best_model.pt',
    },
    {
      id: 'policy-model',
      name: 'Supervised Route Policy (MLP)',
      category: 'Maritime Navigation Controller',
      badge: 'Frozen Checkpoint',
      status: 'Safety-Authoritative Gate',
      icon: Cpu,
      iconColor: 'text-[#3AA7FF]',
      glowColor: 'group-hover:border-[#3AA7FF]/50 group-hover:shadow-[0_0_30px_rgba(58,167,255,0.2)]',
      accentBg: 'bg-[#3AA7FF]/10',
      description:
        'A 16-feature neural policy network that proposes 8-directional tactical waypoint transitions. Actions are evaluated under an authoritative A* safety controller.',
      specs: [
        { label: 'Architecture', val: 'MLP: 16 → 64 → 32 → 8 (ReLU + Dropout 0.15)' },
        { label: 'State Vector', val: '16 features (SIC, uncertainty, geometry, costs)' },
        { label: 'Safety Authority', val: 'Strict cell gate (SIC < 0.95, NaN impassable)' },
        { label: 'Execution Rule', val: 'Model proposes, A* validation disposes' },
      ],
      pathTag: 'outputs/ml/route_policy.pt',
    },
    {
      id: 'yolo-model',
      name: 'YOLOv8 SAR Iceberg Detector',
      category: 'Operational Risk Assessment',
      badge: 'YOLOv8n Neural Net',
      status: 'SAR Tile Detector',
      icon: Eye,
      iconColor: 'text-[#A9DFFF]',
      glowColor: 'group-hover:border-[#A9DFFF]/50 group-hover:shadow-[0_0_30px_rgba(169,223,255,0.2)]',
      accentBg: 'bg-[#A9DFFF]/10',
      description:
        'Trained YOLOv8-nano detector for identifying icebergs from Sentinel-1 Synthetic Aperture Radar (SAR) tiles, alerting navigators to localized ice hazards.',
      specs: [
        { label: 'Model Size', val: '3,011,043 parameters (YOLOv8-nano)' },
        { label: 'Input Resolution', val: '640 × 640 Sentinel-1 SAR tiles' },
        { label: 'Coordinate Space', val: 'Pixel-space detections (georeference honest)' },
        { label: 'Checkpoint SHA', val: '75e153cb3e37... verified weight' },
      ],
      pathTag: 'models/iceberg/best_sar_iceberg_model.pt',
    },
  ]

  return (
    <section id="features" className="relative py-24 px-5 sm:px-8 bg-[#05182B] overflow-hidden">
      {/* Background ambient lighting */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[500px] w-[800px] -translate-x-1/2 rounded-full bg-gradient-to-b from-[#0A2A4A]/40 via-[#22E5F0]/5 to-transparent blur-3xl" />

      <div className="relative mx-auto max-w-7xl">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#22E5F0]/30 bg-[#22E5F0]/10 px-3.5 py-1 text-xs font-semibold text-[#22E5F0] tracking-wider uppercase">
            <Sparkles size={13} />
            <span>Navigation Intelligence Architecture</span>
          </div>
          <h2 className="mt-4 font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl lg:text-5xl">
            Technical Specifications &amp; Operational Assurance
          </h2>
          <p className="mt-4 text-sm sm:text-base text-mist leading-relaxed">
            Aurora operates on verified scientific algorithms and real NSIDC CDR sea-ice grids. Sea-ice forecasts, geodesic safety controllers, and satellite radar hazard analyses are executed with rigorous operational integrity.
          </p>
        </div>

        {/* 3 Model Cards Grid */}
        <div className="mt-16 grid gap-8 lg:grid-cols-3">
          {models.map((m) => (
            <div
              key={m.id}
              className={`group relative flex flex-col justify-between rounded-2xl border border-white/10 bg-gradient-to-b from-[#071D33]/90 to-[#0A2A4A]/40 p-6 sm:p-8 backdrop-blur-xl transition-all duration-300 ${m.glowColor}`}
            >
              <div>
                {/* Header Row */}
                <div className="flex items-start justify-between gap-3">
                  <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${m.accentBg} ${m.iconColor} border border-white/10 shadow-[0_0_15px_rgba(34,229,240,0.15)]`}>
                    <m.icon size={24} />
                  </div>
                  <span className="inline-flex items-center rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-mono font-medium text-[#A9DFFF]">
                    {m.badge}
                  </span>
                </div>

                {/* Title & Category */}
                <div className="mt-5">
                  <p className="text-[11px] font-mono uppercase tracking-wider text-mist">
                    {m.category}
                  </p>
                  <h3 className="mt-1 font-display text-xl font-bold text-white group-hover:text-[#EAF6FF]">
                    {m.name}
                  </h3>
                </div>

                {/* Description */}
                <p className="mt-3 text-xs sm:text-sm text-mist/90 leading-relaxed">
                  {m.description}
                </p>

                {/* Technical Specs List */}
                <div className="mt-6 space-y-2.5 rounded-xl border border-white/5 bg-[#05182B]/60 p-4">
                  {m.specs.map((s, idx) => (
                    <div key={idx} className="flex flex-col text-xs">
                      <span className="text-[10px] font-mono uppercase tracking-wider text-mist/70">
                        {s.label}
                      </span>
                      <span className="font-mono text-[11px] font-semibold text-[#EAF6FF]">
                        {s.val}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Verified Path Footer */}
              <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between text-[11px] font-mono">
                <span className="text-mist truncate max-w-[210px]">{m.pathTag}</span>
                <span className="inline-flex items-center gap-1 text-emerald-400 font-semibold shrink-0">
                  <ShieldCheck size={13} /> {m.status}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Technical Guarantee Banner */}
        <div className="mt-12 rounded-2xl border border-[#22E5F0]/20 bg-[#0A2A4A]/30 p-5 backdrop-blur-md flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#22E5F0]/15 text-[#22E5F0]">
              <Database size={18} />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white">Verified Scientific Integrity</h4>
              <p className="text-xs text-mist">
                Every calculation originates from verified algorithm checkpoints and real NSIDC CDR sea-ice grids.
              </p>
            </div>
          </div>
          <span className="shrink-0 text-xs font-mono font-semibold text-[#22E5F0] bg-[#22E5F0]/10 border border-[#22E5F0]/30 px-3 py-1.5 rounded-xl">
            Deterministic Evaluation · Frozen Checkpoints
          </span>
        </div>
      </div>
    </section>
  )
}

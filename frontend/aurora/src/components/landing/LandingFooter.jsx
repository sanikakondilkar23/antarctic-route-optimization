import { Link } from 'react-router-dom'
import { Compass, ShieldCheck, ArrowUpRight, Github, ExternalLink } from 'lucide-react'
import Disclaimer from '../ui/Disclaimer'

export default function LandingFooter() {
  const navSections = [
    { label: 'Features', href: '#features' },
    { label: 'How It Works', href: '#workflow' },
    { label: 'Live Demo', href: '#demo' },
    { label: 'About', href: '#about' },
  ]

  const appPages = [
    { label: 'Mission Control', to: '/dashboard' },
    { label: 'Route Planner', to: '/route-planner' },
    { label: 'SIC Forecast', to: '/sic-forecast' },
    { label: 'Iceberg Intelligence', to: '/icebergs' },
    { label: 'Environmental Risk', to: '/risk' },
    { label: 'System Status', to: '/system' },
  ]

  const scrollTo = (e, href) => {
    e.preventDefault()
    const target = document.querySelector(href)
    if (target) target.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <footer className="relative bg-[#05182B] border-t border-white/10 text-white overflow-hidden">
      {/* Soft gradient accent */}
      <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 h-64 w-[1000px] bg-gradient-to-t from-[#071D33] to-transparent opacity-50" />

      <div className="relative mx-auto max-w-7xl px-5 py-16 sm:px-8">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-12 pb-12 border-b border-white/10">
          {/* Brand & Overview */}
          <div className="lg:col-span-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#0A2A4A] to-[#071D33] border border-[#22E5F0]/30 shadow-[0_0_15px_rgba(34,229,240,0.25)]">
                <Compass className="h-5 w-5 text-[#22E5F0]" />
              </div>
              <div>
                <span className="font-display text-lg font-bold tracking-tight text-white">
                  Aurora <span className="text-[#22E5F0] font-normal">Antarctic Routing</span>
                </span>
                <p className="text-[10px] text-mist font-mono">
                  Smart India Hackathon 2026 · Problem 26059
                </p>
              </div>
            </div>

            <p className="text-xs sm:text-sm text-mist max-w-sm leading-relaxed">
              Intelligent trajectory-aware vessel routing platform combining spatiotemporal ConvLSTM
              sea-ice concentration forecasts, YOLOv8 SAR radar iceberg detection, and deterministic
              safety-authoritative A* optimization.
            </p>

            <div className="flex items-center gap-2 pt-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-mono font-medium text-emerald-400">
                <ShieldCheck size={12} />
                <span>Committed AI Artifacts Verified</span>
              </span>
            </div>
          </div>

          {/* Quick Section Navigation */}
          <div className="lg:col-span-3 space-y-3">
            <h4 className="font-display text-xs font-bold uppercase tracking-wider text-white">
              Website Navigation
            </h4>
            <ul className="space-y-2 text-xs">
              {navSections.map((item) => (
                <li key={item.label}>
                  <a
                    href={item.href}
                    onClick={(e) => scrollTo(e, item.href)}
                    className="text-mist hover:text-[#22E5F0] transition flex items-center gap-1.5"
                  >
                    <span>{item.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Core System Pages */}
          <div className="lg:col-span-4 space-y-3">
            <h4 className="font-display text-xs font-bold uppercase tracking-wider text-white">
              System Modules
            </h4>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {appPages.map((page) => (
                <Link
                  key={page.label}
                  to={page.to}
                  className="text-mist hover:text-white transition flex items-center gap-1"
                >
                  <span>{page.label}</span>
                  <ArrowUpRight size={11} className="text-[#22E5F0] opacity-70" />
                </Link>
              ))}
            </div>
          </div>
        </div>

        {/* Disclaimer & Copyright */}
        <div className="pt-8 space-y-4">
          <Disclaimer />
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-[11px] text-mist/60 font-mono">
            <p>
              © {new Date().getFullYear()} Aurora Antarctic Routing · SIH06059 · Research Prototype
            </p>
            <p>
              Protected AI Architecture · Frozen Model Checkpoints · 415 Verification Tests
            </p>
          </div>
        </div>
      </div>
    </footer>
  )
}

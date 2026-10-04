import { useState, useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Compass,
  Menu,
  X,
  ArrowRight,
  ChevronDown,
  Waves,
  Route,
  Eye,
  Activity,
  Layers,
} from 'lucide-react'

export default function LandingNav() {
  const [isScrolled, setIsScrolled] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [modelsDropdownOpen, setModelsDropdownOpen] = useState(false)
  const dropdownRef = useRef(null)
  const location = useLocation()

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 30)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setModelsDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const modelsList = [
    {
      name: 'Sea-Ice Analysis',
      to: '/sic-forecast',
      desc: '167-day spatiotemporal sea-ice forecast & uncertainty spread',
      icon: Waves,
      accent: 'text-[#22E5F0]',
      tag: 'Analysis',
    },
    {
      name: 'Route Optimization',
      to: '/route-planner',
      desc: 'Multi-term geodesic voyage optimization & safety gate',
      icon: Route,
      accent: 'text-[#3AA7FF]',
      tag: 'Navigation',
    },
    {
      name: 'Iceberg Radar Detection',
      to: '/icebergs',
      desc: 'Sentinel-1 radar tile hazard interception & standoff warnings',
      icon: Eye,
      accent: 'text-[#A9DFFF]',
      tag: 'Hazard',
    },
  ]

  const scrollToSection = (e, href) => {
    if (href.startsWith('#')) {
      if (location.pathname !== '/') {
        // If not on home page, let standard anchor / link handle it or navigate home
        return
      }
      e.preventDefault()
      const el = document.querySelector(href)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' })
        setMobileMenuOpen(false)
      }
    }
  }

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        isScrolled
          ? 'bg-[#05182B]/85 backdrop-blur-xl border-b border-[#22E5F0]/20 shadow-[0_8px_30px_rgb(5,24,43,0.7)] py-3'
          : 'bg-[#05182B]/40 backdrop-blur-md border-b border-white/10 py-4'
      }`}
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 sm:px-8">
        {/* Brand identity */}
        <Link
          to="/"
          className="group flex items-center gap-3 transition focus:outline-none focus:ring-2 focus:ring-[#22E5F0]/40 rounded-lg"
        >
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#0A2A4A] to-[#071D33] border border-[#22E5F0]/30 shadow-[0_0_15px_rgba(34,229,240,0.25)] transition group-hover:border-[#22E5F0] group-hover:shadow-[0_0_20px_rgba(34,229,240,0.4)]">
            <Compass className="h-5 w-5 text-[#22E5F0] transition-transform duration-500 group-hover:rotate-45" />
            <div className="absolute inset-0 rounded-xl bg-[#22E5F0]/10 opacity-0 group-hover:opacity-100 transition" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display text-lg font-bold tracking-tight text-white group-hover:text-[#EAF6FF]">
                Aurora <span className="text-[#22E5F0] font-medium">Antarctic Routing</span>
              </span>
              <span className="hidden sm:inline-flex items-center rounded-md border border-[#22E5F0]/30 bg-[#22E5F0]/10 px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider text-[#22E5F0]">
                SIH 26059
              </span>
            </div>
            <p className="text-[10px] text-mist tracking-wider font-mono">
              Autonomous Polar Navigation Engine
            </p>
          </div>
        </Link>

        {/* Desktop Navigation Links */}
        <nav className="hidden md:flex items-center gap-1 lg:gap-2">
          <Link
            to="/#features"
            onClick={(e) => scrollToSection(e, '#features')}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[#EAF6FF]/80 transition hover:text-[#22E5F0] hover:bg-white/5"
          >
            Features
          </Link>
          <Link
            to="/#workflow"
            onClick={(e) => scrollToSection(e, '#workflow')}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[#EAF6FF]/80 transition hover:text-[#22E5F0] hover:bg-white/5"
          >
            How It Works
          </Link>
          <Link
            to="/route-planner"
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[#EAF6FF]/80 transition hover:text-[#22E5F0] hover:bg-white/5 flex items-center gap-1.5"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[#22E5F0] animate-pulse" />
            <span>Live Demo</span>
          </Link>

          {/* Models Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setModelsDropdownOpen(!modelsDropdownOpen)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-[#22E5F0] hover:bg-white/5 transition"
              aria-expanded={modelsDropdownOpen}
            >
              <span>Capabilities</span>
              <ChevronDown
                size={13}
                className={`transition-transform duration-200 ${modelsDropdownOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {modelsDropdownOpen && (
              <div className="absolute top-full left-0 mt-2 w-80 rounded-2xl border border-white/15 bg-[#071D33]/95 backdrop-blur-2xl p-2.5 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-150 z-50">
                <div className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider text-mist border-b border-white/10 mb-1 flex items-center justify-between">
                  <span>Navigation Intelligence</span>
                  <a
                    href="#models"
                    onClick={(e) => {
                      setModelsDropdownOpen(false)
                      scrollToSection(e, '#models')
                    }}
                    className="text-[#22E5F0] hover:underline"
                  >
                    View All
                  </a>
                </div>
                {modelsList.map((m) => (
                  <Link
                    key={m.to}
                    to={m.to}
                    onClick={() => setModelsDropdownOpen(false)}
                    className="flex items-start gap-3 rounded-xl p-2.5 hover:bg-[#0A2A4A] transition group"
                  >
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 border border-white/10 ${m.accent}`}>
                      <m.icon size={16} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-white group-hover:text-[#22E5F0] transition">
                          {m.name}
                        </span>
                        <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-white/10 text-mist">
                          {m.tag}
                        </span>
                      </div>
                      <p className="text-[11px] text-mist/90 leading-snug mt-0.5">{m.desc}</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <Link
            to="/#about"
            onClick={(e) => scrollToSection(e, '#about')}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold text-[#EAF6FF]/80 transition hover:text-[#22E5F0] hover:bg-white/5"
          >
            About
          </Link>
        </nav>

        {/* Right CTA Actions */}
        <div className="hidden sm:flex items-center gap-3">
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/10 transition"
          >
            <Activity size={14} className="text-[#22E5F0]" />
            <span>Mission Control</span>
          </Link>
          <Link
            to="/route-planner"
            className="group relative inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#22E5F0] to-[#3AA7FF] px-4 py-2 text-xs font-bold text-[#05182B] shadow-[0_0_20px_rgba(34,229,240,0.35)] transition-all duration-300 hover:shadow-[0_0_28px_rgba(34,229,240,0.55)] hover:scale-[1.02] active:scale-[0.98]"
          >
            <Route size={14} className="transition-transform group-hover:rotate-12" />
            <span>Plan a Route</span>
            <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        {/* Mobile menu button */}
        <div className="flex md:hidden items-center gap-2">
          <Link
            to="/route-planner"
            className="inline-flex items-center rounded-lg bg-[#22E5F0] px-3 py-1.5 text-[11px] font-bold text-[#05182B]"
          >
            Plan a Route
          </Link>
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="inline-flex items-center justify-center rounded-lg p-2 text-mist hover:bg-white/10 hover:text-white"
            aria-expanded={mobileMenuOpen}
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-white/10 bg-[#071D33]/95 backdrop-blur-2xl px-5 py-5 space-y-4 animate-in fade-in slide-in-from-top-3 duration-200">
          <div className="grid grid-cols-2 gap-2 pb-2 border-b border-white/10">
            <Link
              to="/#features"
              onClick={(e) => scrollToSection(e, '#features')}
              className="rounded-lg px-3 py-2 text-xs font-semibold text-white/90 bg-white/5"
            >
              Features
            </Link>
            <Link
              to="/#workflow"
              onClick={(e) => scrollToSection(e, '#workflow')}
              className="rounded-lg px-3 py-2 text-xs font-semibold text-white/90 bg-white/5"
            >
              How It Works
            </Link>
            <Link
              to="/route-planner"
              onClick={() => setMobileMenuOpen(false)}
              className="rounded-lg px-3 py-2 text-xs font-semibold text-[#22E5F0] bg-[#22E5F0]/10 flex items-center gap-1.5"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#22E5F0] animate-pulse" />
              <span>Live Demo</span>
            </Link>
            <Link
              to="/#about"
              onClick={(e) => scrollToSection(e, '#about')}
              className="rounded-lg px-3 py-2 text-xs font-semibold text-white/90 bg-white/5"
            >
              About
            </Link>
          </div>

          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-mist mb-2">
              AI Engine Layers
            </div>
            <div className="grid gap-1.5">
              {modelsList.map((m) => (
                <Link
                  key={m.to}
                  to={m.to}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-between rounded-xl px-3.5 py-2.5 bg-[#05182B]/60 border border-white/5 hover:border-[#22E5F0]/30 transition"
                >
                  <div className="flex items-center gap-2.5">
                    <m.icon size={16} className={m.accent} />
                    <span className="text-xs font-bold text-white">{m.name}</span>
                  </div>
                  <span className="text-[10px] font-mono text-mist">{m.tag}</span>
                </Link>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-white/10 grid grid-cols-2 gap-2">
            <Link
              to="/dashboard"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-white/15 bg-white/5 py-2.5 text-xs font-semibold text-white"
            >
              <Activity size={14} className="text-[#22E5F0]" />
              <span>Mission Control</span>
            </Link>
            <Link
              to="/route-planner"
              onClick={() => setMobileMenuOpen(false)}
              className="flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#22E5F0] to-[#3AA7FF] py-2.5 text-xs font-bold text-[#05182B]"
            >
              <Route size={14} />
              <span>Plan a Route</span>
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}

import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Waves,
  Snowflake,
  Route,
  Ship,
  ShieldCheck,
  Compass,
  Radar,
  Wind,
  Navigation,
  Activity,
  Layers,
  ChevronRight,
  ExternalLink,
} from 'lucide-react'
import Logo from '../components/ui/Logo'
import Disclaimer from '../components/ui/Disclaimer'

const CORRIDORS = [
  {
    name: 'Cape Town ➔ Bharati Station',
    distance: '5,420 km',
    duration: '11.5 days',
    iceRisk: 'Low–Moderate',
    status: 'Operational',
    statusTone: 'text-safe bg-safe/10 border-safe/20',
  },
  {
    name: 'Cape Town ➔ Maitri Station',
    distance: '4,260 km',
    duration: '9.2 days',
    iceRisk: 'Moderate',
    status: 'Active Transit',
    statusTone: 'text-cyan bg-cyan/10 border-cyan/20',
  },
  {
    name: 'Bharati ↔ Maitri Coastal Link',
    distance: '3,120 km',
    duration: '6.8 days',
    iceRisk: 'Close Pack Advisory',
    status: 'Monitored',
    statusTone: 'text-warn bg-warn/10 border-warn/20',
  },
]

const FLEET_SNAPSHOT = [
  { name: 'RV Bharati Explorer', speed: '13.4 kn', heading: '172°', dest: 'Bharati Station', status: 'En Route', tone: 'safe' },
  { name: 'RV Maitri Voyager', speed: '11.8 kn', heading: '198°', dest: 'Maitri Station', status: 'En Route', tone: 'safe' },
  { name: 'RV Sagar Kanya', speed: '0.0 kn', heading: '045°', dest: 'Cape Town Port', status: 'At Station', tone: 'cyan' },
  { name: 'Polar Pioneer', speed: '8.4 kn', heading: '264°', dest: 'Prydz Bay Sector', status: 'Monitoring', tone: 'warn' },
]

export default function Landing() {
  const [activeTab, setActiveTab] = useState('corridors')

  return (
    <div className="min-h-screen bg-abyssal bg-abyssal-gradient text-white selection:bg-mint/30">
      {/* Sleek Top Navigation */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-abyssal-deck/85 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5 sm:px-8">
          <Logo />
          <nav className="hidden items-center gap-1 md:flex">
            <Link to="/dashboard" className="rounded-lg px-3.5 py-1.5 text-xs font-semibold text-mist hover:text-white">
              Operations Cockpit
            </Link>
            <Link to="/map" className="rounded-lg px-3.5 py-1.5 text-xs font-semibold text-mist hover:text-white">
              Antarctic Map
            </Link>
            <Link to="/route-planner" className="rounded-lg px-3.5 py-1.5 text-xs font-semibold text-mist hover:text-white">
              Route Planner
            </Link>
            <Link to="/icebergs" className="rounded-lg px-3.5 py-1.5 text-xs font-semibold text-mist hover:text-white">
              Iceberg Radar
            </Link>
          </nav>
          <div className="flex items-center gap-2.5">
            <Link to="/login" className="btn-ghost !py-1.5 !text-xs">
              Sign in
            </Link>
            <Link
              to="/dashboard"
              className="inline-flex items-center gap-1.5 rounded-xl border border-mint/40 bg-gradient-to-r from-mint/20 to-azure/20 px-3.5 py-1.5 text-xs font-bold text-mint shadow-glow hover:bg-mint/25 transition"
            >
              Launch Console <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative overflow-hidden px-5 pt-10 pb-12 sm:px-8 lg:pt-14">
        {/* Subtle background ambient glows */}
        <div className="pointer-events-none absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 h-[450px] w-[800px] rounded-full bg-gradient-to-b from-mint/15 via-azure/10 to-transparent blur-3xl" />
        <div className="pointer-events-none absolute right-0 top-1/3 h-72 w-72 rounded-full bg-mint/10 blur-3xl" />

        <div className="relative mx-auto max-w-7xl">
          {/* Header Badge */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-mint/30 bg-mint/10 px-3 py-1 text-[11px] font-semibold tracking-wider uppercase text-mint">
              <span className="h-1.5 w-1.5 rounded-full bg-mint animate-ping" />
              SIH Problem Statement 26059
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-mist">
              <ShieldCheck size={12} className="text-mint" /> Decision Support System
            </span>
          </div>

          <div className="mt-6 grid items-center gap-10 lg:grid-cols-12">
            {/* Left Col: Hero text */}
            <div className="lg:col-span-7">
              <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-5xl sm:leading-[1.15] text-white">
                Autonomous Antarctic{' '}
                <span className="bg-gradient-to-r from-mint via-azure to-ice bg-clip-text text-transparent">
                  Sea-Ice & Navigation
                </span>{' '}
                Intelligence
              </h1>

              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-mist sm:text-base">
                AI-enabled sea-ice concentration forecasting, iceberg trajectory modeling with +48h drift cones, and risk-optimized routing connecting Cape Town to Bharati and Maitri research stations.
              </p>

              {/* Action Buttons */}
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link
                  to="/dashboard"
                  className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-mint to-mint-glow px-5 py-2.5 text-sm font-bold text-abyssal shadow-glow hover:brightness-110 transition"
                >
                  <Compass size={16} /> Launch Operations Deck
                </Link>
                <Link
                  to="/map"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10 hover:border-mint/40 transition"
                >
                  <Layers size={16} className="text-mint" /> Explore Polar Map
                </Link>
                <Link
                  to="/route-planner"
                  className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-abyssal-card px-4 py-2.5 text-sm font-medium text-mist hover:text-mint transition"
                >
                  <Route size={15} /> Plan Corridor
                </Link>
              </div>

              {/* Status Ticker */}
              <div className="mt-8 grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-w-xl">
                <div className="rounded-xl border border-white/5 bg-navy-deep/60 p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-mist">
                    <Ship size={13} className="text-cyan" /> Active Fleet
                  </div>
                  <p className="mt-1 font-display text-lg font-bold text-white">4 Vessels</p>
                  <span className="text-[10px] text-safe">2 En Route · Normal</span>
                </div>

                <div className="rounded-xl border border-white/5 bg-navy-deep/60 p-3">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-mist">
                    <Snowflake size={13} className="text-ice" /> Tracked Bergs
                  </div>
                  <p className="mt-1 font-display text-lg font-bold text-white">128 Total</p>
                  <span className="text-[10px] text-cyan">A-76A & B-15K Cones</span>
                </div>

                <div className="rounded-xl border border-white/5 bg-navy-deep/60 p-3 col-span-2 sm:col-span-1">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-mist">
                    <Wind size={13} className="text-warn" /> Southern Ocean
                  </div>
                  <p className="mt-1 font-display text-lg font-bold text-white">18 Buoy Vectors</p>
                  <span className="text-[10px] text-mist/70">ACC Current 0.8 kn</span>
                </div>
              </div>
            </div>

            {/* Right Col: Interactive Live Operations Console Widget */}
            <div className="lg:col-span-5">
              <div className="rounded-2xl border border-cyan/25 bg-navy-mid/70 p-4 shadow-2xl backdrop-blur-md">
                {/* Console header */}
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-2.5 w-2.5 rounded-full bg-cyan animate-pulse" />
                    <span className="font-display text-xs font-bold uppercase tracking-wider text-white">
                      Mission Control Live Feed
                    </span>
                  </div>
                  <span className="rounded-md border border-cyan/30 bg-cyan/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-cyan">
                    SIMULATED
                  </span>
                </div>

                {/* Tab selector */}
                <div className="mt-3 flex rounded-xl border border-white/5 bg-navy-deep/60 p-1">
                  {[
                    { id: 'corridors', label: 'Corridors' },
                    { id: 'drift', label: 'Iceberg Drift' },
                    { id: 'ocean', label: 'Wind & ACC' },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex-1 rounded-lg py-1.5 text-center text-xs font-semibold transition ${
                        activeTab === tab.id
                          ? 'bg-cyan/20 text-cyan shadow-sm border border-cyan/30'
                          : 'text-mist hover:text-white'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {/* Tab content */}
                <div className="mt-3 min-h-[220px]">
                  {activeTab === 'corridors' && (
                    <div className="space-y-2">
                      {CORRIDORS.map((c) => (
                        <div key={c.name} className="rounded-xl border border-white/5 bg-navy-deep/50 p-3 hover:border-cyan/30 transition">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-white">{c.name}</span>
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${c.statusTone}`}>
                              {c.status}
                            </span>
                          </div>
                          <div className="mt-2 flex items-center justify-between text-[11px] text-mist">
                            <span>Dist: <strong className="text-white">{c.distance}</strong></span>
                            <span>ETA: <strong className="text-white">{c.duration}</strong></span>
                            <span>Ice: <strong className="text-ice-cyan">{c.iceRisk}</strong></span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeTab === 'drift' && (
                    <div className="space-y-2.5 rounded-xl border border-white/5 bg-navy-deep/50 p-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-white">Iceberg A-76A (Tabular)</span>
                        <span className="rounded bg-danger/15 px-2 py-0.5 text-[10px] font-bold text-danger">Priority Track</span>
                      </div>
                      <p className="text-xs text-mist">
                        Dimensions: 135 × 25 km · Draft 220 m · Position: 63°18'S, 56°12'W
                      </p>
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div className="rounded-lg border border-white/5 bg-white/2 p-2">
                          <span className="text-[10px] uppercase text-mist">Drift Vector</span>
                          <p className="font-mono text-xs font-semibold text-cyan">1.8 kn · 038° (NE)</p>
                        </div>
                        <div className="rounded-lg border border-white/5 bg-white/2 p-2">
                          <span className="text-[10px] uppercase text-mist">+48h Forecast</span>
                          <p className="font-mono text-xs font-semibold text-safe">Cone: 12.4 km Buffer</p>
                        </div>
                      </div>
                      <Link to="/icebergs" className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-cyan hover:underline">
                        Open Full Drift Radar <ChevronRight size={13} />
                      </Link>
                    </div>
                  )}

                  {activeTab === 'ocean' && (
                    <div className="space-y-2.5 rounded-xl border border-white/5 bg-navy-deep/50 p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-white">Antarctic Circumpolar Current (ACC)</span>
                        <span className="font-mono text-[11px] text-cyan">0.8 kn ENE</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-white/5 bg-white/2 p-2">
                          <span className="text-[10px] text-mist uppercase">Wind Field (West Wind Drift)</span>
                          <p className="font-mono font-semibold text-warn">28–34 kn (Beaufort 7)</p>
                        </div>
                        <div className="rounded-lg border border-white/5 bg-white/2 p-2">
                          <span className="text-[10px] text-mist uppercase">Significant Wave Height</span>
                          <p className="font-mono font-semibold text-white">3.8 m (Rough)</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-mist pt-1">
                        <span>Sea-Ice Marginal Edge: <strong>60°12'S</strong></span>
                        <span className="text-safe">No Pack Entrapment Hazard</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Direct launch link */}
                <div className="mt-3 border-t border-white/5 pt-3">
                  <Link
                    to="/route-planner"
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan/15 py-2 text-xs font-bold text-cyan hover:bg-cyan/25 transition"
                  >
                    Compare Corridor Routes <ArrowRight size={13} />
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3 Core System Pillars (Compact Grid) */}
      <section className="border-t border-white/10 bg-navy-deep/40 py-10 px-5 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-5 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-navy-mid/40 p-5 hover:border-cyan/30 transition">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan/15 text-cyan">
                <Route size={20} />
              </div>
              <h3 className="mt-3 font-display text-base font-bold text-white">Multi-Corridor Route Engine</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-mist">
                Automated trade-off evaluation comparing Shortest, Low-Ice, and Fuel-Efficient tracks between Cape Town, Bharati, and Maitri with instant GeoJSON ECDIS export.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-navy-mid/40 p-5 hover:border-cyan/30 transition">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan/15 text-cyan">
                <Wind size={20} />
              </div>
              <h3 className="mt-3 font-display text-base font-bold text-white">Ocean & Drift Hydrodynamics</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-mist">
                18 Southern Ocean wind barbs and 13 circulation streamlines driving +24h/+48h iceberg drift forecasts and sea-ice concentration tracking.
              </p>
            </div>

            <div className="rounded-2xl border border-white/10 bg-navy-mid/40 p-5 hover:border-cyan/30 transition">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan/15 text-cyan">
                <Radar size={20} />
              </div>
              <h3 className="mt-3 font-display text-base font-bold text-white">Interactive Alert Center</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-mist">
                Actionable hazard lifecycle (Acknowledge, Resolve, Reopen) with instant collision warnings, icebreaker escort advisories, and alert simulation.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Fleet Live Strip (Compact) */}
      <section className="border-t border-white/5 py-8 px-5 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Ship size={17} className="text-cyan" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-white">Monitored Antarctic Fleet</h2>
            </div>
            <Link to="/fleet" className="inline-flex items-center gap-1 text-xs font-semibold text-cyan hover:underline">
              View Fleet Details <ChevronRight size={13} />
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FLEET_SNAPSHOT.map((v) => (
              <div key={v.name} className="rounded-xl border border-white/5 bg-navy-deep/60 p-3.5 hover:border-cyan/20 transition">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-white">{v.name}</span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    v.tone === 'safe' ? 'text-safe bg-safe/10' : v.tone === 'cyan' ? 'text-cyan bg-cyan/10' : 'text-warn bg-warn/10'
                  }`}>
                    {v.status}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-mist">
                  <span>Speed: <strong className="text-white">{v.speed}</strong></span>
                  <span>Head: <strong className="text-white">{v.heading}</strong></span>
                </div>
                <div className="mt-1 text-[10px] text-mist/70 truncate">
                  Dest: {v.dest}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Streamlined Quick-Access & Footer */}
      <footer className="border-t border-white/10 bg-navy-deep/80 px-5 py-8 sm:px-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Logo />
            <div className="flex flex-wrap items-center gap-3 text-xs text-mist">
              <span>Demo credentials: <strong className="text-white">admin@naviglace.ai</strong> / <strong className="text-white">admin123</strong></span>
              <Link to="/login" className="btn-secondary !py-1 !px-3 !text-xs">
                1-Click Login
              </Link>
              <Link to="/dashboard" className="btn-primary !py-1 !px-3 !text-xs">
                Open Dashboard
              </Link>
            </div>
          </div>

          <div className="border-t border-white/5 pt-4">
            <Disclaimer />
            <p className="mt-3 text-center text-[11px] text-mist/50">
              © {new Date().getFullYear()} NAVIGLACE AI. Developed for Smart India Hackathon (SIH 26059). Prototype decision support system with simulated demonstration data.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Map,
  Snowflake,
  Waves,
  Route,
  ShieldAlert,
  Database,
  X,
  Compass,
} from 'lucide-react'
import Logo from '../ui/Logo'
import { cn } from '../../lib/utils'
import { fetchHealth, fetchMetadata } from '../../lib/auroraApi'

export const NAV_SECTIONS = [
  {
    category: '01 OPERATIONS',
    items: [
      { to: '/dashboard', label: 'Mission Control', icon: LayoutDashboard },
      { to: '/route-planner', label: 'Route Planner', icon: Route },
    ],
  },
  {
    category: '02 ENVIRONMENT',
    items: [
      { to: '/sea-ice', label: 'SIC Forecast', icon: Waves },
      { to: '/icebergs', label: 'Iceberg Intelligence', icon: Snowflake },
      { to: '/risk', label: 'Environmental Risk', icon: ShieldAlert },
    ],
  },
  {
    category: '03 SYSTEM',
    items: [{ to: '/system-status', label: 'System', icon: Database }],
  },
]

/** Real, verified endpoint facts - never a simulated status. */
function BackendPulse() {
  const [state, setState] = useState({ phase: 'loading' })

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [health, meta] = await Promise.all([fetchHealth(), fetchMetadata()])
        if (cancelled) return
        setState({
          phase: 'ready',
          sic: health?.sic_artifact ? 'forecast artifact present' : 'forecast artifact MISSING',
          days: meta?.n_timesteps ?? null,
          grid: meta ? `${meta.n_rows}×${meta.n_cols}` : null,
        })
      } catch (err) {
        if (cancelled) return
        setState({ phase: 'offline', message: err?.message ?? 'backend unreachable' })
      }
    }
    load()
    const id = setInterval(load, 30000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  if (state.phase === 'loading') {
    return <p className="font-mono text-[10px] text-mist">checking backend…</p>
  }

  if (state.phase === 'offline') {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[11px]">
          <span className="font-bold text-white">AURORA backend</span>
          <span className="font-mono text-[10px] font-bold text-danger">OFFLINE</span>
        </div>
        <p className="font-mono text-[10px] leading-snug text-mist">{state.message}</p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-bold text-white">AURORA backend</span>
        <span className="font-mono text-[10px] font-bold text-safe">ONLINE</span>
      </div>
      <div className="flex items-center justify-between font-mono text-[10px] text-mist">
        <span>SIC artifact</span>
        <span className={state.sic?.startsWith('forecast artifact present') ? 'text-safe' : 'text-warn'}>
          {state.sic}
        </span>
      </div>
      {state.days && (
        <div className="flex items-center justify-between font-mono text-[10px] text-mist">
          <span>Forecast window</span>
          <span className="text-white/85">
            {state.days} days · {state.grid}
          </span>
        </div>
      )}
    </div>
  )
}

export default function Sidebar({ open, onClose }) {
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-30 bg-abyssal/80 backdrop-blur-md lg:hidden" onClick={onClose} />
      )}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-white/10 bg-abyssal-deck/95 backdrop-blur-2xl transition-transform duration-200 lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Brand header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <Logo />
          <button className="rounded-lg p-1.5 text-mist hover:bg-white/5 lg:hidden" onClick={onClose} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        {/* Verified route endpoints */}
        <div className="border-b border-white/10 p-3 bg-abyssal/40">
          <div className="rounded-xl border border-white/10 bg-abyssal-card/70 p-2.5 text-xs">
            <div className="flex items-center justify-between text-[11px] font-semibold text-mist">
              <span className="inline-flex items-center gap-1.5">
                <Compass size={13} className="text-azure" /> ROUTE ENDPOINTS
              </span>
              <span className="font-mono text-[10px] text-azure">VERIFIED</span>
            </div>
            <div className="mt-2 space-y-1 font-mono text-[11px]">
              <div className="flex items-center justify-between text-white/90">
                <span>Cape Town</span>
                <span className="text-mist text-[10px]">33.92°S, 18.42°E</span>
              </div>
              <div className="flex items-center justify-between text-white/90">
                <span>Bharati approach</span>
                <span className="text-mist text-[10px]">69.00°S, 76.25°E</span>
              </div>
              <div className="flex items-center justify-between text-white/90">
                <span>Maitri approach</span>
                <span className="text-mist text-[10px]">70.00°S, 10.50°E</span>
              </div>
            </div>
          </div>
        </div>

        {/* Segmented Navigation Menu */}
        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4 scrollbar-thin">
          {NAV_SECTIONS.map((section) => (
            <div key={section.category} className="space-y-1">
              <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-mist/60">
                {section.category}
              </p>
              {section.items.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={onClose}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition',
                      isActive
                        ? 'bg-azure/10 text-ice font-bold border border-azure/30'
                        : 'text-mist hover:bg-white/5 hover:text-white'
                    )
                  }
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Icon size={16} className="shrink-0 transition group-hover:text-azure" />
                    <span className="truncate">{label}</span>
                  </div>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Live backend status dock */}
        <div className="border-t border-white/10 p-3.5 bg-abyssal/60">
          <div className="rounded-xl border border-white/10 bg-abyssal-card/90 p-3">
            <BackendPulse />
          </div>
        </div>
      </aside>
    </>
  )
}

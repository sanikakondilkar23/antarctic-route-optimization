import { useEffect, useState } from 'react'
import { NavLink, Outlet, Link } from 'react-router-dom'
import {
  Map as MapIcon,
  Route,
  Waves,
  Snowflake,
  Gauge,
  Server,
  Compass,
} from 'lucide-react'
import Logo from '../ui/Logo'
import { cn } from '../../lib/utils'
import { fetchHealth } from '../../lib/auroraApi'
import { useUtcClock } from '../../lib/hooks'

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Mission Control', icon: MapIcon },
  { to: '/route-planner', label: 'Route Planner', icon: Route },
  { to: '/sic-forecast', label: 'SIC Forecast', icon: Waves },
  { to: '/icebergs', label: 'Iceberg Intelligence', icon: Snowflake },
  { to: '/risk', label: 'Environmental Risk', icon: Gauge },
  { to: '/system', label: 'System', icon: Server },
  { to: '/', label: 'Overview', icon: Compass },
]

/** Live backend reachability. Never reported optimistically. */
function BackendStatus() {
  const [state, setState] = useState({ phase: 'loading' })

  useEffect(() => {
    let cancelled = false
    const probe = () =>
      fetchHealth()
        .then((h) => !cancelled && setState({ phase: 'up', health: h }))
        .catch((err) => !cancelled && setState({ phase: 'down', message: err?.message }))
    probe()
    const id = setInterval(probe, 30000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const up = state.phase === 'up'
  const artifact = state.health?.sic_artifact

  return (
    <div className="flex items-center gap-3">
      <span className="inline-flex items-center gap-1.5" title={state.message ?? 'GET /api/health'}>
        <span
          className={cn(
            'h-[7px] w-[7px] rounded-full',
            state.phase === 'loading' ? 'bg-steel' : up ? 'bg-safe' : 'bg-danger'
          )}
        />
        <span className="mono-label text-mist">
          {state.phase === 'loading' ? 'PROBING' : up ? 'BACKEND ONLINE' : 'BACKEND OFFLINE'}
        </span>
      </span>
      {up && (
        <span className="mono-label hidden md:inline">
          SIC ARTIFACT {artifact ? 'PRESENT' : 'MISSING'}
        </span>
      )}
    </div>
  )
}

function Clock() {
  const now = useUtcClock()
  return <span className="num text-[12px] text-mist">{now.toISOString().slice(11, 19)} UTC</span>
}

export default function AppShell() {
  return (
    <div className="flex h-screen min-h-[520px] flex-col overflow-hidden bg-[#05182B] text-[#EAF6FF]">
      <header className="shrink-0 border-b border-white/10 bg-[#071D33]/90 backdrop-blur-xl shadow-md">
        {/* Brand + status */}
        <div className="flex items-center justify-between gap-4 px-4 py-2.5">
          <Link to="/" className="min-w-0 shrink-0" aria-label="AURORA home">
            <Logo />
          </Link>
          <div className="flex items-center gap-4">
            <div className="hidden items-center gap-4 border-l border-white/10 pl-4 lg:flex">
              <BackendStatus />
              <span className="mono-label hidden xl:inline text-[#A9DFFF]/70">PROTOTYPE · NOT FOR NAVIGATION</span>
            </div>
            <Clock />
          </div>
        </div>

        {/* Primary navigation */}
        <nav className="scrollbar-thin flex items-center gap-1 overflow-x-auto border-t border-white/5 px-3 py-1 bg-[#05182B]/50">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-200 flex items-center gap-2 whitespace-nowrap',
                  isActive
                    ? 'bg-[#22E5F0]/15 text-[#22E5F0] border border-[#22E5F0]/30 shadow-[0_0_12px_rgba(34,229,240,0.2)]'
                    : 'text-mist hover:text-white hover:bg-white/5'
                )
              }
            >
              <Icon size={14} className="shrink-0" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="relative min-h-0 flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}

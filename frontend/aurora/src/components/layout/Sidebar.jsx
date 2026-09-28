import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Ship,
  Map,
  Snowflake,
  Waves,
  Route,
  ShieldAlert,
  Database,
  Settings,
  X,
  Radio,
  Compass,
  Anchor,
  Wind,
} from 'lucide-react'
import Logo from '../ui/Logo'
import { cn } from '../../lib/utils'

export const NAV_SECTIONS = [
  {
    category: '01 EXPEDITION OPERATIONS',
    items: [
      { to: '/dashboard', label: 'Operations Cockpit', icon: LayoutDashboard },
      { to: '/map', label: 'Antarctic Map Explorer', icon: Map, badge: 'TACTICAL' },
      { to: '/route-planner', label: 'Corridor Route Planner', icon: Route, badge: '3 PATHS' },
    ],
  },
  {
    category: '02 TACTICAL SENSORS',
    items: [
      { to: '/icebergs', label: 'Iceberg Radar & Drift', icon: Snowflake, count: '128' },
      { to: '/sea-ice', label: 'Sea-Ice Forecasting', icon: Waves, badge: '7-DAY' },
    ],
  },
  {
    category: '03 FLEET & HAZARDS',
    items: [
      { to: '/fleet', label: 'Research Fleet', icon: Ship, count: '4' },
      { to: '/alerts', label: 'Hazard & Risk Alerts', icon: ShieldAlert, count: '3!', alert: true },
    ],
  },
  {
    category: '04 SYSTEM PROTOCOLS',
    items: [
      { to: '/data-sources', label: 'Sensor Feeds & Data', icon: Database },
      { to: '/settings', label: 'Bridge Settings', icon: Settings },
    ],
  },
]

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

        {/* Station Navigation Quick-Context */}
        <div className="border-b border-white/10 p-3 bg-abyssal/40">
          <div className="rounded-xl border border-white/10 bg-abyssal-card/70 p-2.5 text-xs">
            <div className="flex items-center justify-between text-[11px] font-semibold text-mist">
              <span className="inline-flex items-center gap-1.5"><Compass size={13} className="text-mint" /> PRIMARY TARGETS</span>
              <span className="font-mono text-[10px] text-mint">SIMULATED</span>
            </div>
            <div className="mt-2 space-y-1 font-mono text-[11px]">
              <div className="flex items-center justify-between text-white/90">
                <span>Bharati Station</span>
                <span className="text-mist text-[10px]">69°24'S, 76°11'E</span>
              </div>
              <div className="flex items-center justify-between text-white/90">
                <span>Maitri Station</span>
                <span className="text-mist text-[10px]">70°46'S, 11°44'E</span>
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
              {section.items.map(({ to, label, icon: Icon, badge, count, alert }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={onClose}
                  className={({ isActive }) =>
                    cn(
                      'group flex items-center justify-between rounded-xl px-3 py-2 text-xs font-medium transition',
                      isActive
                        ? 'bg-gradient-to-r from-mint/15 to-mint/5 text-mint font-bold border border-mint/30 shadow-sm'
                        : 'text-mist hover:bg-white/5 hover:text-white'
                    )
                  }
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Icon size={16} className="shrink-0 transition group-hover:text-mint" />
                    <span className="truncate">{label}</span>
                  </div>

                  {count && (
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold',
                        alert ? 'bg-danger/20 text-danger border border-danger/30 animate-pulse' : 'bg-white/5 text-mist'
                      )}
                    >
                      {count}
                    </span>
                  )}

                  {badge && (
                    <span className="rounded border border-mint/25 bg-mint/10 px-1.5 py-0.2 text-[9px] font-bold uppercase tracking-wider text-mint">
                      {badge}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {/* Flagship Vessel Status Dock */}
        <div className="border-t border-white/10 p-3.5 bg-abyssal/60">
          <div className="rounded-xl border border-white/10 bg-abyssal-card/90 p-3">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute h-full w-full animate-ping rounded-full bg-mint opacity-75" />
                  <span className="relative h-2 w-2 rounded-full bg-mint" />
                </span>
                <span className="font-bold text-white">RV Bharati Explorer</span>
              </div>
              <span className="font-mono text-[11px] text-mint">13.4 kn</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[10px] text-mist">
              <span>Heading: 172° (SSE)</span>
              <span>Ice Risk: Low</span>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
import { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Boxes,
  Compass,
  Info,
  LogOut,
  Map as MapIcon,
  PanelLeftClose,
  PanelLeftOpen,
  Route,
  ShieldAlert,
  Ship,
  Snowflake,
  Waves,
  Wind,
} from 'lucide-react'
import Logo from '../ui/Logo'
import { cn } from '../../lib/utils'
import { fetchHealth, fetchMetadata } from '../../lib/auroraApi'
import { useAuth } from '../../context/AuthContext'

/**
 * The AURORA console navigation.
 *
 * Ten product routes, exactly as the platform defines them. Every entry is a
 * real route that renders a real page - there are no placeholders here.
 * Sea-Ice and Icebergs are separate intelligence modules: neither links to
 * the other, and neither is presented as an input to the other.
 */
export const NAV_SECTIONS = [
  {
    category: 'OPERATIONS',
    items: [
      { to: '/overview', label: 'Overview', icon: Compass },
      { to: '/navigation', label: 'Navigation', icon: MapIcon },
      { to: '/routes', label: 'Routes', icon: Route },
      { to: '/ship-details', label: 'Ship Details', icon: Ship },
      { to: '/risk', label: 'Risk Analytics', icon: ShieldAlert },
    ],
  },
  {
    category: 'INTELLIGENCE',
    items: [
      { to: '/environment', label: 'Environment', icon: Wind },
      { to: '/sea-ice', label: 'Sea-Ice', icon: Waves },
      { to: '/icebergs', label: 'Icebergs', icon: Snowflake },
      { to: '/models', label: 'Models', icon: Boxes },
    ],
  },
  {
    category: 'PROJECT',
    items: [{ to: '/about', label: 'About', icon: Info }],
  },
]

/** Live backend reachability. Never reported optimistically. */
function BackendPulse({ collapsed }) {
  const [state, setState] = useState({ phase: 'loading' })

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [health, meta] = await Promise.all([fetchHealth(), fetchMetadata()])
        if (cancelled) return
        setState({
          phase: 'ready',
          sic: health?.sic_artifact,
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

  if (collapsed) {
    return (
      <div
        className="flex items-center justify-center py-2"
        title={state.phase === 'offline' ? `backend offline — ${state.message}` : 'backend online'}
      >
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            state.phase === 'loading' ? 'bg-steel' : state.phase === 'ready' ? 'bg-safe' : 'bg-danger'
          )}
        />
      </div>
    )
  }

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
        <span className={state.sic ? 'text-safe' : 'text-warn'}>{state.sic ? 'present' : 'missing'}</span>
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

/** Profile block shown at the foot of the sidebar. */
function Profile({ user, onLogout, collapsed }) {
  if (collapsed) {
    return (
      <div
        title={`${user?.name ?? 'Operator'} · ${user?.email ?? 'no session'}`}
        className="flex h-9 w-9 items-center justify-center border border-graphite-600 bg-graphite-800 text-[11px] font-bold text-ice"
      >
        {(user?.name ?? 'AU')
          .split(' ')
          .map((w) => w[0])
          .slice(0, 2)
          .join('')}
      </div>
    )
  }

  return (
    <div className="border border-graphite-600 bg-graphite-800">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center border border-graphite-500 bg-graphite-950 text-[11px] font-bold text-ice">
          {(user?.name ?? 'AU')
            .split(' ')
            .map((w) => w[0])
            .slice(0, 2)
            .join('')}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold leading-tight text-white">
            {user?.name ?? 'Operator'}
          </p>
          <p className="truncate text-[10.5px] text-mist" title={user?.email}>
            {user?.email ?? 'no session'}
          </p>
        </div>
      </div>
      <div className="border-t border-graphite-700 px-3 py-1.5">
        <p className="truncate text-[10px] uppercase tracking-[0.12em] text-steel">
          {user?.role ?? 'Demo session'} · {user?.organization ?? 'AURORA'}
        </p>
      </div>
    </div>
  )
}

export default function Sidebar({ open, onClose, collapsed, onToggleCollapse }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const slim = Boolean(collapsed)

  const signOut = () => {
    logout()
    onClose?.()
    navigate('/login', { replace: true })
  }

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-30 bg-graphite-950/85 backdrop-blur-sm lg:hidden" onClick={onClose} />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex flex-col border-r border-graphite-600 bg-graphite-900 transition-[width,transform] duration-200',
          'lg:translate-x-0',
          slim ? 'w-[76px]' : 'w-72',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Brand header ------------------------------------------------ */}
        <div
          className={cn(
            'flex items-center border-b border-graphite-600',
            slim ? 'justify-center px-2 py-3.5' : 'justify-between px-5 py-3.5'
          )}
        >
          {slim ? (
            <NavLink to="/overview" title="AURORA" className="flex h-9 w-9 items-center justify-center border border-graphite-500 bg-graphite-800">
              <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
                <path
                  d="M12 2.5c3.6 2.4 5.6 5.8 5.6 9.5S15.6 19.1 12 21.5c-3.6-2.4-5.6-5.8-5.6-9.5S8.4 4.9 12 2.5Z"
                  fill="none"
                  stroke="#A8CFE6"
                  strokeWidth="1.2"
                />
                <path d="M2.5 12h19" stroke="#7FB4D4" strokeWidth="1.1" />
                <circle cx="12" cy="12" r="1.7" fill="#E9ECEF" />
              </svg>
            </NavLink>
          ) : (
            <Logo />
          )}

          {!slim && (
            <button
              className="rounded border border-graphite-600 bg-graphite-850 p-1.5 text-mist transition hover:border-ice/40 hover:text-ice"
              onClick={onToggleCollapse}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <PanelLeftClose size={16} />
            </button>
          )}
        </div>

        {!slim && (
          <div className="border-b border-graphite-600 bg-graphite-950/50 px-4 py-3">
            <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-steel">
              Antarctic Unified Routing &amp; Operational Risk Analytics
            </p>
          </div>
        )}

        {/* Navigation --------------------------------------------------- */}
        <nav className="scrollbar-thin flex-1 overflow-y-auto px-2.5 py-3">
          {slim && (
            <button
              className="mb-2 flex w-full items-center justify-center border border-graphite-600 bg-graphite-850 py-1.5 text-mist transition hover:border-ice/40 hover:text-ice"
              onClick={onToggleCollapse}
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              <PanelLeftOpen size={16} />
            </button>
          )}

          <div className={cn('space-y-4', slim && 'space-y-2')}>
            {NAV_SECTIONS.map((section) => (
              <div key={section.category} className="space-y-0.5">
                {!slim && (
                  <p className="px-2.5 pb-1 text-[9.5px] font-bold uppercase tracking-[0.2em] text-steel">
                    {section.category}
                  </p>
                )}
                {section.items.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={onClose}
                    title={slim ? label : undefined}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex items-center rounded border transition',
                        slim ? 'justify-center px-0 py-2.5' : 'gap-2.5 px-2.5 py-2',
                        isActive
                          ? 'border-ice/35 bg-ice/[0.08] text-white'
                          : 'border-transparent text-mist hover:border-graphite-600 hover:bg-graphite-850 hover:text-white'
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={cn(
                            'absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r bg-ice transition',
                            isActive ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        <Icon
                          size={16}
                          className={cn('shrink-0 transition', isActive ? 'text-ice' : 'group-hover:text-ice')}
                        />
                        {!slim && <span className="truncate text-[12.5px] font-medium">{label}</span>}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            ))}
          </div>

          {/* Session ------------------------------------------------- */}
          <div className={cn('mt-5 space-y-1.5 border-t border-graphite-600 pt-3', slim && 'mt-3')}>
            {!slim && (
              <p className="px-2.5 pb-1 text-[9.5px] font-bold uppercase tracking-[0.2em] text-steel">SESSION</p>
            )}
            {!slim && <Profile user={user} onLogout={signOut} />}
            <button
              onClick={signOut}
              title={slim ? 'Logout' : undefined}
              className={cn(
                'group flex w-full items-center rounded border border-transparent text-mist transition',
                'hover:border-danger/35 hover:bg-danger/[0.08] hover:text-danger',
                slim ? 'justify-center px-0 py-2.5' : 'gap-2.5 px-2.5 py-2'
              )}
            >
              <LogOut size={16} className="shrink-0 transition group-hover:text-danger" />
              {!slim && <span className="truncate text-[12.5px] font-medium">Logout</span>}
            </button>
            {slim && (
              <div className="flex justify-center pt-1">
                <Profile user={user} onLogout={signOut} collapsed />
              </div>
            )}
          </div>
        </nav>

        {/* Live backend status ----------------------------------------- */}
        {!slim && (
          <div className="border-t border-graphite-600 bg-graphite-950/60 p-3">
            <div className="border border-graphite-600 bg-graphite-850 px-3 py-2.5">
              <BackendPulse />
              <p className="mt-2 flex items-center gap-1.5 border-t border-graphite-700 pt-2 font-mono text-[9.5px] uppercase tracking-[0.1em] text-steel">
                <Info size={11} className="text-warn" /> prototype · not for navigation
              </p>
            </div>
          </div>
        )}
        {slim && (
          <div className="border-t border-graphite-600 bg-graphite-950/60 px-2 py-2">
            <BackendPulse collapsed />
          </div>
        )}
      </aside>
    </>
  )
}

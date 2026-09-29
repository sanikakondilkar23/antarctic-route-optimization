import { useState, useRef, useEffect, useMemo } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Activity, Boxes, ChevronDown, Info, LogOut, Menu, Moon, Settings, Sun } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { fetchHealth } from '../../lib/auroraApi'
import { NAV_SECTIONS } from './Sidebar'
import { cn } from '../../lib/utils'

export default function TopNav({ onMenu }) {
  const { user, logout } = useAuth()
  const { dark, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const [profileOpen, setProfileOpen] = useState(false)
  const [utc, setUtc] = useState('')
  const [health, setHealth] = useState(null)
  const profileRef = useRef(null)

  useEffect(() => {
    const tick = () => setUtc(new Date().toISOString().substring(11, 19) + ' UTC')
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    const check = () =>
      fetchHealth()
        .then((h) => {
          if (!cancelled) setHealth(h)
        })
        .catch(() => {
          if (!cancelled) setHealth(null)
        })
    check()
    const id = setInterval(check, 60000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  useEffect(() => {
    const onClick = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const moduleLabel = useMemo(() => {
    for (const s of NAV_SECTIONS) {
      const hit = s.items.find((i) => location.pathname.startsWith(i.to))
      if (hit) return hit.label
    }
    return 'AURORA'
  }, [location.pathname])

  const online = health?.status === 'ok'

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-white/10 bg-abyssal-deck/90 px-4 backdrop-blur-2xl md:px-6">
      <button className="rounded-lg p-2 text-mist hover:bg-white/5 lg:hidden" onClick={onMenu} aria-label="Open menu">
        <Menu size={20} />
      </button>

      <div className="flex items-center gap-2">
        <span className="text-xs font-bold uppercase tracking-[0.2em] text-mist">AURORA</span>
        <span className="text-white/20">/</span>
        <span className="text-xs font-semibold text-white/85">{moduleLabel}</span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {/* backend liveness - real /api/health response */}
        <span
          className={cn(
            'hidden items-center gap-1.5 rounded-xl border px-3 py-1.5 font-mono text-[11px] sm:inline-flex',
            online ? 'border-safe/30 bg-safe/10 text-safe' : 'border-danger/30 bg-danger/10 text-danger',
          )}
          title={online ? 'GET /api/health returned status ok' : 'GET /api/health did not respond'}
        >
          <Activity size={13} />
          {online ? 'backend online' : 'backend offline'}
        </span>

        <span
          className="hidden rounded-xl border border-warn/30 bg-warn/10 px-3 py-1.5 font-mono text-[11px] text-warn xl:inline-flex"
          title="AURORA is a research prototype. Not for navigation."
        >
          PROTOTYPE · NOT FOR NAVIGATION
        </span>

        <div className="hidden rounded-xl border border-white/10 bg-abyssal/60 px-3 py-1 font-mono text-[11px] text-mist sm:block">
          <span className="font-bold text-white/90">{utc}</span>
        </div>

        <button
          onClick={toggleTheme}
          className="rounded-xl border border-white/10 bg-abyssal/60 p-2 text-mist transition hover:border-ice/30 hover:text-ice"
          aria-label="Toggle theme"
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setProfileOpen((o) => !o)}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-abyssal/60 py-1.5 pl-1.5 pr-2.5 transition hover:border-ice/40"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-ice text-xs font-bold text-abyssal">
              {user?.name
                ? user.name
                    .split(' ')
                    .map((w) => w[0])
                    .slice(0, 2)
                    .join('')
                : 'AU'}
            </div>
            <div className="hidden text-left sm:block">
              <p className="text-xs font-semibold leading-tight text-white">{user?.name ?? 'Demo operator'}</p>
            </div>
            <ChevronDown size={13} className="text-mist" />
          </button>
          {profileOpen && (
            <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-white/10 bg-abyssal-card p-2 shadow-2xl backdrop-blur-2xl">
              <div className="border-b border-white/10 px-3 py-2.5">
                <p className="truncate text-xs font-bold text-white">{user?.name}</p>
                <p className="truncate text-[10px] text-mist">{user?.email}</p>
                <p className="truncate text-[10px] text-mist/70">
                  local demo session · no server-side account
                </p>
              </div>
              <Link
                to="/models"
                className="flex items-center gap-2 px-3 py-2 text-xs text-mist hover:bg-white/5 hover:text-white"
                onClick={() => setProfileOpen(false)}
              >
                <Boxes size={14} /> Models
              </Link>
              <Link
                to="/about"
                className="flex items-center gap-2 px-3 py-2 text-xs text-mist hover:bg-white/5 hover:text-white"
                onClick={() => setProfileOpen(false)}
              >
                <Info size={14} /> About AURORA
              </Link>
              <Link
                to="/settings"
                className="flex items-center gap-2 px-3 py-2 text-xs text-mist hover:bg-white/5 hover:text-white"
                onClick={() => setProfileOpen(false)}
              >
                <Settings size={14} /> Settings
              </Link>
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-xs text-danger hover:bg-danger/10"
                onClick={() => {
                  logout()
                  navigate('/login', { replace: true })
                }}
              >
                <LogOut size={14} /> Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

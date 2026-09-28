import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Search,
  Bell,
  Sun,
  Moon,
  Menu,
  ChevronDown,
  LogOut,
  User,
  ShieldCheck,
  Compass,
  Clock,
  Wind,
  Thermometer,
  Radio,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useTheme } from '../../context/ThemeContext'
import { cn } from '../../lib/utils'

export default function TopNav({ onMenu }) {
  const { user, logout } = useAuth()
  const { dark, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [profileOpen, setProfileOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [time, setTime] = useState({ utc: '', station: '' })
  const profileRef = useRef(null)
  const notifRef = useRef(null)

  useEffect(() => {
    const updateTime = () => {
      const now = new Date()
      setTime({
        utc: now.toISOString().substring(11, 19) + ' UTC',
        station: new Date(now.getTime() + 5 * 3600000).toISOString().substring(11, 19) + ' LARSEMANN (UTC+5)',
      })
    }
    updateTime()
    const timer = setInterval(updateTime, 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const onClick = (e) => {
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false)
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const notifications = [
    { id: 1, title: 'Iceberg near planned route', time: '18 min', tone: 'danger', unread: true },
    { id: 2, title: 'Sea-ice concentration rising', time: '41 min', tone: 'warn', unread: true },
    { id: 3, title: 'West Wind Drift gust advisory', time: '2 h', tone: 'mint', unread: false },
  ]

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-white/10 bg-abyssal-deck/90 px-4 backdrop-blur-2xl md:px-6">
      <button className="rounded-lg p-2 text-mist hover:bg-white/5 lg:hidden" onClick={onMenu} aria-label="Open menu">
        <Menu size={20} />
      </button>

      {/* Command Search with Keyboard Shortcut Indicator */}
      <div className="relative hidden max-w-xs flex-1 lg:block">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist/60" />
        <input
          placeholder="Command search (vessels, bergs, routes)…"
          className="w-full rounded-xl border border-white/10 bg-abyssal/70 py-1.5 pl-9 pr-12 text-xs text-white placeholder-mist/40 outline-none transition focus:border-mint/50 focus:ring-1 focus:ring-mint/20"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-mist/60">
          ⌘K
        </kbd>
      </div>

      {/* Bridge Telemetry Strip: SST, Pressure & Sea State */}
      <div className="hidden items-center gap-4 text-[11px] font-mono xl:flex border-l border-white/10 pl-4 text-mist">
        <span className="inline-flex items-center gap-1 text-white/90">
          <Thermometer size={13} className="text-azure" />
          <span>SST: </span>
          <strong className="text-white">-1.8°C</strong>
        </span>
        <span className="inline-flex items-center gap-1 text-white/90">
          <Wind size={13} className="text-warn" />
          <span>Wind: </span>
          <strong className="text-white">32 kn (Bft 7)</strong>
        </span>
        <span className="inline-flex items-center gap-1 text-mint">
          <Radio size={13} className="animate-pulse" />
          <span>ACC Current: 0.8 kn</span>
        </span>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {/* Dual Station & UTC Polar Clocks */}
        <div className="hidden rounded-xl border border-white/10 bg-abyssal/60 px-3 py-1 font-mono text-[11px] text-mist sm:block">
          <span className="font-bold text-mint">{time.utc}</span>
          <span className="mx-2 text-white/20">|</span>
          <span className="text-white/80">{time.station}</span>
        </div>

        {/* Theme switcher */}
        <button
          onClick={toggleTheme}
          className="rounded-xl border border-white/10 bg-abyssal/60 p-2 text-mist transition hover:text-mint hover:border-mint/30"
          aria-label="Toggle theme"
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        {/* Hazard Alert Bell with Animated Pulse */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => setNotifOpen((o) => !o)}
            className="relative rounded-xl border border-white/10 bg-abyssal/60 p-2 text-mist transition hover:text-mint hover:border-mint/30"
            aria-label="Notifications"
          >
            <Bell size={16} />
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[9px] font-bold text-white shadow-sm">
              2
            </span>
          </button>
          {notifOpen && (
            <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-white/10 bg-abyssal-card p-2 shadow-2xl backdrop-blur-2xl">
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                <p className="text-xs font-bold uppercase tracking-wider text-white">Bridge Alerts</p>
                <button className="text-xs font-semibold text-mint hover:underline" onClick={() => navigate('/alerts')}>View all</button>
              </div>
              <div className="space-y-1 p-1">
                {notifications.map((n) => (
                  <button
                    key={n.id}
                    className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left hover:bg-white/5 transition"
                    onClick={() => setNotifOpen(false)}
                  >
                    <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.tone === 'danger' ? 'bg-danger' : n.tone === 'warn' ? 'bg-warn' : 'bg-mint')} />
                    <div>
                      <span className="block text-xs font-semibold text-white/90">{n.title}</span>
                      <span className="block text-[10px] text-mist">{n.time} ago</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* User Profile dropdown */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setProfileOpen((o) => !o)}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-abyssal/60 py-1.5 pl-1.5 pr-2.5 transition hover:border-mint/40"
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-mint to-azure text-xs font-bold text-abyssal">
              {user?.name ? user.name.split(' ').map((w) => w[0]).slice(0, 2).join('') : 'AU'}
            </div>
            <div className="hidden text-left sm:block">
              <p className="text-xs font-semibold leading-tight text-white">{user?.name ?? 'Admin User'}</p>
            </div>
            <ChevronDown size={13} className="text-mist" />
          </button>
          {profileOpen && (
            <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-white/10 bg-abyssal-card p-2 shadow-2xl backdrop-blur-2xl">
              <div className="border-b border-white/10 px-3 py-2.5">
                <p className="truncate text-xs font-bold text-white">{user?.name}</p>
                <p className="truncate text-[10px] text-mist">{user?.email}</p>
              </div>
              <Link to="/settings" className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-mist hover:bg-white/5 hover:text-white" onClick={() => setProfileOpen(false)}>
                <User size={14} /> Profile Settings
              </Link>
              <button
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs text-danger hover:bg-danger/10"
                onClick={() => {
                  logout()
                  navigate('/')
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
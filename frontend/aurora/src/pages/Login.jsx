import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Ship, Snowflake, Route, ShieldCheck, ChevronLeft, Info } from 'lucide-react'
import AuthShell from '../components/layout/AuthShell'
import Button from '../components/ui/Button'
import { useAuth } from '../context/AuthContext'

/** The single demo credential the AuthContext accepts. */
export const DEMO_EMAIL = 'admin@aurora.local'
const DEMO_PASSWORD = 'admin123'

const SIDE_STATS = [
  { icon: Route, label: 'Route optimiser', value: 'A* + CostMap on real SIC' },
  { icon: Snowflake, label: 'SIC forecaster', value: '3-seed ConvLSTM · 167 days' },
  { icon: Ship, label: 'Iceberg detector', value: 'SAR YOLOv8-nano' },
]

export function LoginSide() {
  return (
    <div>
      <h2 className="font-display text-2xl font-bold leading-snug text-white">
        Command the ice,
        <br />
        not the other way around.
      </h2>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-mist">
        One console for sea-ice forecasts, SAR iceberg detection and uncertainty-aware Antarctic
        routing — reporting only what this repository can actually serve.
      </p>
      <div className="mt-8 space-y-3">
        {SIDE_STATS.map((s) => (
          <div
            key={s.label}
            className="flex items-center gap-4 border border-white/5 bg-navy-deep/50 px-4 py-3"
          >
            <div className="flex h-9 w-9 items-center justify-center border border-graphite-600 bg-graphite-800 text-ice">
              <s.icon size={18} />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{s.label}</p>
              <p className="text-xs text-mist">{s.value}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-8 flex items-center gap-2 text-xs text-mist">
        <ShieldCheck size={14} className="text-safe" /> Demo authentication — no real data collected.
      </div>
    </div>
  )
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  const from = location.state?.from || '/overview'

  const submit = (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const res = login({ email, password, remember })
    setLoading(false)
    if (res.ok) navigate(from, { replace: true })
    else setError(res.error)
  }

  const autofill = () => {
    setEmail(DEMO_EMAIL)
    setPassword(DEMO_PASSWORD)
    setError('')
  }

  return (
    <AuthShell side={<LoginSide />}>
      <Link
        to="/landing"
        className="mb-6 inline-flex items-center gap-1.5 text-xs text-mist hover:text-ice lg:hidden"
      >
        <ChevronLeft size={14} /> Back to landing
      </Link>
      <h1 className="font-display text-2xl font-bold text-white">Sign in</h1>
      <p className="mt-1.5 text-sm text-mist">Access the AURORA Antarctic operations console</p>

      <form onSubmit={submit} className="mt-8 space-y-5">
        <div>
          <label className="input-label" htmlFor="login-email">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            className="input"
            placeholder="you@example.org"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        <div>
          <label className="input-label" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            type="password"
            className="input"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </div>

        {error && (
          <div className="border border-danger/40 bg-danger/10 px-4 py-2.5 text-sm text-danger">
            {error}
          </div>
        )}

        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-4 w-4 border-white/20 bg-navy accent-ice"
          />
          <span className="text-sm text-mist">Keep me signed in on this device</span>
        </label>

        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? (
            <>
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-navy/30 border-t-navy" />
              Signing in…
            </>
          ) : (
            'Login'
          )}
        </Button>
      </form>

      <div className="mt-6 border border-ice/25 bg-ice/5 p-3 text-xs leading-relaxed text-mist">
        <div className="flex items-start justify-between gap-3">
          <div>
            Demo operator:{' '}
            <span className="font-semibold text-white">{DEMO_EMAIL}</span> /{' '}
            <span className="font-semibold text-white">{DEMO_PASSWORD}</span>
          </div>
          <button
            type="button"
            onClick={autofill}
            className="shrink-0 border border-ice/40 bg-ice/15 px-2.5 py-1 font-semibold text-ice transition hover:bg-ice/25"
          >
            Auto-fill
          </button>
        </div>
        <p className="mt-2 text-[11px] text-mist/80">
          This is a local demo session stored in your browser. It is not a production account and
          the console performs no server-side authentication.
        </p>
      </div>

      <button
        type="button"
        onClick={() => setShowHelp((s) => !s)}
        className="mt-4 inline-flex items-center gap-1.5 text-xs text-mist transition hover:text-ice"
        aria-expanded={showHelp}
      >
        <Info size={13} /> {showHelp ? 'Hide sign-in help' : 'Having trouble signing in?'}
      </button>
      {showHelp && (
        <div className="mt-2 border border-graphite-600 bg-graphite-850 px-3 py-2.5 text-xs leading-relaxed text-mist">
          Use the demo credential above (or press <strong className="text-white">Auto-fill</strong>
          ). AURORA has no password recovery because it has no user database — the session lives
          only in this browser's local storage.
        </div>
      )}

      <p className="mt-6 text-center text-sm text-mist">
        Looking for the public page?{' '}
        <Link to="/landing" className="font-semibold text-ice hover:text-ice-bright">
          View landing page
        </Link>
      </p>
    </AuthShell>
  )
}

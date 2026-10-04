import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Ship, Snowflake, Route, ShieldCheck, ChevronLeft } from 'lucide-react'
import AuthShell from '../components/layout/AuthShell'
import Button from '../components/ui/Button'
import { useAuth } from '../context/AuthContext'

const SIDE_STATS = [
  { icon: Ship, label: 'Fleet telemetry', value: '1-min updates' },
  { icon: Snowflake, label: 'Icebergs tracked', value: '128 in demo' },
  { icon: Route, label: 'Route alternatives', value: '3 per voyage' },
]

export function LoginSide() {
  return (
    <div>
      <h2 className="font-display text-2xl font-bold leading-snug text-white">
        Command the ice,<br />not the other way around.
      </h2>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-mist">
        One secure console for sea-ice forecasts, iceberg tracks, and safer Antarctic routing.
      </p>
      <div className="mt-8 space-y-3">
        {SIDE_STATS.map((s) => (
          <div key={s.label} className="flex items-center gap-4 rounded-xl border border-white/5 bg-navy-deep/50 px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan/10 text-cyan"><s.icon size={18} /></div>
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
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    setTimeout(() => {
      const res = login({ email, password })
      setLoading(false)
      if (res.ok) {
        navigate('/dashboard')
      } else {
        setError(res.error)
      }
    }, 600)
  }

  return (
    <AuthShell side={<LoginSide />}>
      <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-xs text-mist hover:text-cyan lg:hidden">
        <ChevronLeft size={14} /> Back
      </Link>
      <h1 className="font-display text-2xl font-bold text-white">Sign in</h1>
      <p className="mt-1.5 text-sm text-mist">Access the Antarctic operations console</p>

      <form onSubmit={submit} className="mt-8 space-y-5">
        <div>
          <label className="input-label">Email</label>
          <input
            type="email"
            className="input"
            placeholder="you@naviglace.ai"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <label className="input-label">Password</label>
            <button type="button" className="mb-1.5 text-[11px] font-medium text-cyan hover:text-ice-cyan">Forgot password?</button>
          </div>
          <input
            type="password"
            className="input"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && (
          <div className="rounded-xl border border-danger/25 bg-danger/10 px-4 py-2.5 text-sm text-danger">
            {error}
          </div>
        )}

        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-4 w-4 rounded border-white/20 bg-navy-deep accent-cyan"
          />
          <span className="text-sm text-mist">Remember me on this device</span>
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

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan/20 bg-cyan/5 p-3 text-xs leading-relaxed text-mist">
        <div>
          Demo: <span className="font-semibold text-white">admin@naviglace.ai</span> /{' '}
          <span className="font-semibold text-white">admin123</span>
        </div>
        <button
          type="button"
          onClick={() => {
            setEmail('admin@naviglace.ai')
            setPassword('admin123')
          }}
          className="rounded-lg border border-cyan/40 bg-cyan/15 px-2.5 py-1 font-semibold text-cyan hover:bg-cyan/25"
        >
          Auto-fill
        </button>
      </div>

      <p className="mt-6 text-center text-sm text-mist">
        New to NAVIGLACE AI?{' '}
        <Link to="/signup" className="font-semibold text-cyan hover:text-ice-cyan">Create an account</Link>
      </p>
    </AuthShell>
  )
}
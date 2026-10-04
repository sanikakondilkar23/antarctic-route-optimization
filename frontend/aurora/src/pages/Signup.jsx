import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, Globe2, Lock, Building2, User as UserIcon, Mail } from 'lucide-react'
import AuthShell from '../components/layout/AuthShell'
import Button from '../components/ui/Button'
import { useAuth } from '../context/AuthContext'

export function SignupSide() {
  return (
    <div>
      <h2 className="font-display text-2xl font-bold leading-snug text-white">
        Join the polar operations community.
      </h2>
      <p className="mt-3 max-w-sm text-sm leading-relaxed text-mist">
        Create a workspace to explore Antarctic sea-ice forecasting, iceberg tracking, and route
        planning with fully simulated data.
      </p>
      <div className="mt-8 grid grid-cols-2 gap-3">
        {[
          ['No keys needed', 'Runs entirely in-browser'],
          ['Demo data only', 'Safe to explore'],
          ['Team ready', 'Organization profiles'],
          ['Free forever', 'For the prototype'],
        ].map(([t, d]) => (
          <div key={t} className="rounded-xl border border-white/5 bg-navy-deep/50 px-4 py-3">
            <p className="text-sm font-semibold text-white">{t}</p>
            <p className="mt-1 text-xs text-mist">{d}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SignupPage() {
  const navigate = useNavigate()
  const { signup } = useAuth()
  const [form, setForm] = useState({ fullName: '', email: '', organization: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = (e) => {
    e.preventDefault()
    setError('')
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters long.')
      return
    }
    if (form.password !== form.confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    setTimeout(() => {
      const res = signup({ fullName: form.fullName, email: form.email, organization: form.organization })
      setLoading(false)
      if (res.ok) navigate('/dashboard')
    }, 700)
  }

  const fields = [
    { key: 'fullName', label: 'Full name', icon: UserIcon, type: 'text', placeholder: 'Dr. Jane Doe' },
    { key: 'email', label: 'Email', icon: Mail, type: 'email', placeholder: 'you@naviglace.ai' },
    { key: 'organization', label: 'Organization', icon: Building2, type: 'text', placeholder: 'Research institution' },
    { key: 'password', label: 'Password', icon: Lock, type: 'password', placeholder: 'Min. 8 characters' },
    { key: 'confirm', label: 'Confirm password', icon: Lock, type: 'password', placeholder: 'Repeat password' },
  ]

  return (
    <AuthShell side={<SignupSide />}>
      <Link to="/" className="mb-6 inline-flex items-center gap-1.5 text-xs text-mist hover:text-cyan lg:hidden">
        <ChevronLeft size={14} /> Back
      </Link>
      <h1 className="font-display text-2xl font-bold text-white">Create your account</h1>
      <p className="mt-1.5 text-sm text-mist">Start exploring Antarctic operations intelligence</p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        {fields.map((f) => (
          <div key={f.key}>
            <label className="input-label">{f.label}</label>
            <div className="relative">
              <f.icon size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mist/60" />
              <input
                type={f.type}
                className="input !pl-10"
                placeholder={f.placeholder}
                value={form[f.key]}
                onChange={set(f.key)}
                required
              />
            </div>
          </div>
        ))}

        {error && (
          <div className="rounded-xl border border-danger/25 bg-danger/10 px-4 py-2.5 text-sm text-danger">
            {error}
          </div>
        )}

        <Button type="submit" size="lg" className="w-full" disabled={loading}>
          {loading ? (
            <>
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-navy/30 border-t-navy" />
              Creating account…
            </>
          ) : (
            'Create account'
          )}
        </Button>

        <p className="flex items-center justify-center gap-1.5 text-[11px] text-mist/70">
          <Globe2 size={12} /> Demo signup stores a profile locally in your browser only.
        </p>
      </form>

      <p className="mt-6 text-center text-sm text-mist">
        Already registered?{' '}
        <Link to="/login" className="font-semibold text-cyan hover:text-ice-cyan">Sign in</Link>
      </p>
    </AuthShell>
  )
}
import { Link } from 'react-router-dom'
import { Compass, ArrowLeft } from 'lucide-react'
import Logo from '../components/ui/Logo'

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-hero-gradient px-6">
      <div className="text-center">
        <div className="mx-auto mb-6 inline-flex h-20 w-20 items-center justify-center rounded-3xl border border-white/10 bg-navy-mid shadow-card">
          <Compass size={36} className="text-cyan" />
        </div>
        <p className="font-mono text-sm uppercase tracking-[0.3em] text-cyan">404 · Off track</p>
        <h1 className="mt-3 font-display text-4xl font-bold text-white">This waypoint does not exist</h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-mist">
          You have drifted outside the charted area of this application. Plot a course back to a known location.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/dashboard" className="btn-primary"><ArrowLeft size={16} /> Back to dashboard</Link>
          <Link to="/" className="btn-secondary">Go to landing page</Link>
        </div>
        <div className="mt-10 flex justify-center opacity-70"><Logo /></div>
      </div>
    </div>
  )
}
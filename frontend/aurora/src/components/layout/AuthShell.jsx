import { Link } from 'react-router-dom'
import Logo from '../ui/Logo'

export default function AuthShell({ children, side }) {
  return (
    <div className="min-h-screen bg-hero-gradient">
      <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-5 py-10">
        <div className="grid w-full overflow-hidden rounded-3xl border border-white/10 bg-navy/60 shadow-card lg:grid-cols-2">
          {/* Brand side */}
          <div className="relative hidden flex-col justify-between overflow-hidden border-r border-white/5 p-10 lg:flex">
            <div className="absolute inset-0 bg-polar-grid opacity-60" />
            <div className="relative">
              <Link to="/"><Logo /></Link>
            </div>
            <div className="relative">
              {side}
            </div>
            <div className="relative">
              <p className="text-[11px] leading-relaxed text-mist">
                Prototype for research and demonstration. Data shown is illustrative and not for
                real-world navigation.
              </p>
            </div>
          </div>
          {/* Form side */}
          <div className="flex items-center justify-center p-6 sm:p-10">
            <div className="w-full max-w-md">{children}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
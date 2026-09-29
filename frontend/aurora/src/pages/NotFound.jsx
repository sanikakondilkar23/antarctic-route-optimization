import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-md border border-graphite-600 bg-graphite-850 px-6 py-8 text-center">
        <p className="mono-label">HTTP 404</p>
        <h1 className="mt-3 text-[22px] font-semibold text-white">Waypoint not found</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-mist">
          The requested page is outside this application's charted area.
        </p>
        <Link to="/" className="btn-primary mt-6 inline-flex">
          <ArrowLeft size={15} /> Return to Mission Control
        </Link>
      </div>
    </div>
  )
}

import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Boxes,
  Compass,
  Database,
  RefreshCw,
  Route,
  ShieldCheck,
  Snowflake,
  Waves,
  Wind,
} from 'lucide-react'
import Logo from '../components/ui/Logo'
import Disclaimer from '../components/ui/Disclaimer'
import AntarcticOceanHero from '../components/visual/AntarcticOceanHero'
import { useAuth } from '../context/AuthContext'

/**
 * The public face of AURORA.
 *
 * The hero artwork is an original SVG of the Southern Ocean
 * (components/visual/AntarcticOceanHero) - no third-party photography, no
 * traced maps. Everything stated about the platform below is a capability the
 * backend actually reports; the sections that follow say, in the same breath,
 * what this deployment cannot do.
 */

const CAPABILITIES = [
  {
    icon: Waves,
    title: 'Sea-Ice Forecasting',
    body: 'A committed 2026 forecast field on a 173 × 369 grid at 0.25°, served one timestep at a time with its validity mask — NaN is non-navigable and never drawn as open water.',
  },
  {
    icon: Snowflake,
    title: 'Iceberg Detection',
    body: 'A YOLOv8 SAR-tile detector you can run yourself. Detections are reported in pixel space because georeferencing is unavailable in this deployment.',
  },
  {
    icon: Wind,
    title: 'Environmental Intelligence',
    body: 'Wind, current, sea ice and bathymetry probed individually, each reported as available or unavailable — a missing layer is named, never estimated.',
  },
  {
    icon: Route,
    title: 'Route Optimization',
    body: 'Geographic origin and destination in, a validated 8-connected path out, with the SIC statistics, cost weights and provenance that produced it echoed back verbatim.',
  },
  {
    icon: RefreshCw,
    title: 'Dynamic Rerouting',
    body: 'Recalculate the operational route when environmental conditions or route constraints change — replanned against a later forecast timestep on the server.',
  },
  {
    icon: ShieldCheck,
    title: 'Risk Analytics',
    body: 'The real 1σ spread artifact over three lead times, shown spatially and as the committed distribution — not a synthetic confidence score, and never a combined risk number.',
  },
]

/** The re-planning chain, exactly as the backend supports each step. */
const REROUTING = [
  ['Route optimization', 'A* over the cost map', 'POST /api/route/optimize', true],
  ['Environmental update', 'Move to a later forecast timestep', 'GET /api/sic/<t>', true],
  ['Route monitoring', 'Compare the two corridors', 'jaccard · coverage · changed cells', true],
  ['Dynamic rerouting', 'Re-plan on the updated surface', 'POST /api/route/reroute', true],
  ['Updated operational route', 'Drawn beside the original', 'reroute.updated_route', true],
]

const FACTS = [
  ['Grid', '173 × 369 @ 0.25°'],
  ['Forecast window', '167 days · 2026-01-06 → 2026-06-21'],
  ['Routing algorithm', 'A* + CostMap on real SIC'],
  ['ConvLSTM checkpoints', '3 seeds · 270,147 params'],
]

/** The five-beat story of what the platform does with a timestep. */
const PIPELINE = [
  {
    code: '01',
    title: 'Antarctic data',
    body: 'Committed sea-ice concentration and forecast-spread arrays, the Natural Earth coastline, and the grid axes the API itself publishes.',
    endpoints: '/api/sic/metadata · /api/map/coastline',
  },
  {
    code: '02',
    title: 'ML / ENV intelligence',
    body: 'Three ConvLSTM checkpoints describe the forecast, a YOLOv8 detector reads SAR tiles, and the environmental layers are probed for what is really reachable.',
    endpoints: '/api/sic/status · /api/icebergs/status',
  },
  {
    code: '03',
    title: 'Risk & uncertainty',
    body: 'The 1σ spread field is served alongside the concentration field so a decision can be made with the forecast\u2019s confidence in view, not hidden behind it.',
    endpoints: '/api/uncertainty/summary · /api/uncertainty/<t>',
  },
  {
    code: '04',
    title: 'Route optimisation',
    body: 'A* over a cost map whose weights are echoed back: SIC risk and distance today, wind, current, depth and iceberg standoff reported as unavailable until data exists.',
    endpoints: '/api/layers/status · /api/route/optimize',
  },
  {
    code: '05',
    title: 'Operational decision support',
    body: 'A chart room, a risk view and a re-planning flow that replans on a later timestep — presented as decision support, with the prototype boundary stated on every page.',
    endpoints: '/api/route/reroute · /api/aurora/status',
  },
]

const SECTIONS = [
  ['Overview', '/overview', 'Component status, the theatre map and the fastest path into every module.'],
  ['Navigation', '/navigation', 'The chart room: real SIC raster, coastline and the committed baseline route.'],
  ['Environment', '/environment', 'Wind, current, sea ice and bathymetry — each reported as available or unavailable.'],
  ['Sea-Ice', '/sea-ice', 'Day slider over the 167-day forecast with the uncertainty field beside it.'],
  ['Icebergs', '/icebergs', 'Run the SAR YOLOv8 detector; detections stay in pixel space.'],
  ['Risk Analytics', '/risk', 'Forecast spread, cost terms and every limitation the backend documents.'],
  ['Routes', '/routes', 'Plan, re-plan and inspect the cost that produced a route.'],
  ['Ship Details', '/ship-details', 'Vessel context for the route — only fields the backend publishes.'],
  ['Models', '/models', 'Architecture, checkpoints, recorded metrics and system verification.'],
  ['About', '/about', 'What AURORA is, what it is not, and how this deployment is put together.'],
]

const NOT_DO = [
  'No ocean-current, wind or bathymetry fields are reachable, so those cost terms are absent — not estimated.',
  'No iceberg georeferencing exists, so no berg is plotted and none enters the routing cost.',
  'ConvLSTM inference is not re-run at request time: the committed forecast artifact is served as-is.',
  'CVaR is not computed, and the route ML policy (trained on synthetic smoke data) does not produce the route.',
  'No vessel tracking, AIS or telemetry is served, so no fleet layer is drawn.',
  'End-to-end navigation safety is not claimed: this is a research prototype, not a navigational product.',
]

export default function Landing() {
  const { user } = useAuth()
  const launchTo = user ? '/overview' : '/login'

  return (
    <div className="min-h-screen bg-aurora-abyss text-white selection:bg-ice/30">
      {/* ------------------------------------------------------------ */}
      {/* Header                                                       */}
      {/* ------------------------------------------------------------ */}
      <header className="sticky top-0 z-30 border-b border-graphite-600/80 bg-graphite-950/85 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3.5 sm:px-8">
          <Logo />
          <nav className="hidden items-center gap-1 lg:flex">
            {[
              ['Capabilities', '#capabilities'],
              ['Pipeline', '#pipeline'],
              ['Sections', '#sections'],
              ['Limitations', '#limitations'],
            ].map(([label, href]) => (
              <a
                key={href}
                href={href}
                className="rounded px-3.5 py-1.5 text-xs font-semibold text-mist transition hover:bg-white/5 hover:text-white"
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-2.5">
            <Link to="/login" className="btn-ghost !py-1.5 !text-xs">
              Sign in
            </Link>
            <Link to={launchTo} className="btn-primary !rounded-lg !px-3.5 !py-1.5 !text-xs">
              Launch AURORA <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------ */}
      {/* Hero — Southern Ocean                                        */}
      {/* ------------------------------------------------------------ */}
      <section className="relative isolate overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <AntarcticOceanHero className="h-full w-full" />
        </div>
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-graphite-950 via-graphite-950/88 to-graphite-950/25" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-aurora-abyss via-transparent to-aurora-abyss/70" />
        <div className="pointer-events-none absolute inset-0 -z-10 contour-field opacity-40" />

        <div className="relative mx-auto max-w-7xl px-5 pb-16 pt-16 sm:px-8 sm:pt-20">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-sm border border-ice/30 bg-ice/10 px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.16em] text-ice">
                Antarctic operational intelligence
              </span>
              <span className="inline-flex items-center gap-1 rounded-sm border border-graphite-500 bg-graphite-850/90 px-2.5 py-1 text-[11px] text-mist">
                <ShieldCheck size={12} className="text-ice" /> Research prototype
              </span>
              <span className="inline-flex items-center gap-1 rounded-sm border border-warn/35 bg-warn/10 px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-[0.14em] text-warn">
                Not for navigation
              </span>
            </div>

            <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.22em] text-ice/90">
              AURORA · SIH problem statement 26059
            </p>

            <h1 className="mt-3 font-display text-[34px] font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl">
              Uncertainty-Aware Maritime Route Optimization for{' '}
              <span className="bg-gradient-to-r from-ice via-[#A8CFE6] to-[#51809B] bg-clip-text text-transparent">
                Antarctic Waters
              </span>
            </h1>

            <p className="mt-5 max-w-2xl text-sm leading-relaxed text-white/80 sm:text-[15px]">
              AURORA is an operational intelligence platform for the Southern Ocean: sea-ice
              forecasts, iceberg detection, environmental analytics and uncertainty-aware route
              planning for maritime operations. Every figure in the interface is a value the API
              returned — nothing is simulated to look operational, and every missing layer is named
              as missing.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to={launchTo} className="btn-primary !rounded-lg !px-6 !py-3 !text-sm">
                <Compass size={16} /> Launch AURORA
              </Link>
              <a href="#pipeline" className="btn-secondary !rounded-lg !px-6 !py-3 !text-sm">
                Explore Platform <ArrowRight size={15} />
              </a>
            </div>

            <div className="mt-9 grid max-w-2xl grid-cols-2 gap-2.5 sm:grid-cols-4">
              {FACTS.map(([k, v]) => (
                <div key={k} className="border border-graphite-600 bg-graphite-850/90 p-3">
                  <p className="text-[11px] font-medium text-mist">{k}</p>
                  <p className="mt-1 font-mono text-[12px] font-bold leading-tight text-white">{v}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ */}
      {/* Dynamic rerouting — the re-planning chain                     */}
      {/* ------------------------------------------------------------ */}
      <section className="border-t border-graphite-600 bg-graphite-950/70 px-5 py-12 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <p className="eyebrow">Dynamic rerouting</p>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-white">
            Route optimization → environmental update → reroute
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-mist">
            Each step below is a call this client actually makes. Re-planning runs on the server
            against a later forecast timestep, so the wording here is{' '}
            <span className="text-white">“rerouting based on available environmental data”</span> —
            no live AIS feed or live satellite feed is connected to this deployment.
          </p>

          <ol className="mt-7 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {REROUTING.map(([title, body, endpoint], i) => (
              <li
                key={title}
                className="relative flex flex-col border border-graphite-600 bg-graphite-850 p-4 transition hover:border-ice/45"
              >
                <div className="flex items-center justify-between">
                  <span className="num text-[24px] font-bold leading-none text-ice/70">
                    {`0${i + 1}`}
                  </span>
                  {i < REROUTING.length - 1 && (
                    <ArrowRight size={16} className="hidden text-steel xl:block" />
                  )}
                </div>
                <h3 className="mt-3 text-[13.5px] font-semibold uppercase tracking-[0.09em] text-white">
                  {title}
                </h3>
                <p className="mt-2 flex-1 text-[12.5px] leading-relaxed text-mist">{body}</p>
                <p className="mt-3 border-t border-graphite-700 pt-2 font-mono text-[10px] leading-relaxed text-steel">
                  {endpoint}
                </p>
              </li>
            ))}
          </ol>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <Link to="/routes" className="btn-primary !rounded-lg !px-5 !py-2.5 !text-[13px]">
              <RefreshCw size={14} /> Open the reroute workflow
            </Link>
            <p className="text-[11.5px] text-mist">
              Runs on <span className="font-mono text-white">POST /api/route/reroute</span> ·
              iceberg detections are not an input to the cost.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ */}
      {/* Pipeline                                                     */}
      {/* ------------------------------------------------------------ */}
      <section id="pipeline" className="border-t border-graphite-600 bg-graphite-950/60 px-5 py-14 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <p className="eyebrow">How a timestep becomes a decision</p>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-white">
            Antarctic data → operational decision support
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-mist">
            Five beats, each owned by the backend. The endpoints listed under each stage are the ones
            this interface actually calls — no stage invents what the previous one did not provide.
          </p>

          <ol className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {PIPELINE.map((s, i) => (
              <li
                key={s.code}
                className="relative flex flex-col border border-graphite-600 bg-graphite-850 p-4 transition hover:border-ice/45"
              >
                <div className="flex items-center justify-between">
                  <span className="num text-[26px] font-bold leading-none text-ice/70">{s.code}</span>
                  {i < PIPELINE.length - 1 && (
                    <ArrowRight size={16} className="hidden text-steel xl:block" />
                  )}
                </div>
                <h3 className="mt-3 text-[14px] font-semibold uppercase tracking-[0.1em] text-white">
                  {s.title}
                </h3>
                <p className="mt-2 flex-1 text-[12.5px] leading-relaxed text-mist">{s.body}</p>
                <p className="mt-3 border-t border-graphite-700 pt-2 font-mono text-[10px] leading-relaxed text-steel">
                  {s.endpoints}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ------------------------------------------------------------ */}
      {/* Capabilities                                                 */}
      {/* ------------------------------------------------------------ */}
      <section id="capabilities" className="border-t border-graphite-600 px-5 py-14 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <p className="eyebrow">Capabilities</p>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-white">
            Six things this build really does
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-mist">
            Sea-ice forecasting and iceberg detection are independent intelligence modules — neither
            feeds the other, and only the layers the backend actually consumes reach the route cost.
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c) => (
              <div
                key={c.title}
                className="border border-graphite-600 bg-graphite-850 p-5 transition hover:border-ice/45 hover:bg-graphite-800"
              >
                <div className="flex h-10 w-10 items-center justify-center border border-graphite-600 bg-graphite-950 text-ice">
                  <c.icon size={19} />
                </div>
                <h3 className="mt-4 font-display text-base font-bold text-white">{c.title}</h3>
                <p className="mt-2 text-xs leading-relaxed text-mist">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ */}
      {/* Section directory                                            */}
      {/* ------------------------------------------------------------ */}
      <section id="sections" className="border-t border-graphite-600 bg-graphite-950/60 px-5 py-14 sm:px-8">
        <div className="mx-auto max-w-7xl">
          <p className="eyebrow">Inside the console</p>
          <h2 className="mt-2 font-display text-2xl font-bold tracking-tight text-white">
            Ten working sections
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-mist">
            Each link opens a real page backed by a real endpoint. Signed out, it takes you to the
            demo sign-in first.
          </p>

          <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SECTIONS.map(([label, to, hint]) => (
              <Link
                key={to}
                to={to}
                className="group flex items-start gap-3 border border-graphite-600 bg-graphite-850 p-4 transition hover:border-ice/50 hover:bg-graphite-800"
              >
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border border-graphite-600 bg-graphite-950 text-ice">
                  <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-semibold text-white">{label}</span>
                  <span className="mt-1 block text-[11.5px] leading-relaxed text-mist">{hint}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ */}
      {/* Limitations                                                  */}
      {/* ------------------------------------------------------------ */}
      <section id="limitations" className="border-t border-graphite-600 px-5 py-12 sm:px-8">
        <div className="mx-auto max-w-7xl border border-warn/35 bg-warn/[0.06] p-5 sm:p-6">
          <p className="inline-flex items-center gap-2 text-sm font-bold text-warn">
            <Database size={15} /> What this deployment does not do
          </p>
          <div className="mt-4 grid gap-2.5 text-xs leading-relaxed text-white/85 sm:grid-cols-2 lg:grid-cols-3">
            {NOT_DO.map((t) => (
              <p key={t} className="border-l-2 border-warn/40 pl-3">
                {t}
              </p>
            ))}
          </div>
          <p className="mt-4 border-t border-warn/20 pt-3 text-[11.5px] leading-relaxed text-mist">
            The full machine-readable list is served by{' '}
            <span className="font-mono text-white">GET /api/limitations</span> and is reproduced
            verbatim on the Risk Analytics section.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------ */}
      {/* Footer                                                       */}
      {/* ------------------------------------------------------------ */}
      <footer className="border-t border-graphite-600 bg-graphite-950 px-5 py-9 sm:px-8">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Logo />
            <div className="flex flex-wrap items-center gap-3 text-xs text-mist">
              <span className="inline-flex items-center gap-1.5">
                <Boxes size={13} className="text-ice" /> Demo sign-in:
                <strong className="text-white">admin@aurora.local</strong> /{' '}
                <strong className="text-white">admin123</strong>
              </span>
              <Link to="/login" className="btn-secondary !rounded-lg !px-3 !py-1 !text-xs">
                Sign in
              </Link>
              <Link to={launchTo} className="btn-primary !rounded-lg !px-3 !py-1 !text-xs">
                Launch AURORA
              </Link>
            </div>
          </div>

          <div className="grid gap-3 border-t border-graphite-700 pt-4 text-[11.5px] text-mist sm:grid-cols-3">
            <p className="inline-flex items-start gap-2">
              <Wind size={13} className="mt-0.5 shrink-0 text-steel" />
              Wind, current and bathymetry report DATA UNAVAILABLE; their cost weights are 0.
            </p>
            <p className="inline-flex items-start gap-2">
              <Snowflake size={13} className="mt-0.5 shrink-0 text-steel" />
              Iceberg detections are pixel-space only — georeferencing is unavailable.
            </p>
            <p className="inline-flex items-start gap-2">
              <Database size={13} className="mt-0.5 shrink-0 text-steel" />
              Forecast frames are served from committed artifacts, never re-synthesised.
            </p>
          </div>

          <div className="border-t border-graphite-700 pt-4">
            <Disclaimer />
            <p className="mt-3 text-center text-[11px] text-mist/60">
              © {new Date().getFullYear()} AURORA · Smart India Hackathon 26059. Prototype decision
              support system built on committed repository artifacts.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowUpRight,
  Boxes,
  Database,
  FolderGit2,
  Info,
  RefreshCw,
  Server,
  ShieldAlert,
} from 'lucide-react'
import PageHeader, { MetaItem } from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import Disclaimer from '../components/ui/Disclaimer'
import { ErrorState, LoadingState } from '../components/ui/Status'
import { Notice, Row, SectionHeader } from '../components/ui/Panels'
import { fetchHealth, fetchLimitations, fetchSystemStatus } from '../lib/auroraApi'

/**
 * /about - what AURORA is, how this deployment is put together, and every
 * limitation the backend documents about itself.
 *
 * The limitations block is a verbatim rendering of GET /api/limitations: the
 * wording belongs to the backend, and it is not softened or paraphrased here.
 */

const STACK = [
  {
    title: 'Frontend',
    path: 'frontend/aurora',
    lines: [
      ['Stack', 'React + Vite + Tailwind CSS + React Router'],
      ['Map', 'React-Leaflet · Natural Earth coastline · ImageOverlay rasters'],
      ['API client', 'src/lib/auroraApi.js — the single point of contact with the backend'],
      ['Session', 'Demo credentials in localStorage; no server-side account exists'],
    ],
  },
  {
    title: 'Backend',
    path: 'backend/api',
    lines: [
      ['Framework', 'Flask app factory (main.py) with two blueprints'],
      ['Blueprints', 'aurora_api.py (compositor) · iceberg_api.py (detector)'],
      ['Routing', 'A* + CostMap over the committed environmental grid'],
      ['Serving', 'SIC and uncertainty frames from committed .npy artifacts'],
    ],
  },
  {
    title: 'Models & artifacts',
    path: 'models/ · backend/runs/ · backend/cache/',
    lines: [
      ['Forecast', '3 ConvLSTM seeds — final_10ch_3f_seed{0,1,2}/best_model.pt'],
      ['Detector', 'models/iceberg/best_sar_iceberg_model.pt (YOLOv8)'],
      ['Forecast field', 'backend/cache/routing_sic_2026.npy'],
      ['Spread field', 'backend/cache/uncertainty_2026.npy'],
    ],
  },
]

const HONESTY = [
  ['Nothing is fabricated', 'If the API does not publish a value, the interface prints "Unavailable", "Integration pending" or "No data" instead of a number.'],
  ['Nothing is defaulted', 'A missing measurement is never shown as zero, and no figure is interpolated in the browser.'],
  ['Coordinates are earned', 'A position is only drawn from grid axes the API itself serves, or from a route it returned. Pixel-space detections are never converted to latitude/longitude.'],
  ['Wording is the backend\u2019s', 'Status words such as READY, DATA UNAVAILABLE and GEOREFERENCING UNAVAILABLE come from the API\u2019s own vocabulary.'],
]

export default function About() {
  const [limitations, setLimitations] = useState({ data: null, error: null, loading: true })
  const [system, setSystem] = useState({ data: null, error: null, loading: true })
  const [health, setHealth] = useState({ data: null, error: null, loading: true })

  const load = async () => {
    const [l, s, h] = await Promise.allSettled([fetchLimitations(), fetchSystemStatus(), fetchHealth()])
    const apply = (setter) => (r) =>
      setter(
        r.status === 'fulfilled'
          ? { data: r.value, error: null, loading: false }
          : { data: null, error: r.reason, loading: false }
      )
    apply(setLimitations)(l)
    apply(setSystem)(s)
    apply(setHealth)(h)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const limitationEntries = limitations.data
    ? Object.entries(limitations.data).sort(([a], [b]) => a.localeCompare(b))
    : []
  const root = system.data?.data_root ?? null

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="mx-auto max-w-[1200px] space-y-5 p-4 md:p-6">
        <PageHeader
          title="About AURORA"
          subtitle="Antarctic Unified Routing & Operational Risk Analytics — a research prototype for uncertainty-aware route decision support in the Southern Ocean, built for Smart India Hackathon problem statement 26059."
          meta={
            <>
              <MetaItem label="CLASSIFICATION" value="Research prototype" />
              <MetaItem label="SESSION" value="Demo credentials only" />
              <MetaItem
                label="BACKEND"
                value={health.data ? `reachable · ${health.data.status ?? 'ok'}` : health.error ? 'unreachable' : 'probing…'}
              />
              <MetaItem label="DATA ROOT" value={root ? root.split(/[\\/]/).slice(-1)[0] : 'unresolved'} />
            </>
          }
          actions={
            <Button variant="secondary" onClick={load}>
              <RefreshCw size={14} /> Refresh
            </Button>
          }
        />

        {/* ---------------------------------------------------------- */}
        {/* Identity                                                   */}
        {/* ---------------------------------------------------------- */}
        <Card>
          <Card.Header title="What AURORA is" icon={Info} />
          <Card.Body className="space-y-3 text-[13px] leading-relaxed text-mist">
            <p>
              AURORA answers one question: given a real sea-ice forecast and the uncertainty around
              it, what route across the Southern Ocean should a vessel consider, and what would make
              that route worse? It does that with three components — a ConvLSTM sea-ice
              concentration forecaster, a multi-layer A* route optimiser, and a YOLOv8 SAR iceberg
              detector — wired into one decision-support interface.
            </p>
            <p>
              It is explicitly <span className="font-semibold text-white">not</span> a navigational
              product. It provides no charting-grade safety, no live vessel or iceberg tracking and
              no ice-pilot judgement, and it must not be used for real-world navigation. The sign-in
              is a local demonstration gate stored in the browser: there is no server-side account,
              no authentication service and no user data leaving this machine.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Link to="/models" className="btn-secondary !rounded-lg !px-3 !py-1.5 !text-xs">
                <Boxes size={14} /> Inspect the models
              </Link>
              <Link to="/overview" className="btn-primary !rounded-lg !px-3 !py-1.5 !text-xs">
                Open the console <ArrowUpRight size={14} />
              </Link>
            </div>
          </Card.Body>
        </Card>

        {/* ---------------------------------------------------------- */}
        {/* Stack                                                      */}
        {/* ---------------------------------------------------------- */}
        <SectionHeader
          eyebrow="HOW THIS DEPLOYMENT IS PUT TOGETHER"
          title="Frontend, backend, models and artifacts"
          description="Every path below exists in this repository. Nothing here is aspirational — the UI only talks to the backend over the routes listed."
        />

        <div className="grid gap-4 lg:grid-cols-3">
          {STACK.map((s) => (
            <Card key={s.title}>
              <Card.Header title={s.title} icon={FolderGit2} action={<span className="mono-label">{s.path}</span>} />
              <Card.Body>
                <dl>
                  {s.lines.map(([k, v]) => (
                    <Row key={k} k={k} v={v} />
                  ))}
                </dl>
              </Card.Body>
            </Card>
          ))}
        </div>

        {/* ---------------------------------------------------------- */}
        {/* Honesty rules                                              */}
        {/* ---------------------------------------------------------- */}
        <Card>
          <Card.Header title="How this interface treats data" icon={ShieldAlert} />
          <Card.Body>
            <div className="grid gap-3 sm:grid-cols-2">
              {HONESTY.map(([k, v]) => (
                <div key={k} className="border border-graphite-600 bg-graphite-900 px-3.5 py-3">
                  <p className="text-[13px] font-semibold text-white">{k}</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-mist">{v}</p>
                </div>
              ))}
            </div>
          </Card.Body>
        </Card>

        {/* ---------------------------------------------------------- */}
        {/* Limitations (verbatim from the API)                       */}
        {/* ---------------------------------------------------------- */}
        <Card>
          <Card.Header
            title="Declared limitations"
            subtitle="GET /api/limitations — reproduced verbatim, in the backend's own words"
            icon={ShieldAlert}
            action={
              <Badge
                value={limitations.error ? 'ERROR' : limitationEntries.length ? `${limitationEntries.length} ENTRIES` : '…'}
                tone={limitations.error ? 'bad' : limitationEntries.length ? 'warn' : 'neutral'}
              />
            }
          />
          <Card.Body className="space-y-3">
            {limitations.loading && <LoadingState label="Reading limitations" />}
            {limitations.error && (
              <ErrorState title="Limitations unavailable" message={limitations.error.message} />
            )}
            {limitationEntries.map(([key, text]) => (
              <div key={key} className="border-l-2 border-warn/50 pl-3.5">
                <p className="mono-label text-warn">{key.replace(/_/g, ' ')}</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-white/85">{String(text)}</p>
              </div>
            ))}
            {!limitations.loading && !limitations.error && limitationEntries.length === 0 && (
              <p className="text-[12.5px] text-mist">The backend published no limitations.</p>
            )}
          </Card.Body>
        </Card>

        {/* ---------------------------------------------------------- */}
        {/* Environment resolution                                     */}
        {/* ---------------------------------------------------------- */}
        <Card>
          <Card.Header
            title="Where the data comes from"
            subtitle="GET /api/system/status"
            icon={Database}
            action={
              system.data ? (
                <Badge
                  value={system.data.dataset_location?.resolution?.toUpperCase() ?? 'UNRESOLVED'}
                  tone={system.data.dataset_location?.resolved_root ? 'ok' : 'warn'}
                />
              ) : null
            }
          />
          <Card.Body>
            {system.loading && <LoadingState label="Reading system status" compact />}
            {system.error && <ErrorState title="System status unavailable" message={system.error.message} compact />}
            {system.data && (
              <dl>
                <Row k="Data root variable" v={system.data.dataset_location?.env_var} />
                <Row
                  k="Resolved root"
                  v={system.data.dataset_location?.resolved_root}
                  tone={system.data.dataset_location?.resolved_root ? 'text-safe' : 'text-warn'}
                />
                <Row k="Expected location" v={system.data.dataset_location?.hint} />
                <Row k="Search roots" v={system.data.dataset_location?.searched_roots?.join(' · ')} />
                <Row k="Repository root" v={system.data.data_root} />
              </dl>
            )}
            <Notice tone="warn" className="mt-3">
              Wind, current, bathymetry, AIS and iceberg datasets resolve only when the environment
              variables above are set on the host. Until then their status is DATA UNAVAILABLE and
              their cost weights stay at 0 — they are not estimated behind the scenes.
            </Notice>
          </Card.Body>
        </Card>

        {/* ---------------------------------------------------------- */}
        {/* Runtime                                                    */}
        {/* ---------------------------------------------------------- */}
        <Card>
          <Card.Header title="Running this build" icon={Server} />
          <Card.Body className="space-y-2.5 font-mono text-[11.5px] leading-relaxed text-mist">
            <p>
              <span className="text-steel">backend ·</span>{' '}
              <span className="text-white">python backend/api/main.py --port 8078</span>
            </p>
            <p>
              <span className="text-steel">frontend ·</span>{' '}
              <span className="text-white">cd frontend/aurora &amp;&amp; npm run dev</span>
            </p>
            <p>
              <span className="text-steel">health ·</span>{' '}
              <span className="text-white">GET /api/health</span>
              {health.data && (
                <span className={health.data.sic_artifact ? ' text-safe' : ' text-warn'}>
                  {' '}
                  → {health.data.status}, SIC artifact {health.data.sic_artifact ? 'present' : 'missing'}
                </span>
              )}
              {health.error && <span className="text-danger"> → unreachable</span>}
            </p>
            <p>
              <span className="text-steel">demo sign-in ·</span>{' '}
              <span className="text-white">admin@aurora.local / admin123</span>{' '}
              <span className="text-steel">(browser-local demonstration credential)</span>
            </p>
          </Card.Body>
        </Card>

        <Disclaimer />
        <div className="flex items-center gap-2 pb-3 font-mono text-[11px] text-steel">
          <Boxes size={12} /> SIH 26059 · prototype decision support · not for navigation
        </div>
      </div>
    </div>
  )
}

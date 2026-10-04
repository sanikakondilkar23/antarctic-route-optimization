import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Image as ImageIcon, Upload, Eye } from 'lucide-react'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import PageHeader, { MetaItem } from '../components/ui/PageHeader'
import { ErrorState, LoadingState } from '../components/ui/Status'
import StandaloneModelHeader from '../components/layout/StandaloneModelHeader'
import AboutModelBlock from '../components/layout/AboutModelBlock'
import { detectIcebergs, fetchIcebergModel, fetchIcebergStatus } from '../lib/auroraApi'

const SAMPLES = [
  '/samples/tile_y00000_x05376.jpg',
  '/samples/tile_y00000_x07616.jpg',
  '/samples/tile_y00000_x08960.jpg',
]

function Row({ k, v, tone = '' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-graphite-700 py-[5px] last:border-0">
      <dt className="text-[11.5px] text-mist">{k}</dt>
      <dd className={`num text-right text-[12px] ${tone || 'text-white/90'}`}>{v}</dd>
    </div>
  )
}

function Panel({ title, children, action, className = '' }) {
  return (
    <section className={`rounded-2xl border border-white/10 bg-[#071D33]/90 shadow-2xl backdrop-blur-xl overflow-hidden ${className}`}>
      <header className="flex items-center justify-between gap-2 border-b border-white/10 bg-[#0A2A4A]/40 px-4 py-3">
        <h2 className="text-[10px] font-mono uppercase tracking-widest text-[#22E5F0] font-bold">{title}</h2>
        {action}
      </header>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  )
}

export default function IcebergIntelligence() {
  const [status, setStatus] = useState({ data: null, error: null, loading: true })
  const [model, setModel] = useState({ data: null, error: null, loading: true })
  const [conf, setConf] = useState(0.25)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [detectError, setDetectError] = useState(null)
  const fileRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    fetchIcebergStatus()
      .then((d) => {
        if (cancelled) return
        setStatus({ data: d, error: null, loading: false })
        if (typeof d?.confidence_threshold === 'number') setConf(d.confidence_threshold)
      })
      .catch((e) => !cancelled && setStatus({ data: null, error: e, loading: false }))
    fetchIcebergModel()
      .then((d) => !cancelled && setModel({ data: d, error: null, loading: false }))
      .catch((e) => !cancelled && setModel({ data: null, error: e, loading: false }))
    return () => {
      cancelled = true
    }
  }, [])

  const useFile = (f) => {
    if (!f) return
    setFile(f)
    setResult(null)
    setDetectError(null)
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return URL.createObjectURL(f)
    })
  }

  const useSample = async (url) => {
    const res = await fetch(url)
    const blob = await res.blob()
    useFile(new File([blob], url.split('/').pop(), { type: blob.type }))
  }

  const run = async () => {
    if (!file) return
    setBusy(true)
    setDetectError(null)
    try {
      const body = await detectIcebergs(file, conf)
      setResult(body)
    } catch (err) {
      setResult(null)
      setDetectError(err?.message ?? 'Detection failed.')
    } finally {
      setBusy(false)
    }
  }

  const geo = status.data?.georeferencing ?? model.data?.georeferencing ?? null
  const detections = useMemo(() => result?.detections ?? [], [result])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#05182B]">
      {/* Standalone Model 3 Header */}
      <StandaloneModelHeader
        currentModelId="model-3"
        modelNumber="MODEL 03"
        title="YOLOv8 SAR Iceberg Detection Tool"
        subtitle="Sentinel-1 Satellite Radar Imagery Computer Vision Detection"
        accentColor="text-[#A9DFFF]"
        accentBorder="border-[#A9DFFF]/30"
        accentBg="bg-[#A9DFFF]/10"
        icon={Eye}
      />

      <div className="scrollbar-thin flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1440px] space-y-4 p-5">
          <PageHeader
            title="Iceberg Intelligence"
            subtitle="SAR iceberg detection served by the AURORA backend. Detections are reported in image pixel space; this deployment cannot georeference them, so nothing is plotted on the Antarctic chart."
            meta={
              <>
                <MetaItem label="MODEL" value={model.data?.model ?? '—'} />
                <MetaItem label="PARAMS" value={model.data?.parameters ?? '—'} />
                <MetaItem label="CONF" value={model.data?.confidence_threshold ?? '—'} />
                <MetaItem label="IOU" value={model.data?.iou_threshold ?? '—'} />
                <MetaItem label="DEVICE" value={model.data?.device ?? '—'} />
              </>
            }
          />

          {/* ------------------------------- honest limitation banner */}
          <div className="flex items-start gap-3 border border-warn/40 bg-warn/[0.07] px-4 py-3">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-warn">
                Georeferencing unavailable — detections stay in pixel space
              </p>
              <p className="mt-1 text-[12px] leading-relaxed text-mist">
                {geo?.message ?? 'No georeferencing metadata is attached to the SAR tiles.'} Unit:{' '}
                <span className="font-mono">{geo?.unit ?? 'pixel'}</span>. Because{' '}
                <span className="font-mono">location</span> is always null, AURORA never draws a map
                marker, never reports a latitude/longitude, and never shows a trajectory for a
                detection.
              </p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
            {/* ------------------------------- detector status & about */}
            <div className="space-y-4">
              <AboutModelBlock
                modelName="YOLOv8 SAR Iceberg Detector"
                architecture="YOLOv8-nano Object Detection Neural Network (3,011,043 parameters)"
                purpose="Scans Sentinel-1 Synthetic Aperture Radar (SAR) tiles to locate and bound floating iceberg targets in marine corridors."
                inputs="SAR radar image tile (PNG/JPG, 640×640) and confidence threshold slider (default 0.25)."
                outputs="Bounding boxes [x1, y1, x2, y2], detection count, and confidence scores in pixel coordinate space."
                endpoint="POST /api/icebergs/detect"
                checkpoint="models/iceberg/best_sar_iceberg_model.pt"
                limitations="Detections are reported in pixel coordinate space because raw PNG tiles do not carry georeferencing affine transforms."
              />

              <Panel title="Detector status" action={<Badge value={status.data?.model_status ?? '—'} />}>
              {status.loading && <LoadingState label="Reading detector status" />}
              {status.error && <ErrorState title="Unavailable" message={status.error.message} />}
              {status.data && (
                <dl>
                  <Row k="Checkpoint present" v={String(status.data.checkpoint_present)} tone={status.data.checkpoint_present ? 'text-safe' : 'text-danger'} />
                  <Row k="Model status" v={status.data.model_status} />
                  <Row k="Georeferencing" v={geo?.status ?? '—'} tone="text-warn" />
                  <Row k="Unit" v={geo?.unit ?? '—'} />
                  <Row k="Risk status" v={status.data.risk_status} tone="text-warn" />
                  <Row
                    k="Route consumes iceberg risk"
                    v={String(status.data.route_consumes_iceberg_risk)}
                    tone={status.data.route_consumes_iceberg_risk ? 'text-safe' : 'text-warn'}
                  />
                  <Row k="Dataset status" v={status.data.dataset_status ?? '—'} />
                </dl>
              )}
              {status.data?.checkpoint_sha256 && (
                <p className="mono-label mt-2 break-all" title={status.data.checkpoint_sha256}>
                  sha256 {status.data.checkpoint_sha256}
                </p>
              )}
              {status.data?.route_note && (
                <p className="mt-2 border-t border-graphite-700 pt-2 text-[11.5px] leading-relaxed text-mist">
                  {status.data.route_note}
                </p>
              )}
            </Panel>

            <Panel title="Model">
              {model.loading && <LoadingState label="Reading model card" />}
              {model.error && <ErrorState title="Unavailable" message={model.error.message} />}
              {model.data && (
                <dl>
                  <Row k="Architecture" v={model.data.model} />
                  <Row k="Classes" v={(model.data.classes ?? []).join(', ')} />
                  <Row k="Class count" v={model.data.n_classes} />
                  <Row k="Parameters" v={model.data.parameters} />
                  <Row k="Confidence threshold" v={model.data.confidence_threshold} />
                  <Row k="IoU threshold" v={model.data.iou_threshold} />
                  <Row k="Device" v={model.data.device} />
                  <Row k="Status" v={model.data.status} />
                </dl>
              )}
            </Panel>

            <Panel title="What is NOT available">
              <ul className="space-y-1.5 text-[12px] leading-relaxed text-mist">
                <li className="flex gap-2"><span className="text-steel">—</span> Latitude / longitude for a detection</li>
                <li className="flex gap-2"><span className="text-steel">—</span> Trajectory, drift or 24/48 h forecast</li>
                <li className="flex gap-2"><span className="text-steel">—</span> A numeric iceberg risk value (always <span className="font-mono">null</span>)</li>
                <li className="flex gap-2"><span className="text-steel">—</span> Any iceberg term inside the route cost function</li>
              </ul>
              <p className="mt-2 text-[11px] leading-relaxed text-steel">
                Detection confidence is not navigation risk. These gaps are reported by the backend,
                not inferred by this UI.
              </p>
            </Panel>
          </div>

          {/* ------------------------------- detection console */}
          <Panel
            title="Detection console"
            action={<span className="mono-label">POST /api/icebergs/detect</span>}
          >
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <span className="input-label">SAR tile</span>
                <div className="flex items-center gap-2">
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => useFile(e.target.files?.[0])}
                  />
                  <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()}>
                    <Upload size={13} /> Choose image
                  </Button>
                  <Button size="sm" onClick={run} disabled={!file || busy}>
                    {busy ? 'Running…' : 'Run detection'}
                  </Button>
                </div>
              </div>

              <label className="block min-w-[190px] flex-1">
                <span className="input-label">Confidence threshold — {conf.toFixed(2)}</span>
                <input
                  type="range"
                  min="0.05"
                  max="0.95"
                  step="0.05"
                  value={conf}
                  onChange={(e) => setConf(Number(e.target.value))}
                  className="w-full accent-ice"
                />
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="mono-label">Sample tiles</span>
              {SAMPLES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => useSample(s)}
                  className="rounded border border-graphite-500 bg-graphite-750 px-2 py-1 font-mono text-[11px] text-mist transition hover:text-white"
                >
                  {s.split('/').pop()}
                </button>
              ))}
            </div>

            {detectError && (
              <div className="mt-3">
                <ErrorState title="Detection failed" message={detectError} />
              </div>
            )}

            {!preview && (
              <div className="mt-4 flex flex-col items-center justify-center gap-2 border border-dashed border-graphite-600 px-6 py-12 text-center">
                <ImageIcon size={22} className="text-steel" />
                <p className="text-[13px] font-semibold text-white/85">No tile selected</p>
                <p className="max-w-sm text-[11.5px] leading-relaxed text-mist">
                  Choose a SAR tile from disk or load one of the repository's sample tiles, then run
                  the detector.
                </p>
              </div>
            )}

            {preview && (
              <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
                <div className="relative overflow-hidden border border-graphite-600 bg-graphite-950">
                  <img src={preview} alt="SAR tile" className="block w-full" />
                  {detections.map((d, i) => {
                    const [x1, y1, x2, y2] = d.bbox
                    const L = (x1 / result.image_width) * 100
                    const T = (y1 / result.image_height) * 100
                    const W = ((x2 - x1) / result.image_width) * 100
                    const H = ((y2 - y1) / result.image_height) * 100
                    return (
                      <div
                        key={i}
                        className="absolute border border-ice"
                        style={{ left: `${L}%`, top: `${T}%`, width: `${W}%`, height: `${H}%` }}
                        title={`iceberg ${d.confidence}`}
                      >
                        <span className="absolute -top-[15px] left-0 bg-ice px-1 font-mono text-[9px] leading-[14px] text-graphite-950">
                          {i + 1} · {(d.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    )
                  })}
                </div>

                {result ? (
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge value={result.detection_count > 0 ? 'DETECTIONS' : 'NO DETECTIONS'} tone={result.detection_count > 0 ? 'info' : 'neutral'} />
                    <span className="num text-[12px] text-white">
                      {result.image_width} × {result.image_height}
                    </span>
                  </div>
                  <dl className="mb-3">
                    <Row k="Detection count" v={result.detection_count} />
                    <Row k="Confidence used" v={result.confidence_threshold} />
                    <Row k="Model" v={result.model} />
                    <Row k="Model status" v={result.model_status} />
                    <Row k="Georeferencing" v={result.georeferencing?.status ?? '—'} tone="text-warn" />
                    <Row k="Coordinate space" v={detections[0]?.coordinate_space ?? 'pixel'} />
                    <Row k="Risk status" v={result.risk_status} tone="text-warn" />
                    <Row k="iceberg_risk" v={String(result.iceberg_risk)} tone="text-warn" />
                  </dl>

                  {detections.length > 0 ? (
                    <div className="scrollbar-thin max-h-[300px] overflow-auto border border-graphite-600">
                      <table className="w-full border-collapse">
                        <thead className="sticky top-0 bg-graphite-800">
                          <tr>
                            <th className="th">#</th>
                            <th className="th">conf</th>
                            <th className="th">bbox (px)</th>
                            <th className="th">location</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detections.map((d, i) => (
                            <tr key={i} className="border-b border-graphite-700 last:border-0">
                              <td className="td num">{i + 1}</td>
                              <td className="td num">{d.confidence.toFixed(3)}</td>
                              <td className="td num text-[11px]">
                                {d.bbox.map((n) => Math.round(n)).join(', ')}
                              </td>
                              <td className="td text-[11px] text-warn">null (pixel)</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="border border-graphite-600 bg-graphite-800 px-3 py-3 text-[12px] text-mist">
                      No iceberg exceeded the {result.confidence_threshold} threshold in this tile.
                    </p>
                  )}

                  <p className="mono-label mt-2">detected_at {result.detected_at}</p>
                </div>
                ) : (
                  <div className="flex flex-col justify-center border border-graphite-600 bg-graphite-900 px-4 py-8 text-center">
                    <p className="text-[12.5px] font-semibold text-white/85">Tile loaded — ready to run</p>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-mist">
                      Press “Run detection” to execute YOLOv8-nano on this image at confidence{' '}
                      {conf.toFixed(2)}.
                    </p>
                  </div>
                )}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  </div>
)
}

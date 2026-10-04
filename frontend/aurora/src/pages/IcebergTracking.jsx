/**
 * IcebergTracking.jsx - AURORA iceberg intelligence.
 *
 * What exists in this deployment is a YOLOv8 SAR-tile detector and a status
 * report about it. There is NO iceberg catalogue, no drifting position and no
 * georeferencing, so this page shows: the real model provenance, an upload
 * box that runs the real detector, and the detections it returns in pixel
 * space. Nothing is placed on a map, because the API cannot place it.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  Image as ImageIcon,
  Radar,
  ServerCrash,
  Upload,
  XCircle,
} from 'lucide-react'
import PageHeader, { LiveChip } from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import { LoadingState } from '../components/ui/Status'
import {
  detectIcebergs,
  fetchIcebergModel,
  fetchIcebergStatus,
} from '../lib/auroraApi'

function StatusRow({ label, ok, detail, okText = 'YES', badText = 'NO' }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-white/5 py-2 last:border-0">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-white/90">{label}</p>
        {detail && <p className="mt-0.5 text-[11px] leading-snug text-mist">{detail}</p>}
      </div>
      <span
        className={`inline-flex shrink-0 items-center gap-1 font-mono text-[11px] ${
          ok ? 'text-safe' : 'text-warn'
        }`}
      >
        {ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />} {ok ? okText : badText}
      </span>
    </div>
  )
}

export default function IcebergTracking() {
  const [status, setStatus] = useState(null)
  const [model, setModel] = useState(null)
  const [statusError, setStatusError] = useState(null)
  const [file, setFile] = useState(null)
  const [conf, setConf] = useState(0.25)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [detectError, setDetectError] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const fileInput = useRef(null)

  const load = useCallback(async () => {
    try {
      setStatus(await fetchIcebergStatus())
      setStatusError(null)
    } catch (err) {
      setStatus(null)
      setStatusError(err?.message ?? 'status unavailable')
    }
    try {
      setModel(await fetchIcebergModel())
    } catch {
      setModel(null)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const onPick = (f) => {
    setFile(f ?? null)
    setResult(null)
    setDetectError(null)
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(f ? URL.createObjectURL(f) : null)
  }

  const run = async () => {
    if (!file) return
    setRunning(true)
    setDetectError(null)
    try {
      setResult(await detectIcebergs(file, conf))
    } catch (err) {
      setResult(null)
      setDetectError(err?.message ?? 'Detection failed.')
    } finally {
      setRunning(false)
    }
  }

  const detections = result?.detections ?? []
  const scale = result?.image_width
    ? {
        w: result.image_width,
        h: result.image_height,
      }
    : null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Iceberg intelligence"
        subtitle="YOLOv8 SAR-tile detection with explicit provenance. This deployment serves detections only — no iceberg catalogue, no drift positions and no georeferencing."
        actions={
          <div className="flex items-center gap-2">
            <LiveChip
              label={
                status
                  ? `model ${status.model_status}`
                  : statusError
                    ? 'status unavailable'
                    : 'checking model'
              }
              dot={status?.model_status === 'ready' ? 'safe' : 'warn'}
            />
            <Button variant="secondary" onClick={load} className="!px-4">
              Refresh status
            </Button>
          </div>
        }
      />

      {statusError && (
        <div className="flex items-start gap-3 rounded-2xl border border-danger/40 bg-danger/10 px-5 py-4 text-danger">
          <ServerCrash size={18} className="mt-0.5 shrink-0" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold">Iceberg API unavailable</p>
            <p className="text-xs leading-relaxed text-danger/90">{statusError}</p>
          </div>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_1.4fr]">
        {/* ---- model provenance ---- */}
        <Card className="h-fit">
          <Card.Header
            title="Detector provenance"
            subtitle="GET /api/icebergs/status and /api/icebergs/model"
            icon={Cpu}
            action={<Badge value={status?.model_status === 'ready' ? 'Recommended' : 'Warning'} />}
          />
          <Card.Body className="space-y-2">
            {!status && !statusError && <LoadingState label="Reading detector status" className="!py-6" />}
            {status && (
              <>
                <StatusRow
                  label="Checkpoint present"
                  ok={status.checkpoint_present}
                  detail={status.checkpoint_path}
                  okText="PRESENT"
                  badText="MISSING"
                />
                <div className="rounded-lg border border-white/5 bg-navy-deep/40 px-3 py-2">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-mist">checkpoint sha256</p>
                  <p className="mt-0.5 break-all font-mono text-[11px] text-white/85">
                    {status.checkpoint_sha256}
                  </p>
                </div>
                <StatusRow
                  label="Georeferencing"
                  ok={status.georeferencing?.available}
                  detail={
                    status.georeferencing?.available
                      ? 'detections carry lon/lat'
                      : `${status.georeferencing?.status ?? 'Georeferencing unavailable'} — detections stay in pixel space`
                  }
                  okText="AVAILABLE"
                  badText="UNAVAILABLE"
                />
                <StatusRow
                  label="SAR dataset in this repository"
                  ok={status.dataset_status !== 'unavailable in this repository (inference-only import)'}
                  detail={status.dataset_status}
                  okText="PRESENT"
                  badText="ABSENT"
                />
                <StatusRow
                  label="Route optimizer consumes iceberg risk"
                  ok={status.route_consumes_iceberg_risk}
                  detail={status.route_note}
                  okText="YES"
                  badText="NOT YET"
                />
                <div className="rounded-lg border border-ice/20 bg-ice/5 px-3 py-2">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-ice">integration status</p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-white/85">{status.risk_status}</p>
                </div>
              </>
            )}
            {model && (
                <div className="rounded-lg border border-white/5 bg-navy-deep/40 px-3 py-2">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-mist">model</p>
                  <p className="mt-0.5 font-mono text-[11px] leading-relaxed text-white/85">
                    {model.model ?? 'YOLOv8n'} · conf {model.confidence_threshold} · IoU {model.iou_threshold}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-mist">
                    {model.parameters?.toLocaleString()} parameters · classes:{' '}
                    {(model.classes ?? []).join(', ') || '—'} · device {model.device}
                  </p>
                </div>
            )}
          </Card.Body>
        </Card>

        {/* ---- detection workbench ---- */}
        <Card>
          <Card.Header
            title="SAR tile detection"
            subtitle="POST /api/icebergs/detect · pixel-space output"
            icon={Radar}
            action={result ? <Badge value={`${result.detection_count} detected`} /> : null}
          />
          <Card.Body className="space-y-4">
            <div
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                onPick(e.dataTransfer.files?.[0])
              }}
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/15 bg-navy-deep/40 px-6 py-8 text-center transition hover:border-ice/40"
            >
              <ImageIcon size={22} className="text-mist" />
              <p className="text-sm font-semibold text-white/85">
                {file ? file.name : 'Drop a SAR image or click to browse'}
              </p>
              <p className="text-[11px] text-mist">
                {file
                  ? `${(file.size / 1024).toFixed(0)} KB · ready to run through the detector`
                  : 'The image is sent to the local AURORA API; it is never uploaded anywhere else.'}
              </p>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onPick(e.target.files?.[0])}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-mist">
                <span className="font-semibold">Confidence threshold</span>
                <input
                  type="range"
                  min="0.1"
                  max="0.9"
                  step="0.05"
                  value={conf}
                  onChange={(e) => setConf(Number(e.target.value))}
                  className="w-40 accent-ice"
                />
                <span className="font-mono text-ice">{conf.toFixed(2)}</span>
              </label>
              <Button onClick={run} disabled={!file || running}>
                {running ? 'Running…' : 'Run detection'}
              </Button>
            </div>

            {detectError && (
              <div className="rounded-xl border border-danger/40 bg-danger/10 px-3.5 py-2.5 text-xs text-danger">
                {detectError}
              </div>
            )}

            {previewUrl && (
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-navy-deep">
                <div className="relative" style={{ aspectRatio: scale ? `${scale.w} / ${scale.h}` : undefined }}>
                  <img src={previewUrl} alt="uploaded SAR tile" className="h-full w-full object-contain" />
                  {scale &&
                    detections.map((d, i) => (
                      <div
                        key={i}
                        className="absolute border-2"
                        style={{
                          left: `${(d.bbox[0] / scale.w) * 100}%`,
                          top: `${(d.bbox[1] / scale.h) * 100}%`,
                          width: `${((d.bbox[2] - d.bbox[0]) / scale.w) * 100}%`,
                          height: `${((d.bbox[3] - d.bbox[1]) / scale.h) * 100}%`,
                          borderColor: d.confidence >= conf ? '#7DD3FC' : 'rgba(245,158,11,0.8)',
                        }}
                      >
                        <span
                          className="absolute -top-5 left-0 whitespace-nowrap rounded px-1 font-mono text-[9px]"
                          style={{
                            background: d.confidence >= conf ? '#7DD3FC' : '#F59E0B',
                            color: '#04070D',
                          }}
                        >
                          iceberg {d.confidence.toFixed(2)}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {result && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-mist">
                  <span>
                    <span className="font-semibold text-white">{result.detection_count}</span> detection(s)
                    · image {result.image_width} × {result.image_height} px · conf ≥ {result.confidence_threshold}
                  </span>
                  <span className="font-mono text-ice">{result.model}</span>
                </div>

                {detections.length === 0 && (
                  <p className="rounded-xl border border-white/10 bg-navy-deep/40 px-3.5 py-2.5 text-xs text-mist">
                    The detector returned no detection above the threshold for this tile.
                  </p>
                )}

                {detections.map((d, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-navy-deep/40 px-3.5 py-2 font-mono text-[11px]"
                  >
                    <span className="text-white/85">
                      {d.class} · bbox [{d.bbox.join(', ')}]
                    </span>
                    <span className="text-ice">conf {d.confidence.toFixed(3)}</span>
                  </div>
                ))}

                <div className="rounded-xl border border-warn/30 bg-warn/10 px-3.5 py-2.5 text-[11px] leading-relaxed text-warn">
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <AlertTriangle size={13} /> Pixel-space detection — georeferencing unavailable
                  </span>
                  <p className="mt-1 text-white/85">
                    {result.georeferencing?.status ??
                      'Detections are not converted to latitude/longitude, are not drawn on a map, and are not fed into route cost: the georeferencing step is unavailable in this repository.'}
                  </p>
                  <p className="mt-1 text-white/70">
                    Route status: {result.risk_status}
                    {result.iceberg_risk == null ? ' · iceberg_risk: null (nothing to route around)' : ''}
                  </p>
                </div>
              </div>
            )}

            {!result && !detectError && (
              <p className="text-[11px] leading-relaxed text-mist">
                No catalogue or live iceberg feed exists in this deployment, so there is nothing to
                plot until you run a detection yourself. Every number shown after a run comes from
                the detector's response.
              </p>
            )}
          </Card.Body>
        </Card>
      </div>

      <Card>
        <Card.Header
          title="Why no iceberg is shown on the map"
          subtitle="explicit absence statement"
          icon={AlertTriangle}
        />
        <Card.Body className="grid gap-2.5 sm:grid-cols-3">
          {[
            ['No positions are served', 'The API exposes detections from an image you supply, never a stored or simulated position.'],
            ['No georeferencing', 'Detections stay in pixel space, so they cannot honestly be placed on a map.'],
            ['No drift model is exposed', 'No trajectory or forecast-cone endpoint exists, so none is drawn.'],
          ].map(([k, why]) => (
            <div key={k} className="rounded-xl border border-white/10 bg-navy-deep/45 px-3.5 py-2.5">
              <p className="text-xs font-semibold text-white/90">{k}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-mist">{why}</p>
            </div>
          ))}
        </Card.Body>
      </Card>
    </div>
  )
}

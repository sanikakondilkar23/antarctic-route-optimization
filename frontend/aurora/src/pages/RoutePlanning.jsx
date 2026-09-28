import { useState } from 'react'
import {
  Route,
  Navigation,
  Fuel,
  CalendarDays,
  Gauge,
  ShieldCheck,
  CloudRain,
  Check,
  Download,
  Layers,
  ArrowLeftRight,
  MapPin,
  Zap,
  X,
  AlertTriangle,
  FileCode,
  Compass,
} from 'lucide-react'
import PageHeader, { LiveChip } from '../components/ui/PageHeader'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Button from '../components/ui/Button'
import AntarcticMap from '../components/map/AntarcticMap'
import { Marker, Popup } from 'react-leaflet'
import { STATIONS, getCorridorRoutes } from '../data'
import { cn } from '../lib/utils'

export default function RoutePlanning() {
  const [start, setStart] = useState('Cape Town')
  const [destination, setDestination] = useState('Bharati Research Station')
  const [vessel, setVessel] = useState('RV Bharati Explorer')
  const [date, setDate] = useState('2026-10-01')
  const [maxSpeed, setMaxSpeed] = useState(15)
  const [fuelPref, setFuelPref] = useState('Balanced')
  const [riskTolerance, setRiskTolerance] = useState('Low')
  const [selected, setSelected] = useState('opt-lowice')
  const [exported, setExported] = useState(false)
  const [comparing, setComparing] = useState(false)
  const [showRiskModal, setShowRiskModal] = useState(false)
  const [routeConfirmed, setRouteConfirmed] = useState(false)
  const [recomputing, setRecomputing] = useState(false)

  // Dynamically retrieve routes and polylines for chosen corridor
  const { options: routeOptions, polylines: currentPolylines } = getCorridorRoutes(start, destination)
  const selRoute = routeOptions.find((r) => r.id === selected) || routeOptions[0]

  const startStation = STATIONS.find((s) => s.name.includes(start)) || STATIONS[2]
  const destStation = STATIONS.find((s) => s.name.includes(destination)) || STATIONS[0]

  const selectRoute = (id) => {
    setSelected(id)
    setExported(false)
    setRouteConfirmed(false)
  }

  const handleGenerateRoutes = () => {
    setRecomputing(true)
    setTimeout(() => {
      setRecomputing(false)
    }, 800)
  }

  const handleConfirmRoute = () => {
    setRouteConfirmed(true)
    setTimeout(() => {
      setRouteConfirmed(false)
    }, 4000)
  }

  // Real GeoJSON file generation and download
  const exportRoute = () => {
    const rawCoords = currentPolylines[selRoute.id] || []
    // GeoJSON coordinates standard: [longitude, latitude]
    const geoJsonCoordinates = rawCoords.map(([lat, lon]) => [Number(lon.toFixed(4)), Number(lat.toFixed(4))])

    const geoJsonData = {
      type: 'FeatureCollection',
      metadata: {
        system: 'NAVIGLACE AI Antarctic Decision Support System',
        problemStatement: 'SIH-26059',
        disclaimer: 'Simulated operational planning data for prototype demonstration only',
        exportedAt: new Date().toISOString(),
        vessel: vessel,
        corridor: `${start} to ${destination}`,
        routeType: selRoute.label,
        distanceKm: selRoute.distance,
        distanceNm: selRoute.distanceNm,
        estimatedTime: selRoute.time,
        estimatedFuelTonnes: selRoute.fuel,
        iceRisk: selRoute.iceRisk,
        departureDate: date,
      },
      features: [
        {
          type: 'Feature',
          properties: {
            name: `${selRoute.label} Navigation Track`,
            corridor: `${start} to ${destination}`,
            routeId: selRoute.id,
            status: selRoute.status,
          },
          geometry: {
            type: 'LineString',
            coordinates: geoJsonCoordinates,
          },
        },
        ...rawCoords.map(([lat, lon], idx) => ({
          type: 'Feature',
          properties: {
            name: idx === 0 ? `Departure - ${start}` : idx === rawCoords.length - 1 ? `Arrival - ${destination}` : `Waypoint ${idx}`,
            waypointIndex: idx,
            latitude: lat,
            longitude: lon,
          },
          geometry: {
            type: 'Point',
            coordinates: [Number(lon.toFixed(4)), Number(lat.toFixed(4))],
          },
        })),
      ],
    }

    const blob = new Blob([JSON.stringify(geoJsonData, null, 2)], { type: 'application/geo+json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `polar_route_${selRoute.id}_${start.replace(/\s+/g, '_').toLowerCase()}_to_${destination.replace(/\s+/g, '_').toLowerCase()}.geojson`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    setExported(true)
    setTimeout(() => setExported(false), 3000)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Route Planning"
        subtitle="Design, evaluate, and compare simulated transits between Cape Town, Bharati, and Maitri research stations."
        actions={<LiveChip label="Simulated planner" dot="warn" />}
      />

      {routeConfirmed && (
        <div className="flex items-center justify-between rounded-2xl border border-safe/30 bg-safe/10 px-5 py-3 text-safe shadow-glow">
          <div className="flex items-center gap-2.5">
            <Check size={18} className="shrink-0" />
            <span className="text-sm font-semibold">
              Route confirmed for {vessel}! Navigational waypoint package generated for {start} → {destination}.
            </span>
          </div>
          <span className="text-xs font-mono opacity-80">{selRoute.label} · ETA {selRoute.time}</span>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
        {/* Input panel */}
        <Card className="h-fit">
          <Card.Header title="Voyage Parameters" subtitle="Define the transit corridor" icon={Route} />
          <Card.Body className="space-y-4">
            <label className="block">
              <span className="input-label">Starting location</span>
              <select
                className="input"
                value={start}
                onChange={(e) => {
                  setStart(e.target.value)
                  if (e.target.value === destination) {
                    setDestination(e.target.value === 'Cape Town' ? 'Bharati Research Station' : 'Cape Town')
                  }
                }}
              >
                {STATIONS.map((s) => (
                  <option key={s.id} value={s.name.includes('Bharati') ? 'Bharati Research Station' : s.name.includes('Maitri') ? 'Maitri Research Station' : 'Cape Town'} className="bg-navy-mid">
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="input-label">Destination</span>
              <select
                className="input"
                value={destination}
                onChange={(e) => {
                  setDestination(e.target.value)
                  if (e.target.value === start) {
                    setStart(e.target.value === 'Bharati Research Station' ? 'Cape Town' : 'Bharati Research Station')
                  }
                }}
              >
                {['Bharati Research Station', 'Maitri Research Station', 'Cape Town']
                  .filter((d) => d !== start)
                  .map((d) => (
                    <option key={d} value={d} className="bg-navy-mid">{d}</option>
                  ))}
              </select>
            </label>

            <label className="block">
              <span className="input-label">Vessel selection</span>
              <select className="input" value={vessel} onChange={(e) => setVessel(e.target.value)}>
                {['RV Bharati Explorer', 'RV Maitri Voyager', 'RV Polar Researcher', 'RV Polar Scout'].map((v) => (
                  <option key={v} value={v} className="bg-navy-mid">{v}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="input-label">Departure date</span>
              <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>

            <label className="block">
              <span className="input-label flex justify-between">
                <span>Maximum vessel speed</span>
                <span className="font-mono text-cyan">{maxSpeed} kn</span>
              </span>
              <input
                type="range"
                min="8"
                max="18"
                value={maxSpeed}
                onChange={(e) => setMaxSpeed(+e.target.value)}
                className="w-full accent-cyan"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="input-label">Fuel preference</span>
                <select className="input" value={fuelPref} onChange={(e) => setFuelPref(e.target.value)}>
                  {['Efficient', 'Balanced', 'Fastest'].map((f) => <option key={f} value={f} className="bg-navy-mid">{f}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="input-label">Risk tolerance</span>
                <select className="input" value={riskTolerance} onChange={(e) => setRiskTolerance(e.target.value)}>
                  {['Low', 'Moderate'].map((r) => <option key={r} value={r} className="bg-navy-mid">{r}</option>)}
                </select>
              </label>
            </div>

            <button
              className="btn-primary w-full"
              onClick={handleGenerateRoutes}
              disabled={recomputing}
            >
              <Zap size={15} className={recomputing ? 'animate-spin' : ''} />
              {recomputing ? 'Calculating alternatives…' : 'Generate Route Options'}
            </button>
          </Card.Body>
        </Card>

        {/* Map */}
        <Card className="overflow-hidden">
          <Card.Header
            title="Interactive Route Corridor"
            subtitle={`${start} → ${destination} · Multi-criteria Alternatives`}
            icon={Navigation}
            action={
              <div className="flex items-center gap-2">
                <span className="chip text-xs"><MapPin size={12} className="text-cyan" /> Origin & Target Plotted</span>
              </div>
            }
          />
          <div className="p-3">
            <AntarcticMap
              center={[(startStation.lat + destStation.lat) / 2, (startStation.lon + destStation.lon) / 2]}
              zoom={3}
              height={440}
              activeRoute={selected}
              customPolylines={currentPolylines}
              layers={{ vessels: true, icebergs: true, stations: true, routes: true, seaIce: true, wind: false, oceanCurrents: false }}
              className="!rounded-xl"
            >
              <Marker position={[startStation.lat, startStation.lon]}>
                <Popup>
                  <div className="min-w-[180px]">
                    <p className="font-bold text-white text-sm">Origin: {startStation.name}</p>
                    <p className="text-xs text-cyan">{startStation.country}</p>
                    <p className="text-[11px] font-mono text-mist mt-1">{startStation.lat.toFixed(2)}°S / {Math.abs(startStation.lon).toFixed(2)}°E</p>
                  </div>
                </Popup>
              </Marker>
              <Marker position={[destStation.lat, destStation.lon]}>
                <Popup>
                  <div className="min-w-[180px]">
                    <p className="font-bold text-white text-sm">Destination: {destStation.name}</p>
                    <p className="text-xs text-cyan">{destStation.country}</p>
                    <p className="text-[11px] font-mono text-mist mt-1">{destStation.lat.toFixed(2)}°S / {Math.abs(destStation.lon).toFixed(2)}°E</p>
                  </div>
                </Popup>
              </Marker>
            </AntarcticMap>
          </div>
        </Card>
      </div>

      {/* Route option cards */}
      <Card>
        <Card.Header
          title="Route Alternatives"
          subtitle={`Simulated options for ${start} → ${destination}`}
          icon={Layers}
          action={
            <button
              className="btn-secondary !px-3.5 !py-1.5 !text-xs"
              onClick={() => setComparing(true)}
            >
              <ArrowLeftRight size={13} /> Compare All Routes
            </button>
          }
        />
        <Card.Body>
          <div className="grid gap-4 lg:grid-cols-3">
            {routeOptions.map((r) => (
              <button
                key={r.id}
                onClick={() => selectRoute(r.id)}
                className={cn(
                  'rounded-2xl border p-5 text-left transition',
                  selected === r.id
                    ? 'border-cyan/60 bg-cyan/10 shadow-glow ring-1 ring-cyan/30'
                    : 'border-white/5 bg-navy-deep/40 hover:border-white/15'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-white">{r.label}</p>
                    <p className="text-[11px] uppercase tracking-wide text-cyan font-semibold">{r.tag}</p>
                  </div>
                  {selected === r.id ? (
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan text-navy shadow-glow">
                      <Check size={14} />
                    </span>
                  ) : (
                    <span className="text-[10px] text-mist/60 border border-white/10 px-2 py-0.5 rounded-full">Select</span>
                  )}
                </div>

                <div className="mt-4 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-mist">Track Distance</span>
                    <span className="font-mono font-semibold text-white">{r.distance.toLocaleString()} km ({r.distanceNm} nm)</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-mist">Voyage Duration</span>
                    <span className="font-mono font-semibold text-white">{r.time}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-mist">Estimated Fuel</span>
                    <span className="font-mono font-semibold text-white">{r.fuel} tonnes</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-mist">Ice Risk</span>
                    <Badge value={r.iceRisk} />
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-mist">Weather Risk</span>
                    <Badge value={r.weatherRisk} />
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-white/5 pt-3">
                  <Badge value={r.status === 'Recommended' ? 'Recommended' : 'Available'} />
                  <span className="text-[11px] text-mist truncate">{r.options[0]}</span>
                </div>
              </button>
            ))}
          </div>
        </Card.Body>
      </Card>

      {/* Selected route detail */}
      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden">
          <Card.Header
            title="Selected Route Analysis"
            subtitle={`${selRoute.label} · ${vessel} · Corridor: ${start} → ${destination}`}
            icon={Navigation}
            action={<Badge value={selRoute.status} />}
          />
          <Card.Body>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-mist">Route Attributes & Safeguards</p>
                {selRoute.options.map((o) => (
                  <div key={o} className="flex items-start gap-2.5 rounded-xl border border-white/5 bg-navy-deep/50 px-3.5 py-2 text-xs text-white/85">
                    <ShieldCheck size={14} className="mt-0.5 shrink-0 text-safe" />
                    <span>{o}</span>
                  </div>
                ))}
              </div>

              <div className="space-y-2.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-mist">Voyage Performance Indices</p>
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    [Fuel, 'Est. Fuel', `${selRoute.fuel} tonnes`],
                    [Navigation, 'Voyage Time', selRoute.time],
                    [Gauge, 'Avg Speed', `${Math.round(maxSpeed * 0.76)} kn`],
                    [CalendarDays, 'Departure', date],
                    [Compass, 'Waypoints', `${selRoute.waypointsCount || 8} points`],
                    [CloudRain, 'Weather Risk', `${selRoute.weatherRiskScore || 45}/100`],
                  ].map(([Icon, l, v]) => (
                    <div key={l} className="rounded-xl border border-white/5 bg-navy-deep/50 p-3">
                      <Icon size={14} className="text-cyan" />
                      <p className="mt-1 text-sm font-semibold text-white">{v}</p>
                      <p className="text-[10px] uppercase tracking-wider text-mist">{l}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card.Body>
        </Card>

        <Card className="h-fit">
          <Card.Header title="Navigation Actions" icon={Zap} />
          <Card.Body className="space-y-3">
            <Button className="w-full" onClick={handleConfirmRoute}>
              <Navigation size={15} /> Confirm & Dispatch Route
            </Button>
            <Button variant="secondary" className="w-full" onClick={exportRoute}>
              <Download size={15} /> {exported ? 'GeoJSON Exported ✓' : 'Export Valid GeoJSON'}
            </Button>
            <Button variant="secondary" className="w-full" onClick={() => setShowRiskModal(true)}>
              <CloudRain size={15} /> View Risk Breakdown
            </Button>

            {exported && (
              <p className="rounded-xl border border-safe/20 bg-safe/10 px-3 py-2 text-center text-xs text-safe font-medium">
                Standard GeoJSON FeatureCollection downloaded to device.
              </p>
            )}

            <div className="mt-1 rounded-xl border border-white/5 bg-navy-deep/50 p-3 text-[11px] leading-relaxed text-mist">
              <span className="font-semibold text-white/80 block mb-0.5">Maritime Safety Note:</span>
              Alternative routes are simulated by mathematical optimization for this prototype. Real Antarctic
              navigation requires verified hydrographic charting, marine radar, and master ice-pilot approval.
            </div>
          </Card.Body>
        </Card>
      </div>

      {/* Compare Routes Modal */}
      {comparing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-deep/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-3xl border border-white/10 bg-navy p-6 shadow-2xl scrollbar-thin">
            <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-5">
              <div>
                <h3 className="font-display text-xl font-bold text-white flex items-center gap-2">
                  <ArrowLeftRight size={18} className="text-cyan" />
                  Route Comparison: {start} → {destination}
                </h3>
                <p className="text-xs text-mist mt-0.5">Multi-criteria comparative trade-off matrix</p>
              </div>
              <button
                onClick={() => setComparing(false)}
                className="rounded-xl p-2 text-mist hover:bg-white/5 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {routeOptions.map((r) => {
                const isCurrent = selected === r.id
                return (
                  <div
                    key={r.id}
                    className={cn(
                      'rounded-2xl border p-5 flex flex-col justify-between transition',
                      isCurrent
                        ? 'border-cyan bg-cyan/10 shadow-glow'
                        : 'border-white/10 bg-navy-deep/60'
                    )}
                  >
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs uppercase font-bold text-cyan">{r.tag}</span>
                        <Badge value={r.status} />
                      </div>
                      <h4 className="font-bold text-white text-base">{r.label}</h4>

                      <div className="mt-4 space-y-3 text-xs border-t border-b border-white/10 py-3">
                        <div className="flex justify-between">
                          <span className="text-mist">Distance</span>
                          <span className="font-mono font-bold text-white">{r.distance.toLocaleString()} km ({r.distanceNm} nm)</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-mist">Transit Time</span>
                          <span className="font-mono font-bold text-white">{r.time}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-mist">Fuel Consumption</span>
                          <span className="font-mono font-bold text-white">{r.fuel} tonnes</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-mist">Ice Risk Index</span>
                          <span className={cn('font-mono font-bold', r.iceRisk === 'High' ? 'text-danger' : r.iceRisk === 'Moderate' ? 'text-warn' : 'text-safe')}>
                            {r.iceRiskScore || 50} / 100 ({r.iceRisk})
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-mist">Weather Risk</span>
                          <span className="font-mono font-bold text-white">{r.weatherRiskScore || 40} / 100</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-mist">Estimated CO₂</span>
                          <span className="font-mono font-bold text-white">{r.co2Tonnes || 1800} tonnes</span>
                        </div>
                      </div>

                      <div className="mt-3 space-y-1.5 text-[11px] text-mist">
                        <p className="font-semibold text-white/80">Key Operational Features:</p>
                        {r.options.map((opt, i) => (
                          <div key={i} className="flex items-start gap-1.5">
                            <span className="text-cyan">•</span>
                            <span>{opt}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-6 pt-4 border-t border-white/5">
                      <Button
                        variant={isCurrent ? 'primary' : 'secondary'}
                        className="w-full text-xs"
                        onClick={() => {
                          setSelected(r.id)
                          setComparing(false)
                        }}
                      >
                        {isCurrent ? 'Active Route' : 'Select This Route'}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Risk Breakdown Modal */}
      {showRiskModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-deep/80 backdrop-blur-sm p-4">
          <div className="relative w-full max-w-2xl rounded-3xl border border-white/10 bg-navy p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
              <h3 className="font-display text-lg font-bold text-white flex items-center gap-2">
                <AlertTriangle size={18} className="text-warn" />
                Navigational Risk Assessment: {selRoute.label}
              </h3>
              <button onClick={() => setShowRiskModal(false)} className="rounded-xl p-2 text-mist hover:bg-white/5 hover:text-white">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="rounded-xl border border-warn/20 bg-warn/10 p-3.5 text-warn">
                <p className="font-bold mb-1">Polar Code Risk Category B / C</p>
                <p className="text-white/85 leading-relaxed">
                  The vessel is scheduled to enter waters with potential multi-year sea ice presence between 62°S and 70°S.
                  Continuous radar monitoring and optical searchlights required during twilight.
                </p>
              </div>

              <div className="rounded-xl border border-white/5 bg-navy-deep/50 p-3.5 space-y-2">
                <p className="font-semibold text-white">Proximate Iceberg Threats:</p>
                <div className="space-y-1.5 text-mist">
                  <div className="flex justify-between">
                    <span>Demo-ICE-001 (Tabular, 26 km²)</span>
                    <span className="font-mono text-danger font-bold">12 km to corridor</span>
                  </div>
                  <div className="flex justify-between">
                    <span>A23A fragment cluster</span>
                    <span className="font-mono text-warn font-semibold">42 km to corridor</span>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-white/5 bg-navy-deep/50 p-3.5 space-y-2">
                <p className="font-semibold text-white">Katabatic Wind & Sea-State Advisory:</p>
                <p className="text-mist leading-relaxed">
                  Continental margin approaches to Bharati and Maitri regularly experience violent katabatic wind events
                  reaching 50–65 knots. Recommended entry window is between 04:00 and 10:00 UTC.
                </p>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <Button onClick={() => setShowRiskModal(false)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
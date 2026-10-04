import { useState } from 'react'
import { AlertTriangle, Compass, MapPin, Navigation } from 'lucide-react'

export default function HeroRouteSvg() {
  const [activeHazard, setActiveHazard] = useState(null)
  const [activeWaypoint, setActiveWaypoint] = useState(null)

  const hazards = [
    {
      id: 'h1',
      cx: 480,
      cy: 380,
      r: 26,
      label: 'High Density Pack Ice',
      meta: 'SIC > 0.88 · Multi-Year Ice Zone',
      distance: '1,420 km from start',
    },
    {
      id: 'h2',
      cx: 760,
      cy: 230,
      r: 32,
      label: 'Calved Iceberg Cluster',
      meta: 'SAR Tile Detected · Size > 350m',
      distance: '2,980 km from start',
    },
    {
      id: 'h3',
      cx: 890,
      cy: 280,
      r: 22,
      label: 'Marginal Ice Zone Chokepoint',
      meta: 'Rapid Dynamic Drift · 1.4 kn',
      distance: '3,840 km from start',
    },
  ]

  const waypoints = [
    { id: 'wp-start', cx: 140, cy: 530, name: 'Cape Town Offshore', latLon: '33.9° S, 18.4° E' },
    { id: 'wp-1', cx: 320, cy: 490, name: 'Sub-Antarctic Waypoint Alpha', latLon: '44.2° S, 24.1° E' },
    { id: 'wp-2', cx: 580, cy: 340, name: 'MIZ Entry Waypoint Bravo', latLon: '58.5° S, 18.0° E' },
    { id: 'wp-3', cx: 770, cy: 300, name: 'Safe Ice Corridor Charlie', latLon: '64.8° S, 14.5° E' },
    { id: 'wp-4', cx: 950, cy: 190, name: 'Approaching Shelf Delta', latLon: '68.9° S, 12.8° E' },
    { id: 'wp-goal', cx: 1070, cy: 120, name: 'Maitri Station Goal', latLon: '70.77° S, 11.73° E' },
  ]

  return (
    <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
      <svg
        viewBox="0 0 1200 680"
        preserveAspectRatio="xMidYMid slice"
        className="w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          {/* Layered glowing cyan filter */}
          <filter id="cyan-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Intense hazard red glow filter */}
          <filter id="hazard-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Linear gradient for trajectory path */}
          <linearGradient id="route-gradient" x1="0%" y1="100%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3AA7FF" stopOpacity="0.8" />
            <stop offset="50%" stopColor="#22E5F0" stopOpacity="1" />
            <stop offset="100%" stopColor="#A9DFFF" stopOpacity="0.9" />
          </linearGradient>

          {/* Vessel wake gradient */}
          <radialGradient id="wake-gradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#22E5F0" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#05182B" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Ambient coordinate grid lines */}
        <g stroke="rgba(34, 229, 240, 0.05)" strokeWidth="1" strokeDasharray="3 6">
          <line x1="0" y1="200" x2="1200" y2="200" />
          <line x1="0" y1="360" x2="1200" y2="360" />
          <line x1="0" y1="520" x2="1200" y2="520" />
          <line x1="300" y1="0" x2="300" y2="680" />
          <line x1="600" y1="0" x2="600" y2="680" />
          <line x1="900" y1="0" x2="900" y2="680" />
        </g>

        {/* Hazard Iceberg Avoidance Zones with Pulsing Rings */}
        {hazards.map((h) => (
          <g
            key={h.id}
            className="pointer-events-auto cursor-pointer"
            onMouseEnter={() => setActiveHazard(h)}
            onMouseLeave={() => setActiveHazard(null)}
          >
            {/* Outer expanding pulse ring */}
            <circle
              cx={h.cx}
              cy={h.cy}
              r={h.r}
              fill="none"
              stroke="#FF4D5E"
              strokeWidth="1.5"
              className="hazard-ring-animated"
            />
            {/* Inner danger field */}
            <circle
              cx={h.cx}
              cy={h.cy}
              r={h.r * 0.65}
              fill="rgba(255, 77, 94, 0.15)"
              stroke="#FF4D5E"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              filter="url(#hazard-glow)"
              className="hazard-center-animated"
            />
            {/* Warning triangle center */}
            <g transform={`translate(${h.cx - 8}, ${h.cy - 8})`}>
              <polygon
                points="8,0 16,16 0,16"
                fill="#FF4D5E"
                opacity="0.9"
              />
              <circle cx="8" cy="12" r="1" fill="#05182B" />
              <line x1="8" y1="5" x2="8" y2="10" stroke="#05182B" strokeWidth="1.5" strokeLinecap="round" />
            </g>
            <text
              x={h.cx}
              y={h.cy + h.r + 14}
              textAnchor="middle"
              fill="#FF808E"
              fontSize="10"
              fontFamily="Space Grotesk, sans-serif"
              fontWeight="600"
              letterSpacing="0.08em"
              className="uppercase drop-shadow"
            >
              Hazard Zone
            </text>
          </g>
        ))}

        {/* Primary Safe Route Trajectory (A* Evaluated Corridor) */}
        {/* Glow halo underlay */}
        <path
          d="M 140 530 C 320 500, 430 450, 580 340 S 840 280, 950 190 S 1030 145, 1070 120"
          fill="none"
          stroke="#22E5F0"
          strokeWidth="6"
          strokeOpacity="0.3"
          filter="url(#cyan-glow)"
        />

        {/* Flowing Dashed Route Line */}
        <path
          d="M 140 530 C 320 500, 430 450, 580 340 S 840 280, 950 190 S 1030 145, 1070 120"
          fill="none"
          stroke="url(#route-gradient)"
          strokeWidth="3.2"
          strokeDasharray="14 10"
          strokeLinecap="round"
          className="route-dash-animated"
          filter="url(#cyan-glow)"
        />

        {/* Waypoint Nodes along the path */}
        {waypoints.map((wp, idx) => (
          <g
            key={wp.id}
            className="pointer-events-auto cursor-pointer"
            onMouseEnter={() => setActiveWaypoint(wp)}
            onMouseLeave={() => setActiveWaypoint(null)}
          >
            {/* Outer halo */}
            <circle
              cx={wp.cx}
              cy={wp.cy}
              r="8"
              fill="rgba(34, 229, 240, 0.2)"
              stroke="#22E5F0"
              strokeWidth="1.2"
              className="waypoint-node"
            />
            {/* Inner solid node */}
            <circle
              cx={wp.cx}
              cy={wp.cy}
              r="3.5"
              fill="#FFFFFF"
              filter="url(#cyan-glow)"
            />
            {/* Index label */}
            <text
              x={wp.cx}
              y={wp.cy - 12}
              textAnchor="middle"
              fill="#A9DFFF"
              fontSize="9"
              fontFamily="Space Grotesk, sans-serif"
              fontWeight="600"
              letterSpacing="0.05em"
              className="drop-shadow-sm select-none"
            >
              {idx === 0 ? 'START' : idx === waypoints.length - 1 ? 'GOAL' : `WP-0${idx}`}
            </text>
          </g>
        ))}

        {/* Ship Icon & Wake near bottom-left (Cape Town approach) */}
        <g transform="translate(140, 530)">
          {/* Wake ripple */}
          <ellipse cx="-20" cy="8" rx="35" ry="12" fill="url(#wake-gradient)" />
          {/* Hull representation */}
          <g transform="translate(-16, -16) rotate(-25)">
            <path
              d="M 4 28 L 28 28 L 32 14 L 16 2 L 0 14 Z"
              fill="#071D33"
              stroke="#22E5F0"
              strokeWidth="1.5"
              filter="url(#cyan-glow)"
            />
            <rect x="10" y="12" width="12" height="8" rx="2" fill="#22E5F0" opacity="0.85" />
            <circle cx="16" cy="8" r="1.5" fill="#FFFFFF" />
          </g>
          {/* Ship Telemetry Badge */}
          <g transform="translate(20, -5)">
            <rect
              x="0"
              y="-12"
              width="105"
              height="22"
              rx="4"
              fill="rgba(7, 29, 51, 0.85)"
              stroke="rgba(34, 229, 240, 0.4)"
              strokeWidth="1"
            />
            <text
              x="8"
              y="3"
              fill="#EAF6FF"
              fontSize="10"
              fontFamily="Space Grotesk, sans-serif"
              fontWeight="700"
              letterSpacing="0.04em"
            >
              R/V POLARIS
            </text>
            <circle cx="94" cy="0" r="3" fill="#22E5F0" className="animate-ping" />
          </g>
        </g>

        {/* Destination Pin (Maitri Station Goal) */}
        <g transform="translate(1070, 120)" className="dest-pin-animated">
          {/* Base beacon waves */}
          <ellipse cx="0" cy="18" rx="18" ry="6" fill="rgba(34, 229, 240, 0.15)" stroke="#22E5F0" strokeWidth="0.8" />
          <ellipse cx="0" cy="18" rx="10" ry="3.5" fill="rgba(34, 229, 240, 0.3)" />

          {/* Glowing pin head */}
          <g transform="translate(-12, -26)">
            <path
              d="M 12 0 C 5.37 0 0 5.37 0 12 C 0 20 12 32 12 32 C 12 32 24 20 24 12 C 24 5.37 18.63 0 12 0 Z"
              fill="#0A2A4A"
              stroke="#22E5F0"
              strokeWidth="2"
              filter="url(#cyan-glow)"
            />
            <circle cx="12" cy="11" r="4.5" fill="#22E5F0" />
            <circle cx="12" cy="11" r="2" fill="#FFFFFF" />
          </g>

          {/* Destination Station Tag */}
          <g transform="translate(-140, -18)">
            <rect
              x="0"
              y="0"
              width="125"
              height="24"
              rx="4"
              fill="rgba(5, 24, 43, 0.9)"
              stroke="rgba(34, 229, 240, 0.5)"
              strokeWidth="1"
            />
            <text
              x="8"
              y="16"
              fill="#EAF6FF"
              fontSize="10"
              fontFamily="Space Grotesk, sans-serif"
              fontWeight="700"
            >
              Maitri Station (70.8°S)
            </text>
          </g>
        </g>
      </svg>

      {/* Floating Interactive Tooltip for Active Hazard */}
      {activeHazard && (
        <div
          className="absolute z-20 pointer-events-auto transform -translate-x-1/2 -translate-y-full mb-3 px-3.5 py-2.5 rounded-xl glass-panel-elevated text-xs border border-hazard-red/40 shadow-2xl transition-all duration-200"
          style={{
            left: `${(activeHazard.cx / 1200) * 100}%`,
            top: `${(activeHazard.cy / 680) * 100}%`,
          }}
        >
          <div className="flex items-center gap-1.5 font-bold text-[#FF4D5E] text-xs">
            <AlertTriangle size={13} />
            <span>{activeHazard.label}</span>
          </div>
          <div className="text-[11px] text-mist mt-1 font-mono">{activeHazard.meta}</div>
          <div className="text-[10px] text-[#A9DFFF] mt-0.5 font-mono">{activeHazard.distance}</div>
          <div className="text-[10px] text-emerald-400 mt-1 font-semibold">✓ A* Safety Bypass Route Generated</div>
        </div>
      )}

      {/* Floating Interactive Tooltip for Active Waypoint */}
      {activeWaypoint && (
        <div
          className="absolute z-20 pointer-events-auto transform -translate-x-1/2 -translate-y-full mb-3 px-3.5 py-2.5 rounded-xl glass-panel text-xs border border-cyan/40 shadow-2xl transition-all duration-200"
          style={{
            left: `${(activeWaypoint.cx / 1200) * 100}%`,
            top: `${(activeWaypoint.cy / 680) * 100}%`,
          }}
        >
          <div className="flex items-center gap-1.5 font-bold text-[#22E5F0] text-xs">
            <MapPin size={13} />
            <span>{activeWaypoint.name}</span>
          </div>
          <div className="text-[11px] text-white/90 mt-1 font-mono">{activeWaypoint.latLon}</div>
          <div className="text-[10px] text-mist mt-0.5">8-Connected Navigable Sea Corridor</div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------
// NAVIGLACE AI — Demo data
// All metrics, positions, and drift forecasts are simulated seeds for demo purposes. only.
// They are NOT live satellite / oceanographic observations and must
// not be used for real navigation decisions.
// ------------------------------------------------------------------

export const CURRENT_TS = '2026-09-18T06:42:00Z'

export function fmtTimestamp() {
  const d = new Date()
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

export const STATIONS = [
  { id: 'bharati', name: 'Bharati Research Station', lat: -69.4106, lon: 76.1968, country: 'India', type: 'station' },
  { id: 'maitri', name: 'Maitri Research Station', lat: -70.7655, lon: 11.7317, country: 'India', type: 'station' },
  { id: 'cape-town', name: 'Cape Town', lat: -33.9249, lon: 18.4241, country: 'South Africa', type: 'port' },
]

// ------------------------------------------------------------------
// Ships / fleet
// ------------------------------------------------------------------
export const ships = [
  {
    id: 'RVX-2024-001',
    name: 'RV Bharati Explorer',
    nameKey: 'bharati-explorer',
    status: 'En Route',
    lat: -59.42,
    lon: 41.83,
    speed: 13.4,
    heading: 158,
    fuel: 72,
    fuelRange: 6400,
    iceRisk: 'Low',
    destination: 'Bharati Research Station',
    eta: '11 days',
    lastUpdate: '6 min ago',
    crew: 52,
    flag: 'India',
    mission: 'Summer resupply & oceanographic survey',
    currentRoute: 'Cape Town → Bharati',
    officers: [
      { name: 'Capt. Sameer Nair', role: 'Master' },
      { name: 'Dr. Priya Menon', role: 'Chief Scientist' },
    ],
  },
  {
    id: 'RVX-2023-014',
    name: 'RV Maitri Voyager',
    nameKey: 'maitri-voyager',
    status: 'Monitoring',
    lat: -68.11,
    lon: 13.09,
    speed: 6.2,
    heading: 211,
    fuel: 54,
    fuelRange: 4100,
    iceRisk: 'Moderate',
    destination: 'Maitri Research Station',
    eta: '4 days',
    lastUpdate: '3 min ago',
    crew: 48,
    flag: 'India',
    mission: 'Littoral ice-zone monitoring',
    currentRoute: 'Prydz Bay drift',
    officers: [
      { name: 'Capt. Vikram Rao', role: 'Master' },
      { name: 'Dr. Sujata Kulkarni', role: 'Glaciologist' },
    ],
  },
  {
    id: 'RVX-2025-007',
    name: 'RV Polar Researcher',
    nameKey: 'polar-researcher',
    status: 'At Station',
    lat: -70.7655,
    lon: 11.7317,
    speed: 0,
    heading: 0,
    fuel: 81,
    fuelRange: 5200,
    iceRisk: 'Low',
    destination: 'Maitri Research Station',
    eta: 'Docked',
    lastUpdate: '11 min ago',
    crew: 44,
    flag: 'India',
    mission: 'Station logistics support',
    currentRoute: 'Moored — Maitri',
    officers: [
      { name: 'Capt. Anil Chandra', role: 'Master' },
      { name: 'Dr. Rakesh Iyer', role: 'Scientist-in-charge' },
    ],
  },
  {
    id: 'RVX-2019-021',
    name: 'RV Polar Scout (Patrol)',
    nameKey: 'polar-scout',
    status: 'Alert',
    lat: -62.88,
    lon: 55.44,
    speed: 9.8,
    heading: 94,
    fuel: 38,
    fuelRange: 2900,
    iceRisk: 'High',
    destination: 'Bharati Research Station',
    eta: '2 days',
    lastUpdate: '12 min ago',
    crew: 39,
    flag: 'India',
    mission: 'Rapid-response ice reconnaissance',
    currentRoute: 'Diversion — ice encounter',
    officers: [
      { name: 'Capt. Meera Pillai', role: 'Master' },
      { name: 'Dr. Arjun Das', role: 'Field Physicist' },
    ],
  },
]

// ------------------------------------------------------------------
// Icebergs
// ------------------------------------------------------------------
export const icebergs = [
  {
    id: 'A23A',
    lat: -66.42,
    lon: -36.71,
    speed: 1.8,
    direction: 'WSW',
    bearingDeg: 245,
    distanceToRoute: 42,
    risk: 'High',
    areaKm2: 3910,
    thicknessM: 380,
    origin: 'Filchner–Ronne Ice Shelf',
    lastObservation: '2026-09-17',
    forecast24h: { lat: -66.62, lon: -37.28, speed: 1.7, bearing: 242, uncertaintyKm: 4.8 },
    forecast48h: { lat: -66.85, lon: -37.89, speed: 1.6, bearing: 238, uncertaintyKm: 9.5 },
  },
  {
    id: 'B22A',
    lat: -67.88,
    lon: -40.12,
    speed: 0.9,
    direction: 'W',
    bearingDeg: 270,
    distanceToRoute: 88,
    risk: 'Moderate',
    areaKm2: 510,
    thicknessM: 260,
    origin: 'Thwaites Ice Shelf',
    lastObservation: '2026-09-16',
    forecast24h: { lat: -67.92, lon: -40.55, speed: 0.9, bearing: 268, uncertaintyKm: 3.2 },
    forecast48h: { lat: -67.98, lon: -41.02, speed: 0.8, bearing: 265, uncertaintyKm: 6.4 },
  },
  {
    id: 'Demo-ICE-001',
    lat: -58.15,
    lon: 38.24,
    speed: 2.4,
    direction: 'E',
    bearingDeg: 90,
    distanceToRoute: 12,
    risk: 'Critical',
    areaKm2: 26.4,
    thicknessM: 190,
    origin: 'Shackleton Ice Shelf',
    lastObservation: '2026-09-17',
    forecast24h: { lat: -58.12, lon: 39.22, speed: 2.3, bearing: 92, uncertaintyKm: 5.5 },
    forecast48h: { lat: -58.08, lon: 40.24, speed: 2.2, bearing: 95, uncertaintyKm: 11.0 },
  },
  {
    id: 'D-35',
    lat: -63.5,
    lon: 48.9,
    speed: 1.1,
    direction: 'NNE',
    bearingDeg: 30,
    distanceToRoute: 65,
    risk: 'Low',
    areaKm2: 31,
    thicknessM: 210,
    origin: 'Amery Ice Shelf',
    lastObservation: '2026-09-16',
    forecast24h: { lat: -63.15, lon: 49.2, speed: 1.0, bearing: 28, uncertaintyKm: 3.8 },
    forecast48h: { lat: -62.78, lon: 49.52, speed: 1.0, bearing: 25, uncertaintyKm: 7.2 },
  },
  {
    id: 'A-80C',
    lat: -69.9,
    lon: 18.3,
    speed: 0.6,
    direction: 'N',
    bearingDeg: 0,
    distanceToRoute: 154,
    risk: 'Low',
    areaKm2: 4.2,
    thicknessM: 140,
    origin: 'Dronning Maud Land coast',
    lastObservation: '2026-09-15',
    forecast24h: { lat: -69.65, lon: 18.35, speed: 0.6, bearing: 5, uncertaintyKm: 2.5 },
    forecast48h: { lat: -69.4, lon: 18.4, speed: 0.5, bearing: 8, uncertaintyKm: 5.0 },
  },
  {
    id: 'Demo-ICE-002',
    lat: -57.7,
    lon: -21.5,
    speed: 1.5,
    direction: 'SE',
    bearingDeg: 135,
    distanceToRoute: 94,
    risk: 'Moderate',
    areaKm2: 8.9,
    thicknessM: 175,
    origin: 'Weddell Gyre',
    lastObservation: '2026-09-17',
    forecast24h: { lat: -58.05, lon: -20.95, speed: 1.4, bearing: 138, uncertaintyKm: 4.0 },
    forecast48h: { lat: -58.42, lon: -20.35, speed: 1.4, bearing: 140, uncertaintyKm: 8.2 },
  },
  {
    id: 'C19C',
    lat: -60.25,
    lon: -59.3,
    speed: 1.3,
    direction: 'NW',
    bearingDeg: 315,
    distanceToRoute: 132,
    risk: 'Low',
    areaKm2: 12,
    thicknessM: 160,
    origin: 'Ronne Ice Shelf',
    lastObservation: '2026-09-14',
    forecast24h: { lat: -59.95, lon: -59.8, speed: 1.2, bearing: 312, uncertaintyKm: 3.5 },
    forecast48h: { lat: -59.62, lon: -60.35, speed: 1.1, bearing: 308, uncertaintyKm: 7.0 },
  },
  {
    id: 'Demo-ICE-003',
    lat: -61.9,
    lon: 61.7,
    speed: 2.1,
    direction: 'SSW',
    bearingDeg: 200,
    distanceToRoute: 28,
    risk: 'High',
    areaKm2: 17.6,
    thicknessM: 185,
    origin: 'Moscow University Ice Shelf',
    lastObservation: '2026-09-17',
    forecast24h: { lat: -62.38, lon: 61.42, speed: 2.0, bearing: 198, uncertaintyKm: 5.2 },
    forecast48h: { lat: -62.88, lon: 61.12, speed: 1.9, bearing: 195, uncertaintyKm: 10.4 },
  },
]

// Historical & forecasted trajectories for tracked icebergs (lat, lon over 8 weeks + 24/48h)
export const icebergTrajectories = [
  {
    id: 'A23A',
    points: [
      { t: 'Wk 1', lat: -63.1, lon: -29.4 },
      { t: 'Wk 2', lat: -63.9, lon: -31.6 },
      { t: 'Wk 3', lat: -64.7, lon: -33.1 },
      { t: 'Wk 4', lat: -65.3, lon: -34.8 },
      { t: 'Wk 5', lat: -65.9, lon: -35.9 },
      { t: 'Wk 6', lat: -66.2, lon: -36.4 },
      { t: 'Wk 7', lat: -66.4, lon: -36.9 },
      { t: 'Wk 8', lat: -66.42, lon: -36.71 },
    ],
    forecast: [
      { t: '+24h', lat: -66.62, lon: -37.28 },
      { t: '+48h', lat: -66.85, lon: -37.89 },
    ],
  },
  {
    id: 'B22A',
    points: [
      { t: 'Wk 1', lat: -65.4, lon: -35.6 },
      { t: 'Wk 2', lat: -65.9, lon: -36.8 },
      { t: 'Wk 3', lat: -66.5, lon: -37.9 },
      { t: 'Wk 4', lat: -67.0, lon: -38.8 },
      { t: 'Wk 5', lat: -67.4, lon: -39.6 },
      { t: 'Wk 6', lat: -67.7, lon: -40.0 },
      { t: 'Wk 7', lat: -67.9, lon: -40.3 },
      { t: 'Wk 8', lat: -67.88, lon: -40.12 },
    ],
    forecast: [
      { t: '+24h', lat: -67.92, lon: -40.55 },
      { t: '+48h', lat: -67.98, lon: -41.02 },
    ],
  },
  {
    id: 'Demo-ICE-001',
    points: [
      { t: 'Wk 1', lat: -61.9, lon: 31.2 },
      { t: 'Wk 2', lat: -60.8, lon: 33.4 },
      { t: 'Wk 3', lat: -59.7, lon: 35.1 },
      { t: 'Wk 4', lat: -58.9, lon: 36.6 },
      { t: 'Wk 5', lat: -58.4, lon: 37.6 },
      { t: 'Wk 6', lat: -58.2, lon: 38.0 },
      { t: 'Wk 7', lat: -58.16, lon: 38.2 },
      { t: 'Wk 8', lat: -58.15, lon: 38.24 },
    ],
    forecast: [
      { t: '+24h', lat: -58.12, lon: 39.22 },
      { t: '+48h', lat: -58.08, lon: 40.24 },
    ],
  },
  {
    id: 'D-35',
    points: [
      { t: 'Wk 1', lat: -65.2, lon: 47.1 },
      { t: 'Wk 2', lat: -64.8, lon: 47.5 },
      { t: 'Wk 3', lat: -64.4, lon: 47.9 },
      { t: 'Wk 4', lat: -64.1, lon: 48.3 },
      { t: 'Wk 5', lat: -63.9, lon: 48.5 },
      { t: 'Wk 6', lat: -63.7, lon: 48.7 },
      { t: 'Wk 7', lat: -63.6, lon: 48.8 },
      { t: 'Wk 8', lat: -63.5, lon: 48.9 },
    ],
    forecast: [
      { t: '+24h', lat: -63.15, lon: 49.2 },
      { t: '+48h', lat: -62.78, lon: 49.52 },
    ],
  },
  {
    id: 'Demo-ICE-003',
    points: [
      { t: 'Wk 1', lat: -59.8, lon: 63.5 },
      { t: 'Wk 2', lat: -60.2, lon: 63.1 },
      { t: 'Wk 3', lat: -60.6, lon: 62.7 },
      { t: 'Wk 4', lat: -61.0, lon: 62.3 },
      { t: 'Wk 5', lat: -61.3, lon: 62.0 },
      { t: 'Wk 6', lat: -61.6, lon: 61.8 },
      { t: 'Wk 7', lat: -61.8, lon: 61.7 },
      { t: 'Wk 8', lat: -61.9, lon: 61.7 },
    ],
    forecast: [
      { t: '+24h', lat: -62.38, lon: 61.42 },
      { t: '+48h', lat: -62.88, lon: 61.12 },
    ],
  },
]

// ------------------------------------------------------------------
// Alerts
// ------------------------------------------------------------------
export const alerts = [
  {
    id: 'ALT-1042',
    category: 'Iceberg Alert',
    severity: 'Critical',
    title: 'Large iceberg drifting near planned route corridor',
    description: 'Demo-ICE-001 is projected to intersect the Cape Town → Bharati corridor within the next 24–48 hours. Rerouting is recommended.',
    location: '58.1°S 38.2°E',
    time: '18 min ago',
    status: 'Active',
  },
  {
    id: 'ALT-1041',
    category: 'Sea-Ice Alert',
    severity: 'Warning',
    title: 'Sea-ice concentration increasing north of Prydz Bay',
    description: 'Concentration rising from 55% to 78% across the approach lanes to Bharati. Conditions may require icebreaker support.',
    location: 'Prydz Bay approach',
    time: '41 min ago',
    status: 'Active',
  },
  {
    id: 'ALT-1040',
    category: 'Route Deviation',
    severity: 'Warning',
    title: 'RV Polar Scout deviating from filed route',
    description: 'Vessel is 14 km off the planned track while avoiding compact ice. New waypoints have been sent to the bridge.',
    location: '55.4°E sector',
    time: '1 h ago',
    status: 'Monitoring',
  },
  {
    id: 'ALT-1039',
    category: 'Weather Alert',
    severity: 'Warning',
    title: 'Wind gust forecast above 55 knots along route',
    description: 'A synoptic depression is expected to bring storm-force winds across the mid-latitude transit lanes within 48 hours.',
    location: '55–65°S, 20–40°E',
    time: '2 h ago',
    status: 'Active',
  },
  {
    id: 'ALT-1038',
    category: 'Sea-Ice Alert',
    severity: 'Information',
    title: 'New ice edge definition applied to dataset',
    description: 'The sea-ice concentration product was refreshed. Marginal ice zone boundary has shifted 22 km southward.',
    location: 'Regional product',
    time: '5 h ago',
    status: 'Resolved',
  },
  {
    id: 'ALT-1037',
    category: 'Data Quality Alert',
    severity: 'Information',
    title: 'Sparse AIS coverage in some southern lanes',
    description: 'Automatic Identification System density is low poleward of 65°S. GPS telemetry remains the primary positional source.',
    location: '>65°S',
    time: '8 h ago',
    status: 'Monitoring',
  },
  {
    id: 'ALT-1036',
    category: 'Iceberg Alert',
    severity: 'Warning',
    title: 'Fragment field detected down-stream of D-35',
    description: 'Small bergy bits (< 500 m) distributed across the westward drift. Visible in SAR imagery and flagged for the fleet.',
    location: '48–50°E',
    time: '11 h ago',
    status: 'Active',
  },
  {
    id: 'ALT-1035',
    category: 'Iceberg Alert',
    severity: 'Critical',
    title: 'A23A fragmentation event observed',
    description: 'The space-borne sensor record suggests fresh calving around the perimeter of A23A. Monitored. No route impact currently.',
    location: 'Weddell Sea',
    time: '14 h ago',
    status: 'Monitoring',
  },
  {
    id: 'ALT-1034',
    category: 'Weather Alert',
    severity: 'Information',
    title: 'Sea state forecast improving — en route window opens',
    description: 'Mean significant wave height expected below 2.5 m for the next 36 hours along the Bharati approach.',
    location: 'Cape Town → Bharati',
    time: '1 d ago',
    status: 'Resolved',
  },
  {
    id: 'ALT-1033',
    category: 'Route Deviation',
    severity: 'Warning',
    title: 'Spontaneous ice re-routing by RV Maitri Voyager',
    description: 'Bridge chose an alternative inshore lane. Risk assessment updated and acknowledged.',
    location: 'Dronning Maud Land',
    time: '1 d ago',
    status: 'Acknowledged',
  },
]

// ------------------------------------------------------------------
// Sea-ice concentration time series (illustrative, %)
// ------------------------------------------------------------------
export const seaIceTrend = [
  { t: 'Sep 1', concentration: 32, observed: 31, forecast: 33 },
  { t: 'Sep 3', concentration: 35, observed: 34, forecast: 36 },
  { t: 'Sep 5', concentration: 38, observed: 37, forecast: 39 },
  { t: 'Sep 7', concentration: 41, observed: 40, forecast: 42 },
  { t: 'Sep 9', concentration: 45, observed: 44, forecast: 46 },
  { t: 'Sep 11', concentration: 49, observed: 48, forecast: 50 },
  { t: 'Sep 13', concentration: 53, observed: 52, forecast: 54 },
  { t: 'Sep 15', concentration: 57, observed: 56, forecast: 58 },
  { t: 'Sep 17', concentration: 61, observed: 60, forecast: 62 },
]

export const iceForecast = [
  { horizon: 'Now', concentration: 61, observed: 60, confidence: 'High' },
  { horizon: '24 h', concentration: 63, observed: null, confidence: 'High' },
  { horizon: '48 h', concentration: 66, observed: null, confidence: 'Medium' },
  { horizon: '72 h', concentration: 68, observed: null, confidence: 'Medium' },
  { horizon: '7 d', concentration: 61, observed: null, confidence: 'Low' },
]

export const regionalIce = [
  { region: 'Weddell Sea', concentration: 74 },
  { region: 'Prydz Bay', concentration: 68 },
  { region: 'Amundsen Sea', concentration: 58 },
  { region: 'Ross Sea', concentration: 71 },
  { region: 'Dronning Maud', concentration: 52 },
  { region: 'Bellinghausen', concentration: 44 },
]

// ------------------------------------------------------------------
// Ship telemetry series
// ------------------------------------------------------------------
export const shipSpeedHistory = [
  { t: '00:00', speed: 11.2, avg: 11.0 },
  { t: '03:00', speed: 12.1, avg: 11.4 },
  { t: '06:00', speed: 13.0, avg: 11.9 },
  { t: '09:00', speed: 12.6, avg: 12.1 },
  { t: '12:00', speed: 13.9, avg: 12.4 },
  { t: '15:00', speed: 14.2, avg: 12.8 },
  { t: '18:00', speed: 13.1, avg: 12.9 },
  { t: '21:00', speed: 13.4, avg: 13.0 },
]

export const shipFuelConsumption = [
  { t: 'Day 1', consumption: 38 },
  { t: 'Day 2', consumption: 41 },
  { t: 'Day 3', consumption: 40 },
  { t: 'Day 4', consumption: 44 },
  { t: 'Day 5', consumption: 42 },
  { t: 'Day 6', consumption: 47 },
  { t: 'Day 7', consumption: 45 },
  { t: 'Day 8', consumption: 43 },
]

export const nearbyIcebergDistance = [
  { t: '00:00', distance: 96 },
  { t: '03:00', distance: 88 },
  { t: '06:00', distance: 71 },
  { t: '09:00', distance: 64 },
  { t: '12:00', distance: 48 },
  { t: '15:00', distance: 36 },
  { t: '18:00', distance: 27 },
  { t: '21:00', distance: 21 },
]

export const iceAlongRoute = [
  { t: 'Leg 1', concentration: 2 },
  { t: 'Leg 2', concentration: 6 },
  { t: 'Leg 3', concentration: 12 },
  { t: 'Leg 4', concentration: 24 },
  { t: 'Leg 5', concentration: 41 },
  { t: 'Leg 6', concentration: 58 },
  { t: 'Leg 7', concentration: 66 },
  { t: 'Leg 8', concentration: 72 },
]

// ------------------------------------------------------------------
// Multi-corridor route planning:
// 1. Cape Town → Bharati Research Station (Larsemann Hills)
// 2. Cape Town → Maitri Research Station (Schirmacher Oasis)
// 3. Bharati ↔ Maitri (East Antarctic Coastal Corridor)
// ------------------------------------------------------------------
export const corridorRoutes = {
  'Cape Town → Bharati Research Station': [
    {
      id: 'opt-shortest',
      label: 'Shortest Distance',
      tag: 'Fastest',
      corridor: 'Cape Town → Bharati',
      distance: 5420,
      distanceNm: 2926,
      time: '14.2 days',
      fuel: 612,
      iceRisk: 'High',
      iceRiskScore: 78,
      weatherRisk: 'Moderate',
      weatherRiskScore: 54,
      status: 'Available',
      co2Tonnes: 1920,
      options: ['Minimise track distance', 'Direct great-circle route', 'Heavy pack-ice transit near Prydz Bay', 'Icebreaker escort may be required'],
      waypointsCount: 8,
    },
    {
      id: 'opt-lowice',
      label: 'Lower Ice Risk',
      tag: 'Safest',
      corridor: 'Cape Town → Bharati',
      distance: 5910,
      distanceNm: 3191,
      time: '16.8 days',
      fuel: 688,
      iceRisk: 'Low',
      iceRiskScore: 24,
      weatherRisk: 'Low',
      weatherRiskScore: 32,
      status: 'Recommended',
      co2Tonnes: 2160,
      options: ['Diverts north of dense multi-year ice', 'Follows known lead system in marginal ice zone', 'Safest corridor with minimum hull stress', 'Lower grounding risk'],
      waypointsCount: 9,
    },
    {
      id: 'opt-fuel',
      label: 'Fuel-Efficient',
      tag: 'Economical',
      corridor: 'Cape Town → Bharati',
      distance: 5620,
      distanceNm: 3034,
      time: '15.6 days',
      fuel: 561,
      iceRisk: 'Moderate',
      iceRiskScore: 48,
      weatherRisk: 'Moderate',
      weatherRiskScore: 46,
      status: 'Available',
      co2Tonnes: 1760,
      options: ['Optimised cruising speed and engine load', 'Antarctic Circumpolar Current-assisted leg', 'Balanced ice resistance vs fuel trade-off'],
      waypointsCount: 8,
    },
  ],
  'Cape Town → Maitri Research Station': [
    {
      id: 'opt-shortest',
      label: 'Shortest Distance',
      tag: 'Fastest',
      corridor: 'Cape Town → Maitri',
      distance: 4260,
      distanceNm: 2300,
      time: '11.2 days',
      fuel: 480,
      iceRisk: 'High',
      iceRiskScore: 72,
      weatherRisk: 'Moderate',
      weatherRiskScore: 58,
      status: 'Available',
      co2Tonnes: 1510,
      options: ['Direct south-southwest transit', 'Approaches Princess Astrid Coast fast ice', 'Substantial ice-strengthened hull required'],
      waypointsCount: 7,
    },
    {
      id: 'opt-lowice',
      label: 'Lower Ice Risk',
      tag: 'Safest',
      corridor: 'Cape Town → Maitri',
      distance: 4640,
      distanceNm: 2505,
      time: '13.1 days',
      fuel: 535,
      iceRisk: 'Low',
      iceRiskScore: 28,
      weatherRisk: 'Low',
      weatherRiskScore: 36,
      status: 'Recommended',
      co2Tonnes: 1680,
      options: ['Eastern arc avoiding Weddell gyre ice tongue', 'Navigates through open coastal polynya leads', 'Minimal risk of vessel entrapment'],
      waypointsCount: 8,
    },
    {
      id: 'opt-fuel',
      label: 'Fuel-Efficient',
      tag: 'Economical',
      corridor: 'Cape Town → Maitri',
      distance: 4410,
      distanceNm: 2381,
      time: '12.0 days',
      fuel: 442,
      iceRisk: 'Moderate',
      iceRiskScore: 44,
      weatherRisk: 'Moderate',
      weatherRiskScore: 42,
      status: 'Available',
      co2Tonnes: 1390,
      options: ['Current-aligned south heading', 'Optimal 12-knot eco-cruising profile', '14% lower fuel consumption'],
      waypointsCount: 7,
    },
  ],
  'Bharati Research Station → Maitri Research Station': [
    {
      id: 'opt-shortest',
      label: 'Shortest Distance',
      tag: 'Fastest',
      corridor: 'Bharati → Maitri',
      distance: 3120,
      distanceNm: 1685,
      time: '9.4 days',
      fuel: 370,
      iceRisk: 'High',
      iceRiskScore: 82,
      weatherRisk: 'High',
      weatherRiskScore: 74,
      status: 'Available',
      co2Tonnes: 1160,
      options: ['Direct inshore coastal shelf route', 'Heavy ice tongue crossing at Enderby Land', 'Intense katabatic wind exposure'],
      waypointsCount: 7,
    },
    {
      id: 'opt-lowice',
      label: 'Lower Ice Risk',
      tag: 'Safest',
      corridor: 'Bharati → Maitri',
      distance: 3480,
      distanceNm: 1879,
      time: '11.0 days',
      fuel: 415,
      iceRisk: 'Low',
      iceRiskScore: 32,
      weatherRisk: 'Moderate',
      weatherRiskScore: 45,
      status: 'Recommended',
      co2Tonnes: 1300,
      options: ['Offshore arc past the continental slope', 'Bypasses coastal fast-ice barriers', 'Clearer iceberg navigation corridor'],
      waypointsCount: 7,
    },
    {
      id: 'opt-fuel',
      label: 'Fuel-Efficient',
      tag: 'Economical',
      corridor: 'Bharati → Maitri',
      distance: 3290,
      distanceNm: 1776,
      time: '10.1 days',
      fuel: 352,
      iceRisk: 'Moderate',
      iceRiskScore: 50,
      weatherRisk: 'Moderate',
      weatherRiskScore: 50,
      status: 'Available',
      co2Tonnes: 1100,
      options: ['Harnesses westward East Wind Drift current', 'Engine running in optimal steady cruise band', 'Low hydro-drag trajectory'],
      waypointsCount: 7,
    },
  ],
}

// Backward compatibility default (Cape Town → Bharati)
export const routeOptions = corridorRoutes['Cape Town → Bharati Research Station']

export const routePolylinesByCorridor = {
  'Cape Town → Bharati Research Station': {
    'opt-shortest': [
      [-33.92, 18.42],
      [-40.1, 25.3],
      [-46.4, 33.8],
      [-52.6, 42.6],
      [-58.2, 50.1],
      [-62.9, 57.4],
      [-66.4, 63.2],
      [-69.41, 76.2],
    ],
    'opt-lowice': [
      [-33.92, 18.42],
      [-41.8, 22.4],
      [-48.9, 26.1],
      [-55.3, 29.5],
      [-60.2, 34.2],
      [-64.1, 41.6],
      [-66.8, 52.0],
      [-68.5, 64.0],
      [-69.41, 76.2],
    ],
    'opt-fuel': [
      [-33.92, 18.42],
      [-38.5, 24.8],
      [-44.2, 33.1],
      [-50.4, 41.6],
      [-56.0, 48.9],
      [-61.3, 55.0],
      [-65.8, 62.4],
      [-69.41, 76.2],
    ],
  },
  'Cape Town → Maitri Research Station': {
    'opt-shortest': [
      [-33.92, 18.42],
      [-41.5, 17.6],
      [-49.0, 16.2],
      [-56.5, 14.8],
      [-63.2, 13.5],
      [-67.8, 12.4],
      [-70.7655, 11.7317],
    ],
    'opt-lowice': [
      [-33.92, 18.42],
      [-40.8, 20.2],
      [-48.2, 21.6],
      [-55.6, 20.8],
      [-62.4, 18.4],
      [-67.1, 15.6],
      [-69.5, 13.5],
      [-70.7655, 11.7317],
    ],
    'opt-fuel': [
      [-33.92, 18.42],
      [-39.5, 18.9],
      [-46.8, 18.0],
      [-54.2, 16.8],
      [-61.8, 15.2],
      [-66.9, 13.8],
      [-70.7655, 11.7317],
    ],
  },
  'Bharati Research Station → Maitri Research Station': {
    'opt-shortest': [
      [-69.4106, 76.1968],
      [-68.2, 65.0],
      [-67.5, 52.0],
      [-68.1, 38.0],
      [-69.2, 25.0],
      [-70.2, 18.0],
      [-70.7655, 11.7317],
    ],
    'opt-lowice': [
      [-69.4106, 76.1968],
      [-66.8, 66.0],
      [-65.5, 53.0],
      [-66.0, 38.0],
      [-67.2, 25.0],
      [-68.9, 16.5],
      [-70.7655, 11.7317],
    ],
    'opt-fuel': [
      [-69.4106, 76.1968],
      [-67.4, 65.5],
      [-66.2, 52.5],
      [-66.8, 38.0],
      [-68.0, 25.0],
      [-69.5, 17.0],
      [-70.7655, 11.7317],
    ],
  },
}

// Backward compatibility default
export const routePolylines = routePolylinesByCorridor['Cape Town → Bharati Research Station']

export function getCorridorRoutes(start, destination) {
  const key = `${start} → ${destination}`
  if (corridorRoutes[key]) {
    return {
      options: corridorRoutes[key],
      polylines: routePolylinesByCorridor[key],
    }
  }
  // Reverse check if applicable
  const revKey = `${destination} → ${start}`
  if (corridorRoutes[revKey]) {
    return {
      options: corridorRoutes[revKey],
      polylines: routePolylinesByCorridor[revKey],
    }
  }
  // Fallback to default
  return {
    options: corridorRoutes['Cape Town → Bharati Research Station'],
    polylines: routePolylinesByCorridor['Cape Town → Bharati Research Station'],
  }
}

// ------------------------------------------------------------------
// Wind field data (simulated Southern Ocean observations)
// ------------------------------------------------------------------
export const windVectors = [
  { id: 'w1', lat: -42.0, lon: 20.0, speed: 38, direction: 275, dirText: 'W', gust: 48, temp: 9, beaufort: 8, zone: 'Roaring Forties' },
  { id: 'w2', lat: -45.0, lon: 35.0, speed: 44, direction: 285, dirText: 'WNW', gust: 56, temp: 6, beaufort: 9, zone: 'Roaring Forties' },
  { id: 'w3', lat: -48.0, lon: 50.0, speed: 42, direction: 260, dirText: 'WSW', gust: 52, temp: 4, beaufort: 8, zone: 'Furious Fifties' },
  { id: 'w4', lat: -52.0, lon: 65.0, speed: 36, direction: 290, dirText: 'WNW', gust: 46, temp: 2, beaufort: 8, zone: 'Furious Fifties' },
  { id: 'w5', lat: -55.0, lon: 25.0, speed: 48, direction: 270, dirText: 'W', gust: 62, temp: 1, beaufort: 10, zone: 'Furious Fifties Storm' },
  { id: 'w6', lat: -58.0, lon: 42.0, speed: 40, direction: 280, dirText: 'W', gust: 50, temp: -1, beaufort: 8, zone: 'Screaming Sixties' },
  { id: 'w7', lat: -60.0, lon: 58.0, speed: 32, direction: 265, dirText: 'WSW', gust: 42, temp: -3, beaufort: 7, zone: 'Screaming Sixties' },
  { id: 'w8', lat: -63.0, lon: 72.0, speed: 28, direction: 240, dirText: 'SW', gust: 35, temp: -6, beaufort: 7, zone: 'Marginal Ice Zone' },
  { id: 'w9', lat: -66.0, lon: 78.0, speed: 22, direction: 110, dirText: 'ESE', gust: 30, temp: -11, beaufort: 6, zone: 'Prydz Bay Katabatic' },
  { id: 'w10', lat: -68.5, lon: 74.0, speed: 26, direction: 95, dirText: 'E', gust: 36, temp: -14, beaufort: 6, zone: 'Bharati Approach' },
  { id: 'w11', lat: -69.0, lon: 15.0, speed: 34, direction: 80, dirText: 'ENE', gust: 45, temp: -16, beaufort: 7, zone: 'Princess Astrid Coast' },
  { id: 'w12', lat: -67.0, lon: 10.0, speed: 24, direction: 100, dirText: 'E', gust: 32, temp: -12, beaufort: 6, zone: 'Maitri Approach' },
  { id: 'w13', lat: -52.0, lon: 12.0, speed: 46, direction: 275, dirText: 'W', gust: 58, temp: 3, beaufort: 9, zone: 'South Atlantic Belt' },
  { id: 'w14', lat: -44.0, lon: 8.0, speed: 36, direction: 280, dirText: 'W', gust: 45, temp: 8, beaufort: 8, zone: 'Cape Basin' },
  { id: 'w15', lat: -62.0, lon: -20.0, speed: 35, direction: 210, dirText: 'SSW', gust: 44, temp: -5, beaufort: 7, zone: 'Weddell Outflow' },
  { id: 'w16', lat: -65.0, lon: -40.0, speed: 28, direction: 180, dirText: 'S', gust: 38, temp: -9, beaufort: 7, zone: 'Weddell Gyre' },
  { id: 'w17', lat: -71.0, lon: 45.0, speed: 30, direction: 120, dirText: 'ESE', gust: 42, temp: -18, beaufort: 7, zone: 'Queen Maud Shelf' },
  { id: 'w18', lat: -64.0, lon: 35.0, speed: 25, direction: 105, dirText: 'ESE', gust: 34, temp: -8, beaufort: 6, zone: 'Cosmonaut Sea' },
]

// ------------------------------------------------------------------
// Ocean currents data (simulated circulation vectors)
// ------------------------------------------------------------------
export const oceanCurrents = [
  // Antarctic Circumpolar Current (ACC / West Wind Drift) - Eastward flow
  { id: 'acc-1', name: 'Antarctic Circumpolar Current', lat: -46.0, lon: 15.0, speed: 1.8, direction: 82, temp: 5.4, depthM: 250 },
  { id: 'acc-2', name: 'Antarctic Circumpolar Current', lat: -48.5, lon: 32.0, speed: 2.1, direction: 85, temp: 4.1, depthM: 250 },
  { id: 'acc-3', name: 'Antarctic Circumpolar Current', lat: -51.0, lon: 48.0, speed: 2.3, direction: 88, temp: 2.9, depthM: 250 },
  { id: 'acc-4', name: 'Antarctic Circumpolar Current', lat: -53.5, lon: 65.0, speed: 1.9, direction: 80, temp: 1.8, depthM: 250 },
  { id: 'acc-5', name: 'Antarctic Circumpolar Current', lat: -56.0, lon: 80.0, speed: 1.7, direction: 84, temp: 0.9, depthM: 250 },
  // Antarctic Coastal Current (East Wind Drift) - Westward counter-flow
  { id: 'ewd-1', name: 'Antarctic Coastal Current', lat: -68.0, lon: 78.0, speed: 0.9, direction: 265, temp: -1.8, depthM: 100 },
  { id: 'ewd-2', name: 'Antarctic Coastal Current', lat: -67.5, lon: 60.0, speed: 1.1, direction: 270, temp: -1.7, depthM: 100 },
  { id: 'ewd-3', name: 'Antarctic Coastal Current', lat: -67.8, lon: 42.0, speed: 1.2, direction: 268, temp: -1.8, depthM: 100 },
  { id: 'ewd-4', name: 'Antarctic Coastal Current', lat: -69.2, lon: 22.0, speed: 0.8, direction: 260, temp: -1.9, depthM: 100 },
  { id: 'ewd-5', name: 'Antarctic Coastal Current', lat: -70.1, lon: 10.0, speed: 0.7, direction: 255, temp: -1.8, depthM: 100 },
  // Weddell Gyre circulation
  { id: 'wg-1', name: 'Weddell Gyre Outflow', lat: -63.0, lon: -35.0, speed: 1.4, direction: 45, temp: -0.8, depthM: 150 },
  { id: 'wg-2', name: 'Weddell Gyre Inflow', lat: -67.0, lon: -15.0, speed: 1.2, direction: 235, temp: -1.2, depthM: 150 },
  { id: 'wg-3', name: 'Weddell Gyre South Drift', lat: -73.0, lon: -30.0, speed: 0.8, direction: 270, temp: -1.9, depthM: 120 },
]

// ------------------------------------------------------------------
// Data sources
// ------------------------------------------------------------------
export const dataSources = [
  { category: 'Satellite Data', icon: 'satellite', color: 'cyan' },
  { category: 'Oceanographic Data', icon: 'waves', color: 'ocean' },
  { category: 'Meteorological Data', icon: 'wind', color: 'ice' },
  { category: 'Vessel Data', icon: 'target', color: 'safe' },
]

export const datasets = [
  { name: 'Sea-ice concentration', category: 'Satellite Data', type: 'Raster / Grid', update: '6 h', status: 'Demo feed', availability: 'Abundant', provider: 'Passive microwave + SAR (illustrative)' },
  { name: 'Iceberg observations', category: 'Satellite Data', type: 'Vector detections', update: '12 h', status: 'Demo feed', availability: 'Moderate', provider: 'SAR image analysis (illustrative)' },
  { name: 'Remote sensing imagery', category: 'Satellite Data', type: 'Imagery', update: 'Daily', status: 'Selected scenes', availability: 'Abundant', provider: 'Optical + SAR (illustrative)' },
  { name: 'Ocean currents', category: 'Oceanographic Data', type: 'Vector field', update: '12 h', status: 'Demo feed', availability: 'Good', provider: 'Ocean circulation model (illustrative)' },
  { name: 'Sea-surface temperature', category: 'Oceanographic Data', type: 'Grid', update: 'Daily', status: 'Demo feed', availability: 'Good', provider: 'Satellite SST product (illustrative)' },
  { name: 'Wave information', category: 'Oceanographic Data', type: 'Spectra / Grid', update: '6 h', status: 'Demo feed', availability: 'Good', provider: 'Wave model (illustrative)' },
  { name: 'Wind speed', category: 'Meteorological Data', type: 'Grid', update: '6 h', status: 'Demo feed', availability: 'Abundant', provider: 'Atmospheric re-analysis (illustrative)' },
  { name: 'Wind direction', category: 'Meteorological Data', type: 'Grid', update: '6 h', status: 'Demo feed', availability: 'Abundant', provider: 'Atmospheric re-analysis (illustrative)' },
  { name: 'Air temperature', category: 'Meteorological Data', type: 'Grid', update: '6 h', status: 'Demo feed', availability: 'Abundant', provider: 'Atmospheric re-analysis (illustrative)' },
  { name: 'Weather forecasts', category: 'Meteorological Data', type: 'Grid / Text', update: '12 h', status: 'Demo feed', availability: 'Good', provider: 'NWP model (illustrative)' },
  { name: 'GPS position', category: 'Vessel Data', type: 'Telemetry', update: '1 min', status: 'Live (demo)', availability: 'Abundant', provider: 'Vessel transponder (illustrative)' },
  { name: 'Speed / heading', category: 'Vessel Data', type: 'Telemetry', update: '1 min', status: 'Live (demo)', availability: 'Abundant', provider: 'Bridge instrumentation (illustrative)' },
  { name: 'Fuel consumption', category: 'Vessel Data', type: 'Logged series', update: 'Hourly', status: 'Logged (demo)', availability: 'Good', provider: 'Engine telemetry (illustrative)' },
  { name: 'AIS where available', category: 'Vessel Data', type: 'AIS feed', update: '± 5 min', status: 'Sparse >65°S', availability: 'Variable', provider: 'Coastal & satellite AIS (illustrative)' },
]

// ------------------------------------------------------------------
// Recent activity
// ------------------------------------------------------------------
export const recentActivity = [
  { icon: 'route', title: 'Route recalculated for RV Polar Scout', detail: 'Avoids compact ice field at 55.4°E', time: '12 min ago' },
  { icon: 'iceberg', title: 'Iceberg Demo-ICE-001 re-tracked', detail: 'Position update received from SAR product', time: '38 min ago' },
  { icon: 'ship', title: 'RV Maitri Voyager submitted fuel report', detail: 'Consumption within expected envelope', time: '1 h ago' },
  { icon: 'seaice', title: 'Sea-ice grid refreshed', detail: 'Latest concentration assimilated into view', time: '3 h ago' },
  { icon: 'alert', title: 'Weather advisory issued', detail: 'Storm-force gusts forecast near 55–65°S', time: '5 h ago' },
]

// ------------------------------------------------------------------
// Sea ice grid — illustrative multi-tier concentration patches
// ------------------------------------------------------------------
export const seaIcePatches = [
  { lat: -66.0, lon: 40.0, concentration: 52, stage: 'First-year ice', thicknessCm: 70, level: 'Open Drift' },
  { lat: -68.0, lon: 48.0, concentration: 68, stage: 'Medium first-year', thicknessCm: 95, level: 'Close Pack' },
  { lat: -69.5, lon: 58.0, concentration: 74, stage: 'Thick first-year', thicknessCm: 130, level: 'Close Pack' },
  { lat: -70.2, lon: 70.0, concentration: 78, stage: 'Compact pack ice', thicknessCm: 160, level: 'Very Close Pack' },
  { lat: -71.0, lon: 82.0, concentration: 66, stage: 'Close drift ice', thicknessCm: 85, level: 'Close Pack' },
  { lat: -69.0, lon: 90.0, concentration: 61, stage: 'Medium pack ice', thicknessCm: 90, level: 'Close Pack' },
  { lat: -67.0, lon: 30.0, concentration: 58, stage: 'First-year ice', thicknessCm: 80, level: 'Open Drift' },
  { lat: -71.5, lon: 10.0, concentration: 55, stage: 'Coastal fast ice boundary', thicknessCm: 110, level: 'Close Pack' },
  { lat: -72.2, lon: 3.0, concentration: 60, stage: 'Shelf-fast ice', thicknessCm: 140, level: 'Close Pack' },
  { lat: -70.0, lon: -10.0, concentration: 51, stage: 'Marginal ice edge', thicknessCm: 65, level: 'Open Drift' },
  { lat: -73.0, lon: -30.0, concentration: 72, stage: 'Weddell multi-year pack', thicknessCm: 180, level: 'Close Pack' },
  { lat: -75.5, lon: -50.0, concentration: 85, stage: 'Weddell heavy multi-year', thicknessCm: 240, level: 'Compact Pack' },
  { lat: -72.0, lon: -70.0, concentration: 76, stage: 'Ronne ice front leads', thicknessCm: 150, level: 'Close Pack' },
  { lat: -76.0, lon: -120.0, concentration: 88, stage: 'Amundsen dense pack', thicknessCm: 220, level: 'Compact Pack' },
  { lat: -74.5, lon: 160.0, concentration: 80, stage: 'Ross Sea compact ice', thicknessCm: 190, level: 'Very Close Pack' },
  { lat: -77.0, lon: 170.0, concentration: 92, stage: 'Ross Ice Shelf fast-ice', thicknessCm: 280, level: 'Compact Pack' },
  { lat: -69.0, lon: 150.0, concentration: 59, stage: 'Open drift leads', thicknessCm: 75, level: 'Open Drift' },
  { lat: -67.0, lon: 120.0, concentration: 55, stage: 'Wilkes Land marginal zone', thicknessCm: 70, level: 'Open Drift' },
  { lat: -64.5, lon: 55.0, concentration: 28, stage: 'Marginal Ice Zone (MIZ)', thicknessCm: 35, level: 'Marginal Ice' },
  { lat: -63.5, lon: 35.0, concentration: 24, stage: 'Marginal Ice Zone (MIZ)', thicknessCm: 30, level: 'Marginal Ice' },
  { lat: -65.2, lon: 18.0, concentration: 29, stage: 'Marginal Ice Zone (MIZ)', thicknessCm: 40, level: 'Marginal Ice' },
]

export const fleetStatusRows = [
  { name: 'RV Bharati Explorer', sector: 'Cape Town → Bharati', status: 'En Route', speed: '13.4 kn', winds: '120° 28 kn' },
  { name: 'RV Maitri Voyager', sector: 'Dronning Maud Land', status: 'Monitoring', speed: '6.2 kn', winds: '70° 22 kn' },
  { name: 'RV Polar Researcher', sector: 'Maitri Station', status: 'At Station', speed: '0.0 kn', winds: '150° 15 kn' },
  { name: 'RV Polar Scout', sector: '55.4°E sector', status: 'Alert', speed: '9.8 kn', winds: '90° 34 kn' },
]
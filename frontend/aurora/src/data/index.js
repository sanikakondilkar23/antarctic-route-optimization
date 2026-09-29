// ------------------------------------------------------------------
// AURORA — reference locations
//
// Only verifiable geography lives here: the project's staging port and the
// two station-approach points the backend itself uses as route goals
// (backend/cache/routing_station_goals.json). Every other quantity shown by
// the app is fetched from the AURORA API at runtime — no position, distance,
// concentration or risk value in this file is ever displayed as an
// observation.
// ------------------------------------------------------------------

export function fmtTimestamp() {
  const d = new Date()
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

export const STATIONS = [
  {
    id: 'bharati',
    name: 'Bharati Research Station',
    lat: -69.4106,
    lon: 76.1968,
    country: 'India',
    type: 'station',
    note: 'Larsemann Hills',
  },
  {
    id: 'maitri',
    name: 'Maitri Research Station',
    lat: -70.7655,
    lon: 11.7317,
    country: 'India',
    type: 'station',
    note: 'Schirmacher Oasis',
  },
  {
    id: 'cape-town',
    name: 'Cape Town',
    lat: -33.9249,
    lon: 18.4241,
    country: 'South Africa',
    type: 'port',
    note: 'staging port used by the verified baseline route',
  },
]

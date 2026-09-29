// Haversine great-circle distance between two [lat, lon] points in km
export function haversineKm(aLat, aLon, bLat, bLon) {
  const R = 6371
  const toRad = (deg) => (deg * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export function fmtCoord(lat, lon, precision = 2) {
  const ns = lat >= 0 ? 'N' : 'S'
  const ew = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(precision)}°${ns}  ${Math.abs(lon).toFixed(precision)}°${ew}`
}

export function cn(...classes) {
  return classes.filter(Boolean).join(' ')
}
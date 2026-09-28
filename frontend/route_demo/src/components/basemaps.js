/**
 * Public, legally usable geographic basemaps for the Antarctic chart.
 *
 * No Google Maps tiles and no scraping: every source below is a public
 * tile service intended for exactly this kind of use, and each one carries
 * the attribution its provider requires.
 *
 * These are GEOGRAPHY only. They supply the coastline, the ocean and the
 * place names. They never supply, replace or modify any model output: the
 * route on top of them comes from POST /api/route/optimize and nothing else.
 */

/** Leaflet always wants a subdomain string; these tiles have no {s}. */
const DIRECT = 'abc'

export const BASEMAPS = [
  {
    id: 'esri-imagery',
    label: 'Satellite (Esri World Imagery)',
    short: 'SATELLITE',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    subdomains: DIRECT,
    attribution: 'Imagery &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    maxNativeZoom: 12,
    maxZoom: 12,
  },
  {
    id: 'esri-ocean',
    label: 'Southern Ocean bathymetry (Esri)',
    short: 'OCEAN',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
    subdomains: DIRECT,
    attribution: 'Bathymetry &copy; Esri &mdash; Esri, GEBCO, NOAA, National Geographic, DeLorme, NAVTEQ',
    maxNativeZoom: 12,
    maxZoom: 12,
  },
  {
    id: 'carto-voyager',
    label: 'Street and place names (CARTO / OSM)',
    short: 'STREET',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    maxNativeZoom: 19,
    maxZoom: 19,
  },
  {
    id: 'carto-dark',
    label: 'Dark navigation (CARTO / OSM)',
    short: 'DARK',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    subdomains: 'abcd',
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    maxNativeZoom: 19,
    maxZoom: 19,
  },
  {
    id: 'osm',
    label: 'OpenStreetMap',
    short: 'OSM',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: DIRECT,
    attribution: '&copy; OpenStreetMap contributors',
    maxNativeZoom: 19,
    maxZoom: 19,
  },
]

export const DEFAULT_BASEMAP = 'esri-imagery'

export const basemapById = (id) => BASEMAPS.find((b) => b.id === id) || BASEMAPS[0]

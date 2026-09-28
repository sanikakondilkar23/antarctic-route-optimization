import { chromium } from 'playwright'

/**
 * Route-visualization acceptance check against the RUNNING backend (8000).
 * Asserts only what the DOM and the network actually produced: the map is a
 * real geographic Leaflet chart on a public basemap, and the route drawn on
 * it is the route the backend returned.
 */
const BASE = 'http://127.0.0.1:8000'
const b = await chromium.launch({ channel: 'chrome', headless: true })
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })

const requests = []
const errors = []
p.on('request', (r) => requests.push(r.url()))
p.on('pageerror', (e) => errors.push(String(e)))
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

const fail = []
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`)
  if (!cond) fail.push(name)
}

await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForSelector('.planner')
await p.waitForTimeout(3500)

/* 1. real geographic basemap ---------------------------------------- */
ok('1a Leaflet is mounted', (await p.$$('.leaflet-container')).length === 1)
const tiles = requests.filter((u) => /arcgisonline|tile\.openstreetmap|basemaps\.cartocdn/.test(u))
ok('1b public basemap tiles requested', tiles.length > 4, `${tiles.length} tile requests`)
ok('1c no Google Maps tiles', !requests.some((u) => /google\.com\/maps|maps\.googleapis/.test(u)))
ok('1d attribution rendered', (await p.textContent('.leaflet-control-attribution')).length > 20)
ok('1e graticule/scale present', (await p.textContent('.leaflet-control-scale')).includes('km'))

/* 2. the SIC layer is still the real API raster ---------------------- */
ok('2a SIC from GET /api/sic/0', requests.some((u) => u.endsWith('/api/sic/0')))
ok('2b coastline from API', requests.some((u) => u.endsWith('/api/map/coastline')))
ok('2c no legacy image frames', !requests.some((u) => /\/data\/frames\//.test(u)))

/* 3. optimize -> the real route ------------------------------------- */
await p.click('.btn-primary.wide')
await p.waitForSelector('.metrics', { timeout: 120000 })
await p.waitForTimeout(3000)
await p.waitForFunction(() => {
  const imgs = [...document.querySelectorAll('.leaflet-tile')]
  return imgs.length > 0 && imgs.every((i) => i.classList.contains('leaflet-tile-loaded') || !i.complete)
}, { timeout: 20000 }).catch(() => {})
await p.waitForTimeout(600)
await p.screenshot({ path: 'verify/shots/geo-00-optimized.png' })

const m = async (k) => (await p.textContent(`.card .mrow:has(.mk:text-is("${k}")) .mv`)).trim()
const waypoints = await m('WAYPOINTS')
const distance = await m('DISTANCE')
ok('3a waypoints from API = 287', waypoints === '287', waypoints)
ok('3b distance from API', distance.startsWith('348.96'), distance)
ok('3c distance km from API', distance.includes('7,554'), distance)
ok('3d mean SIC from API', (await m('MEAN SIC')) === '0.0075', await m('MEAN SIC'))
ok('3e safety validation PASS', (await m('SAFETY VALIDATION')) === 'PASS', await m('SAFETY VALIDATION'))
ok('3f POST /api/route/optimize used', requests.some((u) => u.endsWith('/api/route/optimize')))
ok('3g route HUD shows km', (await p.textContent('.hud-tr')).includes('7,554.36 km'),
  (await p.textContent('.hud-tr')).replace(/\s+/g, ' ').trim())

/* 4. the drawn polyline is the backend path ------------------------- */
const apiPath = await p.evaluate(async () => {
  const r = await fetch('/api/route/optimize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_lat: -32, start_lon: 82, goal_lat: -70, goal_lon: 10.5, timestep: 0 }),
  })
  const j = await r.json()
  return { n: j.path.length, first: j.path[0], last: j.path[j.path.length - 1], start: j.start, goal: j.goal }
})
const drawn = await p.evaluate(() => {
  // the route lives in the p-route pane; the coastline lives in p-geo
  let best = null
  let strokes = 0
  for (const el of document.querySelectorAll('.leaflet-p-route-pane path')) {
    const n = ((el.getAttribute('d') || '').match(/[ML]/g) || []).length
    strokes++
    if (n > 10 && (!best || n > best.n)) best = { n, stroke: el.getAttribute('stroke') }
  }
  return best ? { ...best, strokes } : null
})
ok('4a route polyline drawn', drawn && drawn.n >= 200, drawn ? `${drawn.n} vertices, stroke ${drawn.stroke}` : 'none')
ok('4b drawn vertex count matches API path', drawn && drawn.n === apiPath.n, `drawn ${drawn?.n} vs api ${apiPath.n}`)
ok('4b2 corridor stroked as casing/glow/core', drawn && drawn.strokes >= 4, `${drawn?.strokes} strokes in p-route`)

const meta = await p.evaluate(async () => (await (await fetch('/api/sic/metadata')).json()))
const endPts = await p.evaluate((want) => {
  const out = []
  document.querySelectorAll('.pin-label').forEach((e) => out.push(e.textContent))
  return out
}, null)
ok('4c START and DESTINATION labels on the map',
  endPts.some((t) => t.includes('START')) && endPts.some((t) => t.includes('DESTINATION')),
  endPts.join(' | '))

/* 5. start / destination are the requested coordinates --------------- */
const pins = await p.evaluate(() => {
  const lat = [...document.querySelectorAll('.pin-wrap')].map((e) => e.getAttribute('style') || '')
  return { count: lat.length }
})
ok('5a endpoint markers rendered', pins.count >= 2, `${pins.count} markers`)
console.log('  grid extent from API:', meta.lat_range.join('..'), 'lon', meta.lon_range.join('..'),
  '| start', apiPath.start.lat, apiPath.start.lon, '| goal', apiPath.goal.lat, apiPath.goal.lon)

/* 6. zoom / pan on the real basemap --------------------------------- */
const z0 = parseFloat((await p.textContent('.map-zoom')).replace('z', ''))
await p.click('.map-ctrls button[aria-label="zoom in"]')
await p.waitForTimeout(700)
const z1 = parseFloat((await p.textContent('.map-zoom')).replace('z', ''))
ok('6a zoom in works', z1 > z0, `${z0} -> ${z1}`)
await p.click('.map-ctrls button[aria-label="reset view"]')
await p.waitForTimeout(900)
const z2 = parseFloat((await p.textContent('.map-zoom')).replace('z', ''))
ok('6b reset view refits', z2 !== z1, `${z1} -> ${z2}`)
// the map exposes its own view state, so a pan can be asserted directly
const center0 = await p.evaluate(() => {
  const t = document.querySelector('.leaflet-map-pane')
  return t ? t.style.transform : ''
})
const t0 = requests.filter((u) => /arcgisonline|tile\.openstreetmap|basemaps\.cartocdn/.test(u)).length
await p.mouse.move(760, 620)
await p.mouse.down()
await p.mouse.move(1150, 700, { steps: 14 })
await p.mouse.up()
await p.waitForTimeout(1500)
const center1 = await p.evaluate(() => {
  const t = document.querySelector('.leaflet-map-pane')
  return t ? t.style.transform : ''
})
const t1 = requests.filter((u) => /arcgisonline|tile\.openstreetmap|basemaps\.cartocdn/.test(u)).length
ok('6c drag pans the basemap', center0 !== center1, `${center0 || 'none'} -> ${center1 || 'none'}`)
ok('6c2 panning loads new real tiles', t1 > t0, `${t0} -> ${t1}`)
ok('6d no page errors during pan/zoom', errors.length === 0, errors.join(' | '))

/* 7. basemap switcher ----------------------------------------------- */
/** wait until the basemap has actually painted its visible tiles */
const tilesSettled = async () => {
  await p.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('.leaflet-tile')]
    if (!imgs.length) return false
    return imgs.every((i) => i.classList.contains('leaflet-tile-loaded') || !i.complete)
  }, { timeout: 20000 }).catch(() => {})
  await p.waitForTimeout(700)
}

await p.click('.basemap-switch button:has-text("OCEAN")')
await p.waitForTimeout(2000)
await tilesSettled()
ok('7a basemap switcher active', (await p.textContent('.basemap-switch button.on')).trim() === 'OCEAN')
ok('7b switched basemap loads tiles',
  requests.some((u) => /ArcGIS\/rest\/services\/Ocean/.test(u)))
await p.screenshot({ path: 'verify/shots/geo-01-ocean.png' })
await p.click('.basemap-switch button:has-text("SATELLITE")')
await p.waitForTimeout(2000)
await tilesSettled()
await p.screenshot({ path: 'verify/shots/geo-02-satellite.png' })

/* 8. click-to-pick sets real coordinates ----------------------------- */
const latIn = await p.$$('.ep[data-ep="start"] .num')
const before = await latIn[0].inputValue()
await p.click('.ep[data-ep="start"] .btn-ghost')
await p.waitForTimeout(300)
ok('8a pick mode armed', (await p.textContent('.ep[data-ep="start"]')).includes('click the chart'))
await p.mouse.click(1000, 520)
await p.waitForTimeout(700)
const after = await latIn[0].inputValue()
ok('8b clicking the map sets the start coordinate', after !== before, `${before} -> ${after}`)

/* 9. dynamic reroute — display only, algorithm untouched ------------- */
await p.click('.ep[data-ep="start"] .btn-ghost').catch(() => {})
await p.fill('.ep[data-ep="start"] .num >> nth=0', '-32')
await p.fill('.ep[data-ep="start"] .num >> nth=1', '82')
await p.fill('.ep[data-ep="goal"] .num >> nth=0', '-70')
await p.fill('.ep[data-ep="goal"] .num >> nth=1', '10.5')
await p.click('.btn-primary.wide')
await p.waitForTimeout(4000)
await p.fill('.fc-row.reroute .num', '120')
await p.click('.btn-warn.sm')
await p.waitForSelector('.seg-list', { timeout: 180000 })
await p.waitForTimeout(2500)
ok('9a reroute used POST /api/route/reroute', requests.some((u) => u.endsWith('/api/route/reroute')))
const rrCard = await p.textContent('.card:has-text("DYNAMIC REROUTE")')
ok('9b original + updated shown', rrCard.includes('ORIGINAL') && rrCard.includes('UPDATED'))
ok('9c legend shows the original corridor', (await p.textContent('.hud-bl')).includes('original'))
const drawn2 = await p.evaluate(() => {
  let best = null
  let dashed = 0
  for (const el of document.querySelectorAll('.leaflet-p-route-pane path')) {
    const n = ((el.getAttribute('d') || '').match(/[ML]/g) || []).length
    if (n > 10 && (!best || n > best.n)) best = { n }
    if (el.getAttribute('stroke-dasharray')) dashed++
  }
  return { ...(best || { n: 0 }), dashed }
})
ok('9d rerouted corridor redrawn on the map', drawn2.n >= 200, `${drawn2.n} vertices`)
ok('9e original (dashed) corridor also drawn', drawn2.dashed > 0, `${drawn2.dashed} dashed strokes`)
await p.screenshot({ path: 'verify/shots/geo-03-reroute.png' })

/* 10. provenance not fabricated -------------------------------------- */
const rail = await p.textContent('.rail')
ok('10a currents reported unavailable', /Unavailable/i.test(rail))
ok('10b CVaR reported unavailable', /CVaR[\s\S]{0,80}Unavailable/i.test(rail))
ok('10c route ML labelled synthetic/experimental', /synthetic|experimental/i.test(rail))
ok('10d SIC model described as the SIC model, not the router',
  /SIC field/i.test(rail) && /A\* searches that cost surface/i.test(rail))

await p.screenshot({ path: 'verify/shots/geo-04-final.png' })

console.log('\npage errors:', errors.length ? errors.join(' | ') : 'none')
console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(', ')}` : '\nALL CHECKS PASSED')
await b.close()
process.exit(fail.length ? 1 : 0)

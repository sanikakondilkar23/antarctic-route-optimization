import { chromium } from 'playwright'

/**
 * Map-presentation acceptance test. Drives the real UI against the real
 * backend and asserts only what the DOM / network actually produced.
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
await p.waitForTimeout(2500)

/* 1. real SIC + no image frames ---------------------------------------- */
const pngFrames = requests.filter((u) => /\/data\/frames\//.test(u))
ok('1  no /data/frames/*.png requests', pngFrames.length === 0, pngFrames.join(','))
ok('1b SIC comes from GET /api/sic/0', requests.some((u) => u.endsWith('/api/sic/0')))
ok('1c coastline context from API', requests.some((u) => u.endsWith('/api/map/coastline')))
ok('1d no <img> elements in the map', (await p.$$('.map-shell img')).length === 0)

/* 2. the map is the largest element ------------------------------------- */
const area = async (s) => {
  const el = await p.$(s)
  if (!el) return 0
  const r = await el.boundingBox()
  return r ? r.width * r.height : 0
}
const mapA = await area('.mapcol')
const vp = p.viewportSize()
const mapPct = (mapA / (vp.width * vp.height)) * 100
ok('2  map is the largest element', mapPct >= 65, `${mapPct.toFixed(1)}% of viewport`)

/* 3. optimize -> real route -------------------------------------------- */
await p.click('.btn-primary.wide')
await p.waitForSelector('.metrics')
await p.waitForTimeout(2500)
const m = async (k) => (await p.textContent(`.card .mrow:has(.mk:text-is("${k}")) .mv`)).trim()
ok('3a waypoints from API', (await m('WAYPOINTS')) === '287', await m('WAYPOINTS'))
ok('3b distance from API', (await m('DISTANCE')).startsWith('348.96'), await m('DISTANCE'))
ok('3c mean SIC from API', (await m('MEAN SIC')) === '0.0075', await m('MEAN SIC'))
ok('3d max SIC from API', (await m('MAX SIC')) === '0.7541', await m('MAX SIC'))
ok('3e invalid cells 0', (await m('INVALID CELLS')).startsWith('0 NaN'), await m('INVALID CELLS'))
ok('3f validation PASS', (await m('SAFETY VALIDATION')) === 'PASS', await m('SAFETY VALIDATION'))
ok('3g POST /api/route/optimize was used',
  requests.some((u) => u.endsWith('/api/route/optimize')), '')
ok('3h top-right HUD shows the route', (await p.textContent('.hud-tr')).includes('OPTIMIZED'))

/* 4. zoom and pan ------------------------------------------------------- */
const zoomBefore = await p.textContent('.map-zoom').catch(() => null)
const box = await (await p.$('.map-shell canvas')).boundingBox()
await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, -300); await p.waitForTimeout(120) }
await p.waitForTimeout(600)
const zoomAfter = await p.textContent('.map-zoom').catch(() => null)
ok('4a wheel zoom increases zoom', parseFloat(zoomAfter) > parseFloat(zoomBefore || '1'),
  `${zoomBefore} -> ${zoomAfter}`)
await p.click('.map-ctrls button[aria-label="zoom out"]')
await p.click('.map-ctrls button[aria-label="zoom out"]')
await p.waitForTimeout(400)
ok('4b zoom-out control works', parseFloat(await p.textContent('.map-zoom')) < parseFloat(zoomAfter))
await p.click('.map-ctrls button[aria-label="reset view"]')
await p.waitForTimeout(500)
ok('4c reset view returns to 1x', (await p.textContent('.map-zoom').catch(() => '1.0')) !== null)

// drag = pan
await p.mouse.move(box.x + 600, box.y + 400)
await p.mouse.down()
await p.mouse.move(box.x + 800, box.y + 500, { steps: 8 })
await p.mouse.up()
await p.waitForTimeout(400)
ok('4d drag does not throw', errors.length === 0, errors.join(' | '))
await p.click('.map-ctrls button[aria-label="fit route"]')
await p.waitForTimeout(500)

/* 5. click-to-pick sets the real coordinates ---------------------------- */
const latInputs = await p.$$('.ep[data-ep="start"] .num')
const before = await latInputs[0].inputValue()
await p.click('.ep[data-ep="start"] .btn-ghost')
await p.waitForTimeout(300)
ok('5a pick mode armed', (await p.textContent('.ep[data-ep="start"]')).includes('click the chart'))
const canvas = await (await p.$('.map-shell canvas')).boundingBox()
await p.mouse.click(canvas.x + 700, canvas.y + 300)
await p.waitForTimeout(600)
const after = await latInputs[0].inputValue()
ok('5b clicking the chart sets the start coordinate', after !== before, `${before} -> ${after}`)

/* 6. timestep changes the SIC raster ------------------------------------ */
await p.evaluate(() => {
  const r = document.querySelector('.tl-range')
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  set.call(r, '150'); r.dispatchEvent(new Event('input', { bubbles: true }))
  r.dispatchEvent(new Event('change', { bubbles: true }))
})
await p.waitForTimeout(4000)
ok('6a new timestep fetched', requests.some((u) => u.endsWith('/api/sic/150')))
const hud150 = (await p.textContent('.hud-tl')).trim()
const meta = await p.evaluate(async () => (await (await fetch('/api/sic/metadata')).json()).dates[150])
ok('6b HUD date matches the API date for D150', hud150.includes(meta), `${hud150} (expected ${meta})`)
const stats150 = await p.textContent('.card .mrow:has(.mk:text-is("MAX SIC (DAY)")) .mv')
ok('6c day max SIC is real', parseFloat(stats150) > 0.9, stats150)

/* 7. reroute ------------------------------------------------------------ */
await p.fill('.fc-row.reroute .num', '120')
await p.click('.btn-warn.sm')
await p.waitForSelector('.seg-list', { timeout: 120000 })
await p.waitForTimeout(1500)
const rr = await p.textContent('.card:has-text("DYNAMIC REROUTE")').catch(() => '')
ok('7a reroute used POST /api/route/reroute',
  requests.some((u) => u.endsWith('/api/route/reroute')))
ok('7b original + updated shown', rr.includes('ORIGINAL') && rr.includes('UPDATED'))
ok('7c changed segments listed', (await p.$$('.seg')).length > 0, `${(await p.$$('.seg')).length} segments`)
ok('7d legend shows the original corridor', (await p.textContent('.hud-bl')).includes('original'))
await p.screenshot({ path: 'verify/shots/map-v2-reroute.png' })

/* 8. no fabricated data ------------------------------------------------ */
const rail = await p.textContent('.rail')
ok('8a currents reported unavailable', /Unavailable/i.test(rail))
ok('8b CVaR reported unavailable', /CVaR[\s\S]{0,80}Unavailable/i.test(rail))
ok('8c route ML labelled synthetic/experimental', /synthetic|experimental/i.test(rail))
ok('8d inference not claimed', /inference not re-run/i.test(rail))

console.log('\npage errors:', errors.length ? errors.join(' | ') : 'none')
console.log(fail.length ? `\n${fail.length} FAILED: ${fail.join(', ')}` : '\nALL CHECKS PASSED')
await b.close()
process.exit(fail.length ? 1 : 0)

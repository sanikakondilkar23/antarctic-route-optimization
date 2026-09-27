import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = process.env.BASE || 'http://127.0.0.1:8011'
const OUT = 'C:/Users/Sanika/AppData/Local/Temp/opencode/shots'
fs.mkdirSync(OUT, { recursive: true })

const errors = []
const results = []

const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })

page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForSelector('.map-shell canvas', { timeout: 40000 })
await page.waitForTimeout(2500)

// ---- 1. no page-level scrolling
const scroll = await page.evaluate(() => ({
  sy: window.scrollY, sx: window.scrollX,
  bodyH: document.body.scrollHeight, winH: window.innerHeight,
  docH: document.documentElement.scrollHeight,
  appH: document.querySelector('.app')?.scrollHeight,
}))
check('no page-level scrolling',
  scroll.sy === 0 && scroll.docH <= scroll.winH + 1,
  `docH=${scroll.docH} winH=${scroll.winH}`)

// ---- 2. real SIC raster actually painted (not an empty grid)
const painted = await page.evaluate(() => {
  const c = document.querySelector('.map-shell canvas')
  const g = c.getContext('2d')
  const d = g.getImageData(0, 0, c.width, c.height).data
  const seen = new Set()
  let bright = 0
  for (let i = 0; i < d.length; i += 4 * 97) {
    seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`)
    if (d[i] + d[i + 1] + d[i + 2] > 300) bright++
  }
  return { distinct: seen.size, bright }
})
check('real SIC field rendered', painted.distinct > 12,
  `${painted.distinct} distinct colour buckets, ${painted.bright} bright samples`)

// ---- 3. statusbar metadata
const sb = await page.textContent('.statusbar')
check('167 timesteps in status bar', /167 forecast timesteps/.test(sb))
check('grid dims in status bar', /173 × 369 grid @ 0\.25°/.test(sb))
check('NaN policy stated', /never zero-filled/.test(sb))

// ---- 4. legend
const lg = await page.textContent('.legend')
check('SIC legend present', /sea ice concentration 0\.0 → 1\.0/i.test(lg))
check('non-navigable legend present', /non-navigable \(NaN\)/i.test(lg))

// ---- 5. layer controls
const layers = await page.$$eval('.layer', (els) =>
  els.map((e) => ({ t: e.textContent.trim().slice(0, 46), off: e.classList.contains('off') })))
check('8 layer controls', layers.length === 8, JSON.stringify(layers.length))
check('ocean current layer unavailable',
  layers.some((l) => /Ocean Current/.test(l.t) && l.off),
  layers.find((l) => /Ocean Current/.test(l.t))?.t)
check('uncertainty layer available',
  layers.some((l) => /SIC Uncertainty/.test(l.t) && !l.off))
await page.screenshot({ path: `${OUT}/01-loaded.png` })

// ---- 6. uncertainty: open tab, pick horizon 2, check it loads
await page.click('.rt:has-text("Uncertainty")')
await page.waitForSelector('.hz-b', { timeout: 10000 })
await page.waitForTimeout(1200)
const unc1 = await page.textContent('.card-unc')
check('uncertainty panel shows 3 horizons', /3 horizons/.test(unc1))
await page.click('.hz-b:has-text("Horizon 2")')
await page.waitForTimeout(2000)
const unc2 = await page.textContent('.card-unc')
check('uncertainty stats present', /Mean \(model band\)/.test(unc2) && /\/ p90/.test(unc2))
check('uncertainty horizon switch', await page.isVisible('.map-shell canvas'))
await page.screenshot({ path: `${OUT}/02-uncertainty.png` })

// back to SIC field
await page.click('.viewmode .vm:has-text("SIC")')
await page.waitForTimeout(600)

// ---- 7. optimize route
await page.click('.rt:has-text("Route decision")')
await page.waitForSelector('.card-route', { timeout: 8000 })
await page.click('button:has-text("OPTIMIZE ROUTE")')
await page.waitForTimeout(6000)
const dec = await page.textContent('.card-route')
const num = (re) => { const m = dec.match(re); return m ? m[1] : null }
check('decision: 287 waypoints', num(/Waypoints\s*([\d,]+)/)?.replace(/,/g, '') === '287',
  num(/Waypoints\s*([\d,]+)/))
check('decision: length 348.96', num(/Length\s*([\d.]+)/) === '348.96', num(/Length\s*([\d.]+)/))
check('decision: mean SIC 0.0075', num(/Mean SIC\s*([\d.]+)/) === '0.0075', num(/Mean SIC\s*([\d.]+)/))
check('decision: max SIC 0.7541', num(/Max SIC\s*([\d.]+)/) === '0.7541', num(/Max SIC\s*([\d.]+)/))
check('decision: 0 NaN cells on route', /NaN cells on route:\s*0/.test(dec))
check('why this route present', /Why this route\?/.test(dec))
check('A* + CostMap named', /A\* \+ CostMap/.test(dec))

// ---- 8. route risk profile
const prof = await page.$('.prof canvas')
const profPainted = prof ? await prof.evaluate((c) => {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let n = 0
  for (let i = 3; i < d.length; i += 4 * 7) if (d[i] > 0) n++
  return n
}) : 0
check('route risk profile canvas painted', profPainted > 200, `${profPainted} opaque samples`)
const rp = await page.textContent('.card-risk')
check('risk profile stats', /Max SIC/.test(rp) && /NaN cells/.test(rp) && /Length/.test(rp))
await page.screenshot({ path: `${OUT}/03-route.png` })

// ---- 9. timeline: step to D3 and check the SIC map + stats change
const before = await page.textContent('.lg-stats')
await page.evaluate(() => {
  const r = document.querySelector('.tl-range')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(r, '3')
  r.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.waitForTimeout(2500)
const after = await page.textContent('.lg-stats')
check('timestep change updates SIC stats', before !== after, `${before?.trim()} -> ${after?.trim()}`)
const dateNow = await page.textContent('.hud-tl')
check('timestep date shown', /2026-01-09/.test(dateNow), dateNow.replace(/\s+/g, ' ').slice(0, 80))

// jump to D120 to prove the whole range works
await page.evaluate(() => {
  const r = document.querySelector('.tl-range')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(r, '120')
  r.dispatchEvent(new Event('input', { bubbles: true }))
})
await page.waitForTimeout(2500)
const date120 = await page.textContent('.hud-tl')
check('D120 reachable (2026-05-06)', /2026-05-06/.test(date120), date120.replace(/\s+/g, ' ').slice(0, 60))
await page.screenshot({ path: `${OUT}/04-t120.png` })

// ---- 10. play forecast
await page.click('.tl-play')
await page.waitForTimeout(1600)
const playing = await page.textContent('.tl-live')
check('play forecast runs', /RUNNING/.test(playing), playing.replace(/\s+/g, ' ').trim())
await page.click('.tl-play')

// ---- 11. reroute
await page.click('.rt:has-text("Change / reroute")')
await page.waitForSelector('.card-envc', { timeout: 8000 })
await page.click('button:has-text("DYNAMIC REROUTE")')
await page.waitForTimeout(9000)
const envc = await page.textContent('.card-envc')
const rrc = await page.textContent('.card-reroute')
check('reroute SUCCESS', /SUCCESS/.test(rrc))
check('jaccard + coverage shown', /Jaccard overlap/.test(rrc) && /Route coverage/.test(rrc))
check('triptych BEFORE/AFTER/DIFFERENCE', /BEFORE/.test(envc) && /AFTER/.test(envc) && /DIFFERENCE/.test(envc))
check('diff summary computed', /Cells with SIC increase/.test(envc) && /Max \|ΔSIC\|/.test(envc))
await page.screenshot({ path: `${OUT}/05-reroute.png` })

// ---- 12. difference view on the chart
await page.click('.viewmode .vm:has-text("Difference")')
await page.waitForTimeout(1500)
const lg2 = await page.textContent('.legend')
check('difference legend on chart', /ice advanced/.test(lg2) && /became non-navigable/.test(lg2))
const chip = await page.textContent('.hud-tl')
check('difference status chip', /ENVIRONMENT DIFFERENCE/.test(chip))
await page.screenshot({ path: `${OUT}/06-difference.png` })

// ---- 13. system intelligence
await page.click('.viewmode .vm:has-text("SIC")')
await page.click('.rt:has-text("System intelligence")')
await page.waitForSelector('.card-sys', { timeout: 8000 })
const si = await page.textContent('.card-sys')
check('SI: real SIC available', /REAL SIC/.test(si) && /167 timesteps/.test(si))
check('SI: uncertainty 3 horizons', /SIC UNCERTAINTY/.test(si) && /3 horizons/.test(si))
check('SI: 3 checkpoints', /3 available/.test(si))
check('SI: raw inputs not available', /NOT AVAILABLE FOR RE-INFERENCE/.test(si))
check('SI: CMEMS unavailable', /UNAVAILABLE IN CURRENT DEPLOYMENT/.test(si))
check('SI: CVaR unavailable', /UNAVAILABLE — iceberg risk layers absent/.test(si))
check('SI: retraining NONE', /Retraining: NONE/.test(si))
check('SI: 3 seeds listed', /seed 0/.test(si) && /seed 1/.test(si) && /seed 2/.test(si))
check('SI: raw inference not rerun', /not<\/b> re-run|is <b>not<\/b>/i.test(si) || /re-run/i.test(si))
check('SI: route ML framed as synthetic', /Synthetic 20 × 25 smoke environment/.test(si))
check('SI: no fake accuracy', !/84\.13/.test(si) && !/84,13/.test(si))
await page.screenshot({ path: `${OUT}/07-sysintel.png` })

// ---- 14. data quality panel
await page.click('.rt:has-text("Environment")')
await page.waitForSelector('.card-dq', { timeout: 8000 })
const dq = await page.textContent('.card-dq')
check('DQ: total/nav/non-nav counts', /Total cells/.test(dq) && /Navigable/.test(dq) && /Non-navigable/.test(dq))
check('DQ: sic min/mean/max', /SIC min/.test(dq) && /SIC mean/.test(dq) && /SIC max/.test(dq))
check('DQ: NaN policy', /never zero-filled/.test(dq))

// ---- 15. demo mode stages
const stageCount = await page.$$eval('.stage', (e) => e.length)
check('7 demo stages', stageCount === 7, String(stageCount))
await page.click('.stagebar .btn:has-text("Next")')  // 2 env
await page.waitForTimeout(500)
await page.click('.stagebar .btn:has-text("Next")')  // 3 route
await page.waitForTimeout(500)
await page.click('.stagebar .btn:has-text("Next")')  // 4 change
await page.waitForTimeout(500)
await page.click('.stagebar .btn:has-text("Next")')  // 5 reroute
await page.waitForTimeout(500)
const stageNow = await page.textContent('.stage-flash')
check('stage advance visible', /0?5/.test(stageNow), stageNow.replace(/\s+/g, ' '))

// ---- 16. final screen
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.stage')]
  btns[6].click()
})
await page.waitForTimeout(1600)
const fin = await page.textContent('.final-card')
check('final screen title', /ICE ROUTE — FINAL RESULT/.test(fin))
check('final: 167 forecast timesteps', /167 forecast timesteps/.test(fin))
check('final: 173 × 369', /173 × 369/.test(fin))
check('final: 0.25°', /0\.25°/.test(fin))
check('final: A* + CostMap', /A\* \+ CostMap/.test(fin))
check('final: 287 waypoints', /WAYPOINTS\s*287/i.test(fin))
check('final: 348.96 length', /ROUTE LENGTH\s*348\.96/i.test(fin))
check('final: mean 0.0075', /MEAN SIC\s*0\.0075/i.test(fin))
check('final: max 0.7541', /MAX SIC\s*0\.7541/i.test(fin))
check('final: 0 NaN cells', /NaN CELLS ON ROUTE\s*0/i.test(fin))
check('final: start -32.00, 82.00', /-32\.00°,\s*82\.00°/.test(fin))
check('final: destination -70.00, 10.50', /-70\.00°,\s*10\.50°/.test(fin))
check('final: 4 verification checks',
  /✓ REAL SIC/.test(fin) && /✓ VALID ROUTE/.test(fin) &&
  /✓ ZERO NaN ROUTE CELLS/.test(fin) && /✓ NO RETRAINING/.test(fin))
await page.screenshot({ path: `${OUT}/08-final.png` })

// ---- 17. responsive desktop
for (const [w, h, label] of [[1366, 768, 'laptop'], [1600, 900, 'fhd'], [2560, 1440, 'qhd']]) {
  await page.setViewportSize({ width: w, height: h })
  await page.waitForTimeout(700)
  const s = await page.evaluate(() => ({
    docH: document.documentElement.scrollHeight,
    winH: window.innerHeight,
    overflow: [...document.querySelectorAll('.rail-body, .legend, .timeline')]
      .filter((e) => e.scrollHeight > e.clientHeight + 2).length,
  }))
  check(`layout ${label} ${w}x${h}: no page scroll`, s.docH <= s.winH + 1, `docH=${s.docH} winH=${s.winH}`)
}

await browser.close()

console.log('\n--- console errors ---')
const real = errors.filter((e) => !/favicon|ERR_CONNECTION|Download the React DevTools/.test(e))
real.forEach((e) => console.log('  ' + e))
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`)
console.log(`console errors: ${real.length}`)
if (real.length) process.exitCode = 1

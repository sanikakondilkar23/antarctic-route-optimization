import { chromium } from 'playwright'
import fs from 'node:fs'

const BASE = process.env.BASE || 'http://127.0.0.1:8010'
const OUT = 'C:/Users/Sanika/AppData/Local/Temp/opencode/shots'
fs.mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' \u2014 ' + detail : ''}`)
}
const errors = []

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))

await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForSelector('.map-shell canvas', { timeout: 40000 })
await page.waitForTimeout(3000)

// 1 -- fixed 100vh, the page itself must never scroll
const sc = await page.evaluate(() => ({
  sy: window.scrollY, sx: window.scrollX,
  docH: document.documentElement.scrollHeight, winH: window.innerHeight,
}))
check('no page-level scrolling', sc.sy === 0 && sc.docH <= sc.winH + 1,
  `docH=${sc.docH} winH=${sc.winH}`)

// 2 -- the map must be the dominant element
const shell = await page.locator('.map-shell').boundingBox()
const shareW = (shell.width / 1920) * 100
const shareH = (shell.height / 1080) * 100
check('map >= 60% of viewport width', shareW >= 60, `${shareW.toFixed(1)}%`)
check('map >= 70% of viewport height', shareH >= 70, `${shareH.toFixed(1)}%`)

// 3 -- grid is 16 / map / 18
const cols = await page.evaluate(() =>
  getComputedStyle(document.querySelector('.workspace')).gridTemplateColumns)
check('3-column grid, map is the middle column', cols.split(' ').length === 3, cols)

// 4 -- the real SIC raster is actually painted
const painted = await page.evaluate(() => {
  const c = document.querySelector('.map-shell canvas')
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  const seen = new Set()
  for (let i = 0; i < d.length; i += 4 * 97) seen.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`)
  return seen.size
})
check('real SIC raster painted', painted > 12, `${painted} distinct colour buckets`)

// 5 -- the four map overlays exist in the required corners
for (const [sel, label] of [['.hud-tl', 'top-left'], ['.hud-tr', 'top-right'],
  ['.hud-bl', 'bottom-left'], ['.hud-br', 'bottom-right']]) {
  check(`map overlay present: ${label}`, await page.locator(sel).isVisible())
}
const tl = await page.textContent('.hud-tl')
const tr0 = await page.textContent('.hud-tr')
const bl = await page.textContent('.hud-bl')
const br = await page.textContent('.hud-br')
check('TL overlay: REAL SIC + date + D0', /REAL SIC/.test(tl) && /2026-01-06/.test(tl) && /D0/.test(tl))
check('TR overlay: route + waypoints + units', /ROUTE/.test(tr0) && /waypoints/.test(tr0) && /grid units/.test(tr0), tr0.replace(/\s+/g, ' ').slice(0, 60))
check('BL overlay: SIC legend 0.0/0.5/1.0', /SIC LEGEND/.test(bl) && /0\.0/.test(bl) && /0\.5/.test(bl) && /1\.0/.test(bl))
check('BR overlay: START -> DESTINATION', /START/.test(br) && /DESTINATION/.test(br))

// 6 -- START marker must not be hidden behind the top-right overlay.
//     The leg starts on the exact top-right grid corner (-32.0, 82.0).
//     A positive value means the plate edge sits clear of the overlay band.
const clear = await page.evaluate(() => {
  const s = document.querySelector('.map-shell').getBoundingClientRect()
  const t = document.querySelector('.hud-tl').getBoundingClientRect()
  const o = document.querySelector('.hud-tr').getBoundingClientRect()
  const b = document.querySelector('.hud-bl').getBoundingClientRect()
  const brr = document.querySelector('.hud-br').getBoundingClientRect()
  return {
    top: s.top + 68 - Math.max(t.bottom, o.bottom),
    bot: Math.min(b.top, brr.top) - (s.bottom - 74),
  }
})
check('plate clears the top overlays (START visible)', clear.top > 0, `top clearance ${clear.top.toFixed(0)}px`)
check('plate clears the bottom overlays', clear.bot > 0, `bottom clearance ${clear.bot.toFixed(0)}px`)

// 7 -- left sidebar: compact, 7 stages, 8 layers
const stages = await page.$$eval('.ss-item', (e) => e.length)
check('7 demo stages in sidebar', stages === 7, String(stages))
const stageLabels = await page.$$eval('.ss-l', (e) => e.map((x) => x.textContent))
check('stages named 1..7',
  JSON.stringify(stageLabels) === JSON.stringify(['Intro', 'Environment', 'Route', 'Change', 'Rerouting', 'System', 'Result']),
  stageLabels.join(','))
const layers = await page.$$eval('.layer', (els) => els.map((e) => ({
  t: e.querySelector('.nm').textContent, off: e.classList.contains('off'),
})))
check('8 layer controls', layers.length === 8, String(layers.length))
check('SIC / Non-navigable / Route / Vessel on by default',
  ['SIC', 'Non-navigable', 'Route', 'Vessel'].every((n) => layers.find((l) => l.t === n && !l.off)))
check('Ocean Current reported unavailable',
  layers.find((l) => l.t === 'Ocean Current')?.off === true)
const lh = await page.$$eval('.layer', (e) => e.map((x) => x.getBoundingClientRect().height))
check('all 8 layer rows are the same compact height',
  Math.max(...lh) - Math.min(...lh) < 2 && Math.max(...lh) < 26,
  `rows ${Math.min(...lh).toFixed(0)}-${Math.max(...lh).toFixed(0)}px`)

// 8 -- right rail: the four required cards, all present
const cards = await page.$$eval('.icard .ic-t', (e) => e.map((x) => x.textContent))
for (const c of ['Environment', 'Route', 'Rerouting', 'System']) {
  check(`right rail card: ${c}`, cards.includes(c))
}
const railClip = await page.$eval('.sbar-r .sbar-scroll',
  (e) => ({ c: e.clientHeight, s: e.scrollHeight }))
check('right rail fits without scrolling at 1080', railClip.s <= railClip.c + 2,
  `content ${railClip.s}px in ${railClip.c}px`)

// 9 -- ENVIRONMENT card values come from the API
const env = await page.textContent('.icard:has(.ic-t:text-is("Environment"))')
check('ENV: date / D0 / SIC mean / SIC max / navigable',
  /2026-01-06/.test(env) && /SIC mean/i.test(env) && /SIC max/i.test(env)
  && /navigable/i.test(env) && /D0/.test(env), env.replace(/\s+/g, ' ').slice(0, 70))

// 10 -- OPTIMIZE ROUTE
await page.click('.dock button:has-text("Optimize Route")')
await page.waitForTimeout(4500)
const route = await page.textContent('.icard:has(.ic-t:text-is("Route"))')
check('OPTIMIZE: SUCCESS', /SUCCESS/.test(route))
check('OPTIMIZE: 287 waypoints', /287/.test(route))
check('OPTIMIZE: 348.96 units', /348\.96/.test(route))
check('OPTIMIZE: mean SIC 0.0075', /0\.0075/.test(route))
check('OPTIMIZE: max SIC 0.7541', /0\.7541/.test(route))
check('OPTIMIZE: 0 NaN cells on route', /NAN ON ROUTE\s*0/i.test(route.replace(/\s+/g, ' ')))
const tr1 = (await page.textContent('.hud-tr')).replace(/\s+/g, ' ')
check('TR overlay now shows 287 waypoints + 348.96', /287/.test(tr1) && /348\.96/.test(tr1), tr1.slice(0, 70))
const stageRoute = await page.textContent('.ss-item.active .ss-l')
check('stage becomes Route', stageRoute === 'Route', stageRoute)
await page.screenshot({ path: `${OUT}/v-01-optimized.png` })

// 11 -- DYNAMIC REROUTE
await page.click('.dock button:has-text("Dynamic Reroute")')
await page.waitForTimeout(6000)
const rr = await page.textContent('.icard:has(.ic-t:text-is("Rerouting"))')
check('REROUTE: leg D0 -> D3', /D0\s*\u2192\s*D3/.test(rr.replace(/\s+/g, ' ')), rr.replace(/\s+/g, ' ').slice(0, 60))
check('REROUTE: SUCCESS', /SUCCESS/.test(rr))
const stageRr = await page.textContent('.ss-item.active .ss-l')
check('stage becomes Rerouting', stageRr === 'Rerouting', stageRr)
const hudD3 = await page.textContent('.hud-tl')
check('map timestep moved to D3 (2026-01-09)', /2026-01-09/.test(hudD3) && /D3/.test(hudD3), hudD3.replace(/\s+/g, ' ').slice(0, 50))
await page.screenshot({ path: `${OUT}/v-02-rerouted.png` })

// 12 -- TIMELINE drives the real SIC timestep
const setStep = async (v) => {
  await page.evaluate((val) => {
    const r = document.querySelector('.tl-range')
    const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    s.call(r, String(val))
    r.dispatchEvent(new Event('input', { bubbles: true }))
  }, v)
  await page.waitForTimeout(2600)
}
await setStep(120)
const d120 = (await page.textContent('.hud-tl')).replace(/\s+/g, ' ')
check('timeline D120 -> 2026-05-06', /2026-05-06/.test(d120) && /D120/.test(d120), d120.slice(0, 50))
const env120 = await page.textContent('.icard:has(.ic-t:text-is("Environment"))')
check('environment metrics follow the timestep', /2026-05-06/.test(env120), env120.replace(/\s+/g, ' ').slice(0, 60))
check('timeline readout shows D120', /D120/.test((await page.textContent('.tl-right')).replace(/\s+/g, ' ')))
check('timeline shows the 5 labelled ticks D0..D166',
  (await page.$$eval('.tl-tick', (e) => e.map((x) => x.textContent))).join(',') === 'D0,D42,D83,D125,D166')
check('timeline shows the full window',
  /2026-01-06 \u2192 2026-06-21/.test((await page.textContent('.tl-span')).replace(/\s+/g, ' ')))
check('167 per-timestep ruler marks rendered',
  (await page.$$eval('.tl-ruler .rk', (e) => e.length)) === 167)
await page.screenshot({ path: `${OUT}/v-03-t120.png` })

// 13 -- PLAY FORECAST advances the timestep and can always be paused
await page.click('.tl-play')
const t0 = await page.textContent('.tl-right')
await page.waitForTimeout(2200)
const t1 = await page.textContent('.tl-right')
check('play forecast advances the timestep', t0 !== t1,
  t0.replace(/\s+/g, ' ').trim().slice(0, 30))
check('pause stays clickable while autoplay is running',
  await page.locator('.tl-play').isEnabled())
await page.locator('.tl-play').click({ timeout: 15000 })
await page.waitForTimeout(600)
check('play toggles back to idle',
  /Play forecast/.test(await page.textContent('.tl-play')))

// 14 -- neither rail is clipped at 1920
const clipL = await page.$eval('.sbar-l .sbar-scroll', (e) => ({ c: e.clientHeight, s: e.scrollHeight }))
check('left rail fits without scrolling at 1080', clipL.s <= clipL.c + 2,
  `content ${clipL.s}px in ${clipL.c}px`)

// 15 -- responsive: map must stay large and the page must not scroll
for (const [w, h, label] of [[1366, 768, 'laptop'], [1600, 900, 'fhd'], [2560, 1440, 'qhd']]) {
  await page.setViewportSize({ width: w, height: h })
  await page.waitForTimeout(900)
  const r = await page.evaluate(() => {
    const s = document.querySelector('.map-shell').getBoundingClientRect()
    return {
      docH: document.documentElement.scrollHeight, winH: window.innerHeight,
      wPct: (s.width / window.innerWidth) * 100,
      hPct: (s.height / window.innerHeight) * 100,
    }
  })
  check(`${label} ${w}x${h}: no page scroll`, r.docH <= r.winH + 1, `docH=${r.docH} winH=${r.winH}`)
  check(`${label} ${w}x${h}: map still dominant`,
    r.wPct >= 55 && r.hPct >= 68, `map ${r.wPct.toFixed(1)}%w x ${r.hPct.toFixed(1)}%h`)
  await page.screenshot({ path: `${OUT}/v-resp-${w}.png` })
}

// 16 -- narrow: sidebars collapse to drawers, map keeps the screen
await page.setViewportSize({ width: 1100, height: 800 })
await page.waitForTimeout(900)
check('narrow: drawer tabs appear', await page.locator('.drawer-tab.left').isVisible())
const nw = await page.evaluate(() => {
  const s = document.querySelector('.map-shell').getBoundingClientRect()
  return { wPct: (s.width / window.innerWidth) * 100, docH: document.documentElement.scrollHeight, winH: window.innerHeight }
})
check('narrow: map still dominant, no page scroll',
  nw.wPct >= 70 && nw.docH <= nw.winH + 1, `map ${nw.wPct.toFixed(1)}%w`)
await page.click('.drawer-tab.left')
await page.waitForTimeout(600)
check('narrow: left drawer opens', await page.locator('.sbar-l').evaluate(
  (e) => e.getBoundingClientRect().left >= -1))
await page.screenshot({ path: `${OUT}/v-resp-1100-drawer.png` })

await browser.close()
const real = errors.filter((e) => !/favicon|ERR_CONNECTION|DevTools/i.test(e))
console.log(`\n--- console errors (${real.length}) ---`)
real.slice(0, 10).forEach((e) => console.log('  ' + e))
const pass = results.filter((r) => r.ok).length
console.log(`\n${pass}/${results.length} checks passed`)
if (pass !== results.length || real.length) process.exitCode = 1

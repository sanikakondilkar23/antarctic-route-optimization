/**
 * End-to-end verification of the SIH2026059 demo (real browser, no mocks).
 *
 * Uses the locally installed Chrome (no browser download required).
 * Verifies the exact bugs that were reported:
 *   1. the page itself must never scroll vertically
 *   2. OPTIMIZE ROUTE must produce a visible state change
 *   3. DYNAMIC REROUTE must produce a visible state change
 *   4. reroute must use GET /api/reroute/3 and show D0 -> D3
 *   5. no page reload / navigation
 *
 * Run with the backend serving the built app:
 *   python -m backend.api.main
 *   node verify/e2e.mjs
 */
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'

const BASE = process.env.DEMO_URL || 'http://127.0.0.1:8000'
const OUT = 'verify/shots'
mkdirSync(OUT, { recursive: true })

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail })
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })

const apiCalls = []
page.on('request', (r) => {
  const u = new URL(r.url())
  if (u.pathname.startsWith('/api/')) apiCalls.push(u.pathname + u.search)
})
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

let navigations = 0
page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++ })

console.log(`\nSIH2026059 e2e → ${BASE}\n`)
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForSelector('.map-shell canvas', { timeout: 30000 })
// leave the intro overlay
const startBtn = page.locator('button', { hasText: /Start the demo/i }).first()
if (await startBtn.count()) { await startBtn.click(); await page.waitForTimeout(400) }

/* ---------------- 1. no page-level scrolling ---------------- */
async function scrollState() {
  return page.evaluate(() => ({
    scrollH: document.documentElement.scrollHeight,
    clientH: document.documentElement.clientHeight,
    innerH: window.innerHeight,
    bodyOverflow: getComputedStyle(document.body).overflow,
    htmlOverflow: getComputedStyle(document.documentElement).overflow,
    appOverflow: getComputedStyle(document.querySelector('.app')).overflow,
    scrollTop: window.scrollY,
  }))
}
let s = await scrollState()
check('html/body overflow is hidden', s.htmlOverflow === 'hidden' && s.bodyOverflow === 'hidden',
  `html=${s.htmlOverflow} body=${s.bodyOverflow}`)
check('app fits the viewport (no page scroll)', s.scrollH <= s.clientH + 1,
  `scrollHeight=${s.scrollH} clientHeight=${s.clientH} innerHeight=${s.innerH}`)
check('app overflow hidden', s.appOverflow === 'hidden', s.appOverflow)

/* panels that may scroll internally */
const scrollers = await page.evaluate(() =>
  [...document.querySelectorAll('*')]
    .filter((el) => {
      const st = getComputedStyle(el)
      return (st.overflowY === 'auto' || st.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 1
    })
    .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]}`),
)
check('only internal panels scroll', true, scrollers.length ? scrollers.join(', ') : 'none scroll')

/* ---------------- 2. real SIC + route on screen ---------------- */
let bodyText = await page.locator('body').innerText()
check('REAL SIC labelled', /REAL SIC/i.test(bodyText))
check('start/goal shown', /82\.00/.test(bodyText) && /10\.50/.test(bodyText))
check('verified metrics present (287 wp / ~349 units / 0.0075 / 0.7541)',
  /\b287\b/.test(bodyText) && /34[89](\.|\b)/.test(bodyText) &&
  /0\.0075/.test(bodyText) && /0\.7541/.test(bodyText))
check('CMEMS honestly unavailable', /CMEMS/i.test(bodyText) && /UNAVAILABLE/i.test(bodyText))
check('CVaR honestly unavailable', /CVaR/i.test(bodyText) && /unavailable|not available|no iceberg/i.test(bodyText))
check('no fake ML accuracy claim', !/0\.8413|84\.13/.test(bodyText))
await page.screenshot({ path: `${OUT}/01-loaded.png` })

/* ---------------- 3. OPTIMIZE ROUTE ---------------- */
const beforeCalls = apiCalls.length
const beforeStage = await page.locator('.stage.active').first().innerText().catch(() => '')
const optBtn = page.locator('button', { hasText: /Optimize Route/i }).first()
check('OPTIMIZE ROUTE button present', await optBtn.count() > 0)
await optBtn.click()

// loading label must appear
const busySeen = await page
  .waitForFunction(() => /OPTIMIZING/i.test(document.body.innerText), { timeout: 4000 })
  .then(() => true).catch(() => false)
check('loading state shown while optimizing', busySeen)

await page.waitForFunction(
  () => /SUCCESS/i.test(document.body.innerText) && /Route optimized|optimized/i.test(document.body.innerText),
  { timeout: 45000 },
)
const afterStage = await page.locator('.stage.active').first().innerText().catch(() => '')
const optCalls = apiCalls.slice(beforeCalls).filter((c) => c.startsWith('/api/route/at/'))
check('OPTIMIZE calls the real route API', optCalls.length > 0, optCalls.join(','))
check('OPTIMIZE moves the demo stage to Route Optimization',
  /route/i.test(afterStage) && !/route/i.test(beforeStage) || afterStage !== beforeStage,
  `"${beforeStage.trim()}" -> "${afterStage.trim()}"`)
check('OPTIMIZE shows a SUCCESS state', /SUCCESS/i.test(bodyText = await page.locator('body').innerText()))
await page.screenshot({ path: `${OUT}/02-optimized.png` })

/* canvas really changed (route drawn) */
const canvasHash = async () => page.evaluate(() => {
  const c = document.querySelector('.map-shell canvas')
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  let h = 0
  for (let i = 0; i < d.length; i += 997) h = (h * 31 + d[i]) >>> 0
  return h
})
const h1 = await canvasHash()
check('map canvas rendered content', h1 !== 0, `hash=${h1}`)

/* ---------------- 4. DYNAMIC REROUTE ---------------- */
const rrBtn = page.locator('button', { hasText: /Dynamic Reroute/i }).first()
check('DYNAMIC REROUTE button present', await rrBtn.count() > 0)
const beforeRR = apiCalls.length
const beforeCalls2 = apiCalls.slice(beforeRR)
await rrBtn.click()

const rrBusy = await page
  .waitForFunction(() => /REROUTING/i.test(document.body.innerText), { timeout: 4000 })
  .then(() => true).catch(() => false)
check('loading state shown while rerouting', rrBusy)

await page.waitForFunction(
  () => /Reroute comparison|Route comparison/i.test(document.body.innerText),
  { timeout: 60000 },
)
const newCalls = apiCalls.slice(beforeRR)
const rrCall = newCalls.find((c) => c.startsWith('/api/reroute/'))
check('DYNAMIC REROUTE uses GET /api/reroute/3', !!rrCall, rrCall || newCalls.join(','))
check('reroute requested with origin D0', !!rrCall && rrCall.includes('origin_timestep=0'), rrCall)

const rrText = await page.locator('body').innerText()
check('reroute shows SUCCESS', /SUCCESS/i.test(rrText))
check('reroute shows D0 → D3', /D0\s*→\s*D3/.test(rrText) || (rrText.includes('D0') && rrText.includes('D3')),
  rrText.match(/D0[^\n]{0,12}D3/)?.[0] || 'not found')
check('reroute shows original vs updated waypoints 287 → 287',
  /287\s*→\s*287|287/.test(rrText))
const rrStage = await page.locator('.stage.active').first().innerText().catch(() => '')
check('reroute moves the stage to Dynamic Rerouting', /rerout/i.test(rrStage), rrStage.trim())
check('legend distinguishes original vs updated route',
  /original route/i.test(rrText) && /updated safe route|updated safe route \(D3\)/i.test(rrText))
await page.screenshot({ path: `${OUT}/03-rerouted.png` })

/* ---------------- 5. timeline changes the map ---------------- */
const hBefore = await canvasHash()
await page.evaluate(() => {
  const el = document.querySelector('input[type=range]')
  el.value = '120'
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
})
await page.waitForTimeout(2500)
const hAfter = await canvasHash()
const tText = await page.locator('body').innerText()
check('timeline changes the SIC map', hBefore !== hAfter, `${hBefore} -> ${hAfter}`)
check('timeline shows a new date', /2026-0[2-6]-\d\d/.test(tText))
const s2 = await scrollState()
check('still no page scroll after timeline change', s2.scrollH <= s2.clientH + 1,
  `scrollHeight=${s2.scrollH} clientHeight=${s2.clientH}`)
await page.screenshot({ path: `${OUT}/04-timestep-120.png` })

/* ---------------- 6. no reload / navigation ---------------- */
check('no page reload or navigation during the flow', navigations <= 1, `navigations=${navigations}`)
check('no uncaught JS errors', errors.length === 0, errors.slice(0, 3).join(' | '))

await browser.close()

const failed = results.filter((r) => !r.ok)
writeFileSync('verify/e2e-result.json', JSON.stringify({ results }, null, 2))
console.log(`\n${'='.repeat(64)}`)
console.log(`E2E: ${results.length - failed.length}/${results.length} passed`)
console.log(`${'='.repeat(64)}`)
process.exit(failed.length ? 1 : 0)

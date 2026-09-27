import { chromium } from 'playwright'

/**
 * End-to-end acceptance check against the RUNNING backend (port 8000).
 * Everything asserted here is read back out of the live DOM, which is only
 * populated by real API responses.
 */
const BASE = 'http://127.0.0.1:8000'
const b = await chromium.launch({ channel: 'chrome', headless: true })
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })

const posts = []
const gets = []
const failures = []
p.on('request', (r) => {
  if (r.url().includes('/api/')) {
    ;(r.method() === 'POST' ? posts : gets).push(`${r.method()} ${r.url().replace(BASE, '')}`)
  }
})
p.on('response', async (r) => {
  if (r.url().includes('/api/') && r.status() >= 400) failures.push(`${r.status()} ${r.url()}`)
})
const errors = []
p.on('pageerror', (e) => errors.push(String(e)))
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await p.goto(BASE, { waitUntil: 'networkidle' })
await p.waitForSelector('.planner', { timeout: 30000 })
await p.waitForTimeout(2500)

const box = async (sel) => {
  const el = await p.$(sel)
  if (!el) return null
  const r = await el.boundingBox()
  return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null
}

console.log('=== LAYOUT ===')
const map = await box('.mapcol')
const rail = await box('.rail')
const vp = p.viewportSize()
console.log('map      ', map, `${(((map.w * map.h) / (vp.width * vp.height)) * 100).toFixed(1)}% of viewport area`)
console.log('map width', `${((map.w / vp.width) * 100).toFixed(1)}% of viewport width`)
console.log('rail     ', rail)
console.log('canvas   ', await box('.map-shell canvas'))

console.log('\n=== PRE-OPTIMIZE STATE ===')
console.log('metrics card:', (await p.textContent('.card .empty').catch(() => 'MISSING')).slice(0, 70))
console.log('pipeline   :', (await p.textContent('.pipeline')).replace(/\s+/g, ' ').trim())
console.log('legend     :', (await p.textContent('.ovb-legend-stats').catch(() => 'MISSING')).replace(/\s+/g, ' ').trim())

console.log('\n=== ACTION 1: OPTIMIZE ROUTE (baseline leg) ===')
await p.click('.btn-primary.wide')
await p.waitForSelector('.metrics', { timeout: 90000 })
await p.waitForTimeout(1200)
const metrics = await p.$$eval('.card .mrow', (rows) =>
  rows.map((r) => `${r.querySelector('.mk').textContent}=${r.querySelector('.mv').textContent}`))
metrics.forEach((m) => console.log('  ', m))
console.log('notice  :', (await p.textContent('.fc-notice')).replace(/\s+/g, ' ').trim())
console.log('checks  :', (await p.textContent('.checks')).replace(/\s+/g, ' ').trim())
await p.screenshot({ path: 'verify/shots/planner-01-optimized.png' })

console.log('\n=== ACTION 2: change endpoints -> different real route ===')
const latIn = await p.$$('.ep-fields .num')
await latIn[0].fill('-34.0'); await latIn[1].fill('18.5')
await latIn[2].fill('-69.41'); await latIn[3].fill('76.19')
await p.click('.btn-primary.wide')
await p.waitForTimeout(5000)
console.log('notice  :', (await p.textContent('.fc-notice')).replace(/\s+/g, ' ').trim())
const m2 = await p.$$eval('.card .mrow', (rows) =>
  rows.map((r) => `${r.querySelector('.mk').textContent}=${r.querySelector('.mv').textContent}`))
m2.forEach((m) => console.log('  ', m))
await p.screenshot({ path: 'verify/shots/planner-02-capetown-bharati.png' })

console.log('\n=== ACTION 2b: out-of-grid coordinate must be REJECTED, not faked ===')
await latIn[0].fill('-34.0'); await latIn[1].fill('-56.0')
await p.click('.btn-primary.wide')
await p.waitForTimeout(3000)
console.log('notice  :', (await p.textContent('.fc-notice')).replace(/\s+/g, ' ').trim())
await latIn[1].fill('18.5')
await p.click('.btn-primary.wide')
await p.waitForTimeout(5000)
console.log('restored:', (await p.textContent('.fc-notice')).replace(/\s+/g, ' ').trim())

console.log('\n=== ACTION 3: dynamic reroute to D100 ===')
await p.fill('.fc-row.reroute .num', '100')
await p.click('.btn-warn.sm')
await p.waitForSelector('.seg-list', { timeout: 120000 })
await p.waitForTimeout(1500)
console.log('notice  :', (await p.textContent('.fc-notice')).replace(/\s+/g, ' ').trim())
console.log('segments:', (await p.textContent('.seg-list')).replace(/\s+/g, ' ').trim())
console.log('env chg :', (await p.textContent('.env-chg')).replace(/\s+/g, ' ').trim())
await p.screenshot({ path: 'verify/shots/planner-03-rerouted.png' })

console.log('\n=== ACTION 4: change timestep -> new SIC raster ===')
await p.evaluate(() => {
  const r = document.querySelector('.tl-range')
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(r, '140')
  r.dispatchEvent(new Event('input', { bubbles: true }))
  r.dispatchEvent(new Event('change', { bubbles: true }))
})
await p.waitForTimeout(4000)
console.log('top-left HUD:', (await p.textContent('.hud-tl')).replace(/\s+/g, ' ').trim())
console.log('legend      :', (await p.textContent('.ovb-legend-stats')).replace(/\s+/g, ' ').trim())

console.log('\n=== PROVENANCE (must not be fabricated) ===')
const prov = (await p.textContent('.prov')).replace(/\s+/g, ' ').trim()
console.log(prov.slice(0, 900))
await p.screenshot({ path: 'verify/shots/planner-04-final.png', fullPage: false })

console.log('\n=== NETWORK ===')
console.log('POSTs:', posts.join(' | ') || 'NONE')
console.log('GETs :', gets.join(' | '))
console.log('HTTP failures:', failures.length ? failures.join(' | ') : 'none')
console.log('page errors  :', errors.length ? errors.join(' | ') : 'none')

await b.close()

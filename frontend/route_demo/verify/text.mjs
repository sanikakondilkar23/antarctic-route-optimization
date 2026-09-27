import { chromium } from 'playwright'
const b = await chromium.launch({ channel: 'chrome', headless: true })
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
await p.goto('http://127.0.0.1:8000', { waitUntil: 'networkidle' })
await p.waitForTimeout(4000)
const t = await p.locator('body').innerText()
const lines = t.split('\n').map(s => s.trim()).filter(Boolean)
for (const l of lines) if (/287|349|0\.00|0\.75|waypoint|cmems|unavail|length|SIC/i.test(l)) console.log('  |', l)
await b.close()

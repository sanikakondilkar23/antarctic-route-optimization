import { chromium } from 'playwright'
const b = await chromium.launch({ channel: 'chrome', headless: true })
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
await p.goto('http://127.0.0.1:8000', { waitUntil: 'networkidle' })
await p.waitForSelector('.planner'); await p.waitForTimeout(2500)
await p.screenshot({ path: 'verify/shots/map-v2-before.png' })
await p.click('.btn-primary.wide')
await p.waitForSelector('.metrics'); await p.waitForTimeout(3000)
await p.screenshot({ path: 'verify/shots/map-v2-route.png' })
const z = await p.evaluate(() => {
  const el = document.querySelector('.map-zoom')
  return { zoomBadge: el ? el.textContent : 'none' }
})
console.log(JSON.stringify(z))
await b.close()

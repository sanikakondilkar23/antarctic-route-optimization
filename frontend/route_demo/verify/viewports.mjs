import { chromium } from 'playwright'
const b = await chromium.launch({ channel: 'chrome', headless: true })
for (const vp of [{ width: 1440, height: 900 }, { width: 2560, height: 1200 }]) {
  const p = await b.newPage({ viewport: vp })
  await p.goto('http://127.0.0.1:8000', { waitUntil: 'networkidle' })
  await p.waitForSelector('.planner'); await p.waitForTimeout(2000)
  await p.click('.btn-primary.wide'); await p.waitForSelector('.metrics'); await p.waitForTimeout(2500)
  const m = await (await p.$('.mapcol')).boundingBox()
  const pct = ((m.width * m.height) / (vp.width * vp.height)) * 100
  const scroll = await p.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight)
  console.log(`${vp.width}x${vp.height}  map ${Math.round(m.width)}x${Math.round(m.height)} = ${pct.toFixed(1)}%  page scroll overflow: ${scroll}px`)
  await p.screenshot({ path: `verify/shots/map-v2-${vp.width}.png` })
  await p.close()
}
await b.close()

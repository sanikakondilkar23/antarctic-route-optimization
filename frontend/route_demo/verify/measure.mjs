import { chromium } from 'playwright'
const b = await chromium.launch({ channel: 'chrome', headless: true })
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
await p.goto('http://127.0.0.1:8000', { waitUntil: 'networkidle' })
await p.waitForTimeout(4000)
const m = await p.evaluate(() => {
  const out = {}
  const sel = ['html','body','#root','.app','.header','.workspace','.leftrail','.mapcol','.map-shell','.map-shell canvas','.control','.timeline','.statusbar','.legend']
  for (const s of sel) {
    const el = document.querySelector(s)
    if (!el) { out[s] = 'MISSING'; continue }
    const r = el.getBoundingClientRect()
    const st = getComputedStyle(el)
    out[s] = `h=${Math.round(r.height)} w=${Math.round(r.width)} top=${Math.round(r.top)} ovY=${st.overflowY} flex=${st.flex} minH=${st.minHeight}`
  }
  out.__scroll = `scrollH=${document.documentElement.scrollHeight} clientH=${document.documentElement.clientHeight} innerH=${window.innerHeight} bodyScrollH=${document.body.scrollHeight}`
  return out
})
for (const [k, v] of Object.entries(m)) console.log(k.padEnd(20), v)
await b.close()

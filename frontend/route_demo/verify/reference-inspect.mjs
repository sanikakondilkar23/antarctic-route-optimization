import { chromium } from 'playwright'

/**
 * Reference-site inspection only. Captures the deployed /routes page so its
 * MAP presentation (composition, framing, legend, controls, hierarchy) can be
 * studied. Nothing here is copied: no code, no assets, no data.
 */
const b = await chromium.launch({ channel: 'chrome', headless: true })
const p = await b.newPage({ viewport: { width: 1600, height: 950 } })
const net = []
p.on('request', (r) => net.push(`${r.method()} ${r.url().replace('https://frontend-pearl-nine-74.vercel.app', '')}`))

await p.goto('https://frontend-pearl-nine-74.vercel.app/routes', { waitUntil: 'domcontentloaded', timeout: 90000 })
await p.waitForTimeout(12000)
await p.screenshot({ path: 'verify/shots/reference-routes.png' })

// structural read-out: what dominates the page, and where
const info = await p.evaluate(() => {
  const out = { title: document.title, blocks: [] }
  const walk = (el, depth) => {
    for (const c of el.children) {
      const r = c.getBoundingClientRect()
      if (r.width < 40 || r.height < 20) continue
      const cs = getComputedStyle(c)
      out.blocks.push({
        d: depth,
        tag: c.tagName.toLowerCase(),
        cls: (c.className || '').toString().slice(0, 60),
        w: Math.round(r.width), h: Math.round(r.height),
        area: Math.round((r.width * r.height) / 1000) + 'kpx',
        pos: cs.position,
        bg: cs.backgroundColor,
        radius: cs.borderRadius,
      })
      if (depth < 4) walk(c, depth + 1)
    }
  }
  walk(document.body, 0)
  out.blocks.sort((a, b2) => (b2.w * b2.h) - (a.w * a.h))
  out.blocks = out.blocks.slice(0, 26)
  out.svgCount = document.querySelectorAll('svg').length
  out.canvasCount = document.querySelectorAll('canvas').length
  out.imgCount = document.querySelectorAll('img').length
  out.pathCount = document.querySelectorAll('svg path').length
  out.text = (document.body.innerText || '').slice(0, 1600)
  return out
})
console.log('title:', info.title)
console.log('svg:', info.svgCount, 'canvas:', info.canvasCount, 'img:', info.imgCount, 'svg paths:', info.pathCount)
console.log('\n--- largest blocks (w x h) ---')
info.blocks.forEach((b2) => console.log(`  ${b2.area.padStart(8)}  ${String(b2.w).padStart(5)}x${String(b2.h).padStart(4)}  ${b2.tag}.${b2.cls}  pos=${b2.pos} bg=${b2.bg} r=${b2.radius}`))
console.log('\n--- visible text ---')
console.log(info.text)
console.log('\n--- network (first 40) ---')
console.log([...new Set(net)].slice(0, 40).join('\n'))
await b.close()

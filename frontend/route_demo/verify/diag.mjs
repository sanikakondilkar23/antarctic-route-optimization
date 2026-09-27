import { chromium } from 'playwright'
const b = await chromium.launch({ channel: 'chrome', headless: true })
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } })
const errs = []
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message))
p.on('console', m => errs.push(m.type().toUpperCase() + ': ' + m.text()))
const resp = []
p.on('response', r => { if (r.url().includes('/api/') || r.status() >= 400) resp.push(r.status() + ' ' + new URL(r.url()).pathname) })
await p.goto('http://127.0.0.1:8000', { waitUntil: 'networkidle' })
await p.waitForTimeout(6000)
console.log('URL:', p.url())
console.log('TITLE:', await p.title())
console.log('root children:', await p.evaluate(() => document.getElementById('root')?.children.length))
console.log('body text (400):', (await p.locator('body').innerText()).slice(0, 400))
console.log('has .map-shell:', await p.locator('.map-shell').count())
console.log('has .boot:', await p.locator('.boot').count())
console.log('api/responses:', resp.slice(0, 12).join(' | '))
console.log('errors:', errs.slice(0, 10).join('\n  '))
await b.close()

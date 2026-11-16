// Cinematic 3D on a real GPU (headed Chrome, Metal): node e2e/cinematic.mjs [baseUrl]. SwiftShader cannot
// path-trace the anchor volume in time, so this is a local check, not CI.
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5299/'
const STUDY = '1.2.840.113654.2.55.187766322555605983451267194286230980878'
const LUNG_CT = '1.2.840.113654.2.55.122344168497038128022524906545138736420'
const shot = process.env.SHOT ?? 'cinematic'
const browser = await chromium.launch({ headless: false, args: ['--use-angle=metal', '--enable-unsafe-webgpu'] })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => (m.type() === 'error' || /cinematic:/.test(m.text())) && errors.push(`${m.text()} ${m.location().url}`))
let failed = 0
const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg); if (!ok) failed++ }
// Fraction of the canvas area that is not background, from a screenshot (a WebGL/WebGPU canvas
// cannot be read back without preserveDrawingBuffer). A black render is the failure being guarded.
const lit = async () => {
  const box = await page.locator('#gl').boundingBox()
  const png = (await page.screenshot({ clip: box })).toString('base64')
  return page.evaluate(async (src) => {
    const img = new Image(); img.src = `data:image/png;base64,${src}`; await img.decode()
    const g = document.createElement('canvas'); g.width = 200; g.height = 150
    const ctx = g.getContext('2d'); ctx.drawImage(img, 0, 0, 200, 150)
    const d = ctx.getImageData(0, 0, 150, 150).data // left part: skip the legend
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 150) n++
    return n / (d.length / 4)
  }, png)
}
await page.goto(`${base}?StudyInstanceUIDs=${STUDY}`)
await page.waitForFunction(() => /segments/.test(document.getElementById('status').textContent), null, { timeout: 300000 })
check(/\(68 with 3D materials\)/.test(await page.textContent('#status')), `materials by SNOMED code: ${await page.textContent('#status')}`)
await page.check('#cinematic')
await page.waitForTimeout(6000)
const seg = await page.evaluate(() => [nv.volumeRenderMode, nv.volumes[1].colormap.endsWith('-3d'), nv.volumeCinematic.labelMode].join())
check(seg === '3,true,only', `cinematic with material table (${seg})`)
const segLit = await lit()
check(segLit > 0.05, `labels render (${(segLit * 100).toFixed(1)}% lit)`)
await page.screenshot({ path: `${shot}-seg.png` })
await page.selectOption('#series', LUNG_CT)
await page.waitForFunction((u) => document.body.dataset.shown === u, LUNG_CT, { timeout: 300000 })
await page.waitForTimeout(6000)
const ct = await page.evaluate(() => [nv.volumeRenderMode, nv.volumes.length, nv.volumes[0].colormap, nv.volumeCinematic.labelMode].join())
check(ct === '3,1,ct_cinematic,unlabeled', `CT alone stays cinematic (${ct})`)
check((await lit()) > 0.05, 'CT renders')
await page.screenshot({ path: `${shot}-ct.png` })
await page.uncheck('#cinematic')
check((await page.evaluate(() => [nv.volumeRenderMode, nv.volumes[0].colormap].join())) === '0,gray', 'off restores grey composite')
check(errors.length === 0, `no console errors ${errors.join(' | ')}`)
await browser.close()
process.exit(failed ? 1 : 0)

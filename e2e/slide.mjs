// Live slide smoke (IDC DICOMweb proxy): node e2e/slide.mjs [baseUrl]. Not for CI.
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5299/'
// CC BY 4.0 slides from two collections and codecs: CPTAC-LUAD JPEG baseline (series 162 MB),
// CATCH JPEG 2000 (series 239 MB; needs dcm2niix decoders).
const SLIDES = [['2.25.11321499043287739942958746184768363349', 162e6], ['2.25.19454760007169100657755148757857609085', 239e6]]
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
let frames = 0, bytes = 0, metaBytes = 0
page.on('response', async (r) => {
  if (!r.url().includes('/dicomWeb/')) return
  const n = (await r.body().catch(() => Buffer.alloc(0))).length
  if (r.url().includes('/frames/')) { frames++; bytes += n } else metaBytes += n
})
let failed = 0
const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg); if (!ok) failed++ }
for (const [STUDY, size] of SLIDES) {
frames = 0; bytes = 0; metaBytes = 0; errors.length = 0
const t = Date.now()
await page.goto(`${base}?StudyInstanceUIDs=${STUDY}`)
await page.waitForFunction(() => document.body.dataset.shown, null, { timeout: 120000 })
await page.waitForTimeout(3000)
check(!(await page.locator('#slide').isHidden()), `slide canvas shown (${((Date.now() - t) / 1000).toFixed(1)}s): ${await page.textContent('#status')}`)
const open = { frames, bytes }
const box = await page.locator('#slide').boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(150) }
await page.waitForTimeout(3000)
await page.screenshot({ path: `${process.env.SHOT ?? 'slide-shot'}-${STUDY.slice(-6)}.png` })
console.log(`open: ${open.frames} frames ${(open.bytes / 1e6).toFixed(2)} MB; after zoom: ${frames} frames ${(bytes / 1e6).toFixed(2)} MB; metadata ${(metaBytes / 1e6).toFixed(2)} MB`)
check(frames > open.frames, 'zoom fetched more tiles')
check(bytes < size / 8, `far less than the ${size / 1e6} MB series`)
check(errors.length === 0, `no console errors ${errors.join(' | ')}`)
}
await browser.close()
process.exit(failed ? 1 : 0)

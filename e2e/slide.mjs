// Live slide smoke (IDC DICOMweb proxy): node e2e/slide.mjs [baseUrl]. Not for CI.
import { harness, launch } from './lib.mjs'

const base = process.argv[2] ?? 'http://localhost:5173/'
// CC BY 4.0 slides from two collections and codecs: CPTAC-LUAD JPEG baseline (series 162 MB),
// CATCH JPEG 2000 (series 239 MB; needs dcm2niix decoders).
const SLIDES = [['2.25.11321499043287739942958746184768363349', 162e6], ['2.25.19454760007169100657755148757857609085', 239e6]]
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const { errors, check, backendCheck, noErrors, done } = harness(page)
let frames = 0, bytes = 0, metaBytes = 0
page.on('response', async (r) => {
  if (!r.url().includes('/dicomWeb/')) return
  const n = (await r.body().catch(() => Buffer.alloc(0))).length
  if (r.url().includes('/frames/')) { frames++; bytes += n } else metaBytes += n
})
for (const [STUDY, size] of SLIDES) {
frames = 0; bytes = 0; metaBytes = 0; errors.length = 0
const t = Date.now()
await page.goto(`${base}?StudyInstanceUIDs=${STUDY}`)
await page.waitForFunction(() => document.body.dataset.shown, null, { timeout: 120000 })
await page.waitForTimeout(3000)
check(!(await page.locator('#slide').isHidden()), `slide canvas shown (${((Date.now() - t) / 1000).toFixed(1)}s): ${await page.textContent('#status')}`)
await backendCheck(page)
const open = { frames, bytes }
const box = await page.locator('#slide').boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
for (let i = 0; i < 12; i++) { await page.mouse.wheel(0, -400); await page.waitForTimeout(150) }
await page.waitForTimeout(3000)
await page.screenshot({ path: `${process.env.SHOT ?? 'slide-shot'}-${STUDY.slice(-6)}.png` })
console.log(`open: ${open.frames} frames ${(open.bytes / 1e6).toFixed(2)} MB; after zoom: ${frames} frames ${(bytes / 1e6).toFixed(2)} MB; metadata ${(metaBytes / 1e6).toFixed(2)} MB`)
check(frames > open.frames, 'zoom fetched more tiles')
check(bytes < size / 8, `far less than the ${size / 1e6} MB series`)
noErrors()
}
// Multiplexed fluorescence (HTAN-OHSU, CC BY 4.0, JPEG 2000 lossless, series 2.1 GB): one slide per optical path; the picker switches channel.
{
  errors.length = 0
  await page.goto(`${base}?StudyInstanceUIDs=2.25.56219147941526607962658668060030231728&SeriesInstanceUIDs=1.3.6.1.4.1.5962.99.1.2000002781.2080371485.1655562444509.4.0`)
  await page.waitForFunction(() => document.body.dataset.shown, null, { timeout: 120000 })
  const n = await page.locator('#slidePath option').count()
  check(n > 1 && (await page.isVisible('#slidePath')), `optical-path picker lists ${n} slides: ${await page.textContent('#status')}`)
  const before = frames
  await page.selectOption('#slidePath', String(n - 1))
  await page.waitForTimeout(4000)
  check(frames > before, `switching path fetches its tiles (${frames - before} frames)`)
  await page.screenshot({ path: `${process.env.SHOT ?? 'slide-shot'}-fluor.png` })
  noErrors()
}
await browser.close()
done()

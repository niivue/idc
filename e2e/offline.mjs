// Offline workflow (no IDC/S3 traffic; CI-able): IDC SQL and S3 are served from e2e/fixture.
// node e2e/offline.mjs [baseUrl]   (fixture: tools/make_fixture.py)
import { readdirSync, readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const base = process.argv[2] ?? 'http://localhost:5299/'
const dir = new URL('./fixture/', import.meta.url)
const fx = JSON.parse(readFileSync(new URL('points.json', dir)))
const row = (uid, modality, n, uuid, seg) => ({
  SeriesInstanceUID: uid, Modality: modality, SeriesDescription: modality, instanceCount: n, aws_bucket: 'fixture',
  crdc_series_uuid: uuid, license_short_name: 'CC BY 4.0', source_DOI: '10.0/fixture',
  SegmentationType: seg ? 'BINARY' : null, total_segments: seg ? 2 : null, segmented_SeriesInstanceUID: seg ? fx.ct : null,
  regularly_spaced_3d_volume: seg ? null : true,
})
const sql = { rows: [row(fx.ct, 'CT', 4, 'ct', false), row(fx.seg, 'SEG', 1, 'seg', true)], truncated: false }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
await page.route('https://api.imaging.datacommons.cancer.gov/**', (r) => r.fulfill({ json: sql }))
await page.route('https://fixture.s3.us-east-1.amazonaws.com/**', (r) => {
  const url = new URL(r.request().url())
  const prefix = url.searchParams.get('prefix')
  if (prefix) {
    const keys = readdirSync(new URL(prefix, dir)).map((f) => `<Contents><Key>${prefix}${f}</Key></Contents>`)
    return r.fulfill({ body: `<ListBucketResult>${keys.join('')}</ListBucketResult>`, headers: { 'access-control-allow-origin': '*' } })
  }
  return r.fulfill({ body: readFileSync(new URL(url.pathname.slice(1), dir)), headers: { 'access-control-allow-origin': '*' } })
})
let failed = 0
const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg); if (!ok) failed++ }
await page.goto(`${base}?StudyInstanceUIDs=${fx.study}`)
await page.waitForFunction(() => document.body.dataset.shown, null, { timeout: 60000 })
const st = await page.evaluate(() => [document.body.dataset.shown, nv.volumes.length, document.getElementById('status').textContent].join('|'))
check(st.startsWith(`${fx.seg}|2`), `study link autoloads the SEG over its CT (${st})`)
const labels = await page.evaluate((pts) => pts.map((p) => {
  let label
  const on = (e) => { label = e.detail.values[1]?.label ?? '' }
  nv.addEventListener('locationChange', on)
  nv.setCrosshairPos(p.mm)
  nv.removeEventListener('locationChange', on)
  return label
}), fx.points)
check(fx.points.every((p, i) => labels[i] === p.label), `labels at off-centre points: ${labels.map((l) => l || '(none)').join(', ')}`)
await page.selectOption('#series', fx.ct)
await page.waitForFunction((u) => document.body.dataset.shown === u, fx.ct)
check((await page.evaluate(() => nv.volumes.length)) === 1, 'explicit CT shows alone')
check(errors.length === 0, `no console errors ${errors.join(' | ')}`)
await browser.close()
process.exit(failed ? 1 : 0)

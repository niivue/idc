// Offline workflow (no IDC/S3 traffic; CI-able): IDC SQL and S3 are served from e2e/fixture.
// node e2e/offline.mjs [baseUrl]   (fixture: tools/make_fixture.py)
import { readdirSync, readFileSync } from 'node:fs'
import { harness, labelsAt, launch } from './lib.mjs'

const base = process.argv[2] ?? 'http://localhost:5173/'
const dir = new URL('./fixture/', import.meta.url)
const fx = JSON.parse(readFileSync(new URL('points.json', dir)))
const row = (uid, modality, n, uuid, seg) => ({
  SeriesInstanceUID: uid, Modality: modality, SeriesDescription: modality, instanceCount: n, aws_bucket: 'fixture',
  crdc_series_uuid: uuid, license_short_name: 'CC BY 4.0', source_DOI: '10.0/fixture',
  SegmentationType: seg ? 'BINARY' : null, segmented_SeriesInstanceUID: seg ? fx.ct : null,
  regularly_spaced_3d_volume: seg ? null : true,
})
const sql = { rows: [row(fx.ct, 'CT', 4, 'ct', false), row(fx.seg, 'SEG', 1, 'seg', true)], truncated: false }

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
const { errors, check, backendCheck, noErrors, done } = harness(page)
await page.route('https://api.imaging.datacommons.cancer.gov/**', (r) => r.fulfill({ json: sql }))
/** Fixture S3: list + GET; `failSeg` answers the SEG GET with 503. */
const s3 = (failSeg) => (r) => {
  const url = new URL(r.request().url())
  const prefix = url.searchParams.get('prefix')
  const cors = { 'access-control-allow-origin': '*' }
  if (prefix) {
    const keys = readdirSync(new URL(prefix, dir)).map((f) => `<Contents><Key>${prefix}${f}</Key></Contents>`)
    return r.fulfill({ body: `<ListBucketResult>${keys.join('')}</ListBucketResult>`, headers: cors })
  }
  if (failSeg && url.pathname.startsWith('/seg/')) return r.fulfill({ status: 503, headers: cors })
  return r.fulfill({ body: readFileSync(new URL(url.pathname.slice(1), dir)), headers: cors })
}
await page.route('https://fixture.s3.us-east-1.amazonaws.com/**', s3(false))
await page.goto(`${base}?StudyInstanceUIDs=${fx.study}`)
await page.waitForFunction(() => document.body.dataset.shown, null, { timeout: 60000 })
await backendCheck(page)
const st = await page.evaluate(() => [document.body.dataset.shown, nv.volumes.length, document.getElementById('status').textContent].join('|'))
check(st.startsWith(`${fx.seg}|2`), `study link autoloads the SEG over its CT (${st})`)
const labels = await labelsAt(page, fx.points)
check(fx.points.every((p, i) => labels[i] === p.label), `labels at off-centre points: ${labels.map((l) => l || '(none)').join(', ')}`)
await page.selectOption('#series', fx.ct)
await page.waitForFunction((u) => document.body.dataset.shown === u, fx.ct)
check((await page.evaluate(() => nv.volumes.length)) === 1, 'explicit CT shows alone')
noErrors()

// Partial failure: the image installs, its SEG download fails. UI and URL must name the image, and the
// message must not claim the previous selection is shown.
const p2 = await browser.newPage()
await p2.route('https://api.imaging.datacommons.cancer.gov/**', (r) => r.fulfill({ json: sql }))
await p2.route('https://fixture.s3.us-east-1.amazonaws.com/**', s3(true))
await p2.goto(`${base}?StudyInstanceUIDs=${fx.study}`)
await p2.waitForFunction(() => document.body.dataset.shown !== undefined && document.getElementById('status').classList.contains('error'), null, { timeout: 60000 })
const partial = await p2.evaluate(() => [document.body.dataset.shown, nv.volumes.length, new URL(location).searchParams.get('SeriesInstanceUIDs'), document.getElementById('status').textContent].join('|'))
check(partial.startsWith(`${fx.ct}|1|${fx.ct}|`) && partial.endsWith('Showing the image without its segmentation.'), `SEG failure keeps the image, says so (${partial.split('|')[3]})`)
await browser.close()
done()

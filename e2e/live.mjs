// Live smoke against IDC: node e2e/live.mjs [baseUrl]. Not for CI (hits public IDC/S3).
import { readFileSync } from 'node:fs'
import { gpu, launch } from './launch.mjs'

const base = process.argv[2] ?? 'http://localhost:5299/'
const STUDY = '1.2.840.113654.2.55.187766322555605983451267194286230980878'
const LUNG_SEG = '1.2.276.0.7230010.3.1.3.313263360.20363.1706320514.804396'
const STD_SEG = '1.2.276.0.7230010.3.1.3.313263360.40027.1706310312.485948'
const LUNG_CT = '1.2.840.113654.2.55.122344168497038128022524906545138736420'
// One point per segment (RAS mm) + label counts, from tools/seg_points.py on verify_seg.py-validated NIfTIs.
const fixture = (n) => JSON.parse(readFileSync(new URL(`./${n}-points.json`, import.meta.url)))

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
let failed = 0
const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg); if (!ok) failed++ }
const backendCheck = async (p) => gpu && check((await p.evaluate(() => nv.backend)) === 'webgpu', 'runs on WebGPU')
const settled = (uid) => page.waitForFunction((u) => {
  const shown = document.body.dataset.shown
  return u ? shown === u : !!shown
}, uid, { timeout: 300000 })
const seriesParam = () => new URL(page.url()).searchParams.get('SeriesInstanceUIDs')

async function checkSeg({ points, counts }, name) {
  const wasm = await page.evaluate(() => {
    const c = {}
    for (const x of nv.volumes[1].img) c[x] = (c[x] ?? 0) + 1
    return c
  })
  check(JSON.stringify(wasm) === JSON.stringify(counts), `${name}: WASM label counts equal native dcm2niix`)
  const got = await page.evaluate((pts) => pts.map((p) => {
    let label
    const on = (e) => { label = e.detail.values[1]?.label }
    nv.addEventListener('locationChange', on)
    nv.setCrosshairPos(p.mm)
    nv.removeEventListener('locationChange', on)
    return label
  }), points)
  const bad = points.filter((p, i) => got[i] !== p.label).map((p, i) => `${p.label}->${got[i]}`)
  check(bad.length === 0, `${name}: label at ${points.length - bad.length}/${points.length} segment points ${bad.join(', ')}`)
}

let t = Date.now()
await page.goto(`${base}?StudyInstanceUIDs=${STUDY}`)
await settled()
await backendCheck(page)
check(seriesParam() === LUNG_SEG, `study-only autoloads LUNG SEG (${((Date.now() - t) / 1000).toFixed(1)}s)`)
check((await page.evaluate(() => nv.isLegendVisible && nv.isLegendToggleEnabled && nv.volumes[1].colormapLabel.labels.filter(Boolean).length)) === 74, 'native legend with 74 named labels')
await checkSeg(fixture('lung'), 'LUNG')

t = Date.now()
await page.selectOption('#series', STD_SEG)
await settled(STD_SEG)
check(seriesParam() === STD_SEG, `switch to STANDARD pair (${((Date.now() - t) / 1000).toFixed(1)}s)`)
await checkSeg(fixture('std'), 'STANDARD')


await page.selectOption('#series', LUNG_CT)
await settled(LUNG_CT)
check((await page.evaluate(() => nv.volumes.length)) === 1 && seriesParam() === LUNG_CT, 'explicit CT shows alone')
await page.goBack()
await settled(STD_SEG)
check(seriesParam() === STD_SEG && (await page.evaluate(() => nv.volumes.length)) === 2, 'back restores STANDARD pair')
// Rapid re-selection: only the latest selection may install.
await page.selectOption('#series', LUNG_SEG)
await page.selectOption('#series', STD_SEG)
await settled(STD_SEG)
await page.waitForTimeout(3000)
const st = await page.evaluate(() => [document.body.dataset.shown, nv.volumes.length, document.getElementById('status').textContent].join())
check(st.startsWith(`${STD_SEG},2`), `superseded load does not install (${st})`)
// Superseded overlay install: CT alone -> its SEG (addVolume held) -> back to CT.
await page.selectOption('#series', LUNG_CT)
await settled(LUNG_CT)
await page.evaluate(() => {
  const add = nv.addVolume.bind(nv)
  nv.addVolume = async (v) => { window.held = true; await new Promise((r) => setTimeout(r, 3000)); return add(v) }
})
await page.selectOption('#series', LUNG_SEG)
await page.waitForFunction(() => window.held, null, { timeout: 300000 })
await page.selectOption('#series', LUNG_CT)
await page.waitForTimeout(4000)
const race = await page.evaluate(() => [document.body.dataset.shown, nv.volumes.length, new URL(location).searchParams.get('SeriesInstanceUIDs')].join())
check(race === `${LUNG_CT},1,${LUNG_CT}`, `superseded overlay does not install (${race})`)
await page.evaluate(() => { delete nv.addVolume })
await page.selectOption('#series', STD_SEG)
await settled(STD_SEG)
await page.check('#outline')
await page.fill('#opacity', '1')
await page.waitForTimeout(500)
check((await page.evaluate(() => [nv.volumes[1].atlasOutline, nv.volumes[1].opacity].join())) === '1,1', 'outline + opacity applied')
await page.screenshot({ path: process.env.SHOT ?? 'e2e-shot.png' })
check(errors.length === 0, `no console errors ${errors.join(' | ')}`)

// Wrong index hint: the STANDARD SEG claims the LUNG CT (same grid size). The SEG's own
// references must win: overlay refused, CT kept.
const p2 = await browser.newPage()
await p2.route('**/v3/sql', async (route) => {
  const res = await route.fetch()
  const body = await res.json()
  for (const r of body.rows) if (r.SeriesInstanceUID === STD_SEG) r.segmented_SeriesInstanceUID = LUNG_CT
  await route.fulfill({ response: res, json: body })
})
await p2.goto(`${base}?StudyInstanceUIDs=${STUDY}&SeriesInstanceUIDs=${STD_SEG}`)
await p2.waitForFunction(() => document.body.dataset.shown, null, { timeout: 300000 })
const refused = await p2.evaluate(() => [document.body.dataset.shown, nv.volumes.length, document.getElementById('status').textContent].join('|'))
check(refused.startsWith(`${LUNG_CT}|1|Segmentation does not reference`), `mismatched SEG refused, CT kept (${refused.slice(0, 120)})`)
// Explicit FRACTIONAL SEG link: the base still shows, with an explicit overlay refusal.
{
  const p4 = await browser.newPage()
  const se = '1.3.6.1.4.1.14519.5.2.1.7695.2311.230378240269972963231696070064'
  await p4.goto(`${base}?StudyInstanceUIDs=1.3.6.1.4.1.14519.5.2.1.7695.2311.106039727348255984980483774237&SeriesInstanceUIDs=${se}`)
  await p4.waitForFunction(() => document.body.dataset.shown, null, { timeout: 300000 })
  const r = await p4.evaluate(() => [document.body.dataset.shown, nv.volumes.length, document.getElementById('status').textContent].join('|'))
  check(r === '1.3.6.1.4.1.14519.5.2.1.7695.2311.199207059153587286810160335300|1|Segmentation not shown: FRACTIONAL SEG not supported', `FRACTIONAL SEG link shows its base (${r.split('|')[2]})`)
  await p4.close()
}

// Other buckets (CORS + listing + conversion in a real browser): CC BY-NC (idc-open-data-cr) MR, idc-open-data-two CT.
for (const [st, se, b] of [
  ['1.3.6.1.4.1.14519.5.2.1.186051521067863971269584893740842397538', '1.3.6.1.4.1.14519.5.2.1.175414966301645518238419021688341658582', 'idc-open-data-cr'],
  ['1.3.6.1.4.1.14519.5.2.1.7009.2403.150606740246630053720505955959', '1.3.6.1.4.1.14519.5.2.1.7009.2403.215404965552082304679349341030', 'idc-open-data-two'],
]) {
  const p3 = await browser.newPage()
  await p3.goto(`${base}?StudyInstanceUIDs=${st}&SeriesInstanceUIDs=${se}`)
  await p3.waitForFunction(() => document.body.dataset.shown || document.getElementById('status').classList.contains('error'), null, { timeout: 300000 })
  const r = await p3.evaluate(() => [document.body.dataset.shown, nv.volumes.length, document.getElementById('status').textContent, document.getElementById('credit').textContent].join('|'))
  check(r.startsWith(`${se}|1|Ready`), `${b}: ${r.split('|').slice(2).join(' | ')}`)
  await p3.close()
}
await browser.close()
process.exit(failed ? 1 : 0)

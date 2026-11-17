// Cold vs warm (browser HTTP cache) stage timings for the anchor study, headed Chrome on the real GPU:
// node e2e/timing.mjs [baseUrl]. Prints ms per stage; record results in review-log.md.
import { chromium } from 'playwright'
import { ANCHOR_STUDY as STUDY, GPU_ARGS } from './lib.mjs'

const base = process.argv[2] ?? 'http://localhost:5173/'
const context = await chromium.launchPersistentContext('', { headless: false, args: GPU_ARGS })
const page = await context.newPage()
for (const run of ['cold', 'warm']) {
  const t0 = Date.now()
  if (run === 'cold') await page.goto(`${base}?StudyInstanceUIDs=${STUDY}`)
  else await page.reload()
  await page.waitForFunction(() => window.timings?.length === 2, null, { timeout: 300000 })
  const total = Date.now() - t0
  for (const t of await page.evaluate(() => window.timings))
    console.log(`${run}\t${t.label}\tdownload ${t.download}\tconvert ${t.convert}\trender ${t.render}`)
  console.log(`${run}\ttotal to overlay ${total} ms`)
}
await context.close()

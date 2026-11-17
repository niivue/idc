// Shared e2e harness. Browser: GPU=1 → headed Chrome on the real GPU (Metal, WebGPU);
// BROWSER=webkit → Playwright WebKit; default headless Chromium (SwiftShader WebGL2).
import { chromium, webkit } from 'playwright'

export const GPU_ARGS = ['--use-angle=metal', '--enable-unsafe-webgpu']
export const gpu = !!process.env.GPU
export const launch = (forceGpu = false) =>
  process.env.BROWSER === 'webkit' && !forceGpu
    ? webkit.launch()
    : chromium.launch(gpu || forceGpu ? { headless: false, args: GPU_ARGS } : {})

export const ANCHOR_STUDY = '1.2.840.113654.2.55.187766322555605983451267194286230980878'
export const LUNG_CT = '1.2.840.113654.2.55.122344168497038128022524906545138736420'

/** Console/page errors, `check` printing ok/FAIL, and `done()` exiting non-zero on any failure. */
export function harness(page, isError = (m) => m.type() === 'error') {
  const errors = []
  let failed = 0
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => isError(m) && errors.push(m.text()))
  const check = (ok, msg) => {
    console.log(ok ? 'ok  ' : 'FAIL', msg)
    if (!ok) failed++
  }
  return {
    errors,
    check,
    backendCheck: async (p) => gpu && check((await p.evaluate(() => nv.backend)) === 'webgpu', 'runs on WebGPU'),
    noErrors: () => check(errors.length === 0, `no console errors ${errors.join(' | ')}`),
    done: () => process.exit(failed ? 1 : 0),
  }
}

/** Overlay (volume 1) label name at each RAS mm point, as the crosshair reports it. */
export const labelsAt = (page, points) =>
  page.evaluate((pts) => pts.map((p) => {
    let label
    const on = (e) => { label = e.detail.values[1]?.label ?? '' }
    nv.addEventListener('locationChange', on)
    nv.setCrosshairPos(p.mm)
    nv.removeEventListener('locationChange', on)
    return label
  }), points)

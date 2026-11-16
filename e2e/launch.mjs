// Browser for the e2e scripts: GPU=1 → headed Chrome on the real GPU (Metal, WebGPU);
// BROWSER=webkit → Playwright WebKit (Safari engine); default headless Chromium (SwiftShader WebGL2).
import { chromium, webkit } from 'playwright'

export const gpu = !!process.env.GPU
export const launch = () =>
  process.env.BROWSER === 'webkit'
    ? webkit.launch()
    : chromium.launch(gpu ? { headless: false, args: ['--use-angle=metal', '--enable-unsafe-webgpu'] } : {})

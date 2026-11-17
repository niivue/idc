# niivue/idc

Static IDC viewer: study/series URL → IDC v3 SQL → public S3 (CT/MR/SEG) or IDC DICOMweb proxy (SM) → dcm2niix WASM → NiiVue. No backend.

## State
- PLAN.md: decisions + **Status** (read first, update last).
- review-log.md: evidence, timings, advisor (Fable) reviews and dispositions. audit_response.md: last audit.

## Build / test
```
bun install --frozen-lockfile
bun run dev                 # :5173
bun test src                # unit (src/idc.test.ts)
bun run build               # tsc + vite → dist/ (base ./, Pages /idc/)
node e2e/offline.mjs [url]  # fixture, no network; CI-safe
```
e2e/live.mjs, slide.mjs: live IDC. cinematic.mjs, timing.mjs: headed Chrome, real GPU. `GPU=1` / `BROWSER=webkit` for offline/live/slide (e2e/lib.mjs). Headless Chromium is SwiftShader WebGL2: it cannot path-trace the anchor CT. Real Safari: `safaridriver` (Playwright WebKit missed a Safari-only bug).

## Constraints
- vendor/*.tgz are unreleased local builds (hashes in README); swapping one needs the package.json path and `bun install` (bun.lock integrity). dcm2niix: ~/src/dcm2niix-idc `idc/seg-refs`; niivue + nv-ext-tile: ~/src/mono-idc `idc/seg-materials`. Release order in README.
- No push, PR, Pages deploy or IDC contact without Chris's sign-off. Don't touch ~/src/mono-ohif or ~/src/dcm2niix-ohif (OHIF track).
- IDC/S3 logic in src/idc.ts; UI/state in src/main.ts (one serialized load queue; check `signal.aborted` after every awaited install); SEG colour/material maps in src/seg.ts.
- Live IDC traffic never in CI. mono tests: set `BUN_RUNTIME_TRANSPILER_CACHE_PATH=0` if bun reports paths from another checkout.

# NiiVue IDC viewer

Static, read-only viewer for [Imaging Data Commons](https://portal.imaging.datacommons.cancer.gov/) studies: CT/MR volumes with named DICOM SEG overlays, and slide microscopy. No backend: the browser queries the IDC v3 SQL API, fetches public S3 objects (volumes, SEG) or IDC's DICOMweb proxy (slides), and converts DICOM with [dcm2niix](https://github.com/rordenlab/dcm2niix) (WebAssembly). Rendering: [NiiVue](https://github.com/niivue/niivue).

## Links

```
?StudyInstanceUIDs=<study>                                  image + one auto-selected SEG
?StudyInstanceUIDs=<study>&SeriesInstanceUIDs=<series>      that series (a SEG brings its image)
```

`seriesInstanceUID` is accepted as an alias. One study and one series per link. An agent that found a UID through IDC discovery (MCP, idc-index, SQL) can build this link directly.

## What is shown

| Object | Support |
|---|---|
| CT, MR, PT, … with `regularly_spaced_3d_volume` | Multiplanar + 3D, DICOM window, optional cinematic 3D (CT, WebGPU) |
| SEG, BINARY, non-overlapping | Label overlay: native legend (click box: hide/show; double-click: solo), opacity, outline; reference and FrameOfReference must match the image |
| SM (slides), compressed tiles (JPEG, JPEG 2000, JPEG-LS) | Tiled pan/zoom via DICOMweb; picker for optical paths / focal planes |
| SEG FRACTIONAL / LABELMAP, SEG on a slide | Via link: image shown, overlay refused with the reason (URL then names the image). In the selector: listed, not selectable |
| Overlapping BINARY SEG | Overlay fails with dcm2niix's error; image stays |
| SM with uncompressed frames | Refused (nv-ext-tile indexes compressed tiles only) |
| Localizers, irregular series, SR, RTSTRUCT, … | Listed, not selectable, with the reason |

Licence and source DOI are shown for the image and the SEG. Large SM objects in S3 have no frame offset table, which is why slides come from the DICOMweb proxy.

## Develop

```
bun install --frozen-lockfile
bun run dev            # http://localhost:5173/?StudyInstanceUIDs=...
bun test src           # selection + S3 listing
bun run build          # dist/, relative base (GitHub Pages /idc/)
```

Browser checks (Playwright; need a running server, URL as argument, default `http://localhost:5173/`). `GPU=1` runs offline/live/slide in headed Chrome on the real GPU (WebGPU), `BROWSER=webkit` in WebKit; `SHOT=<prefix>` names screenshots (ignored by git). For the Pages build, serve `dist/` under `/idc/` and pass that URL:

| Script | Needs | Checks |
|---|---|---|
| `e2e/offline.mjs` | nothing (fixture) | autoload, labels at off-centre points, series switch |
| `e2e/live.mjs` | IDC | anchor CT/SEG pairs: every segment's label in patient space, WASM vs native counts, races, refusals, other buckets |
| `e2e/slide.mjs` | IDC | three slides stream; optical-path picker |
| `e2e/cinematic.mjs`, `e2e/timing.mjs` | IDC, GPU (headed Chrome) | cinematic render; cold/warm stage timings |

`e2e/lib.mjs` is the shared harness. Real Safari can be driven with `safaridriver` (WebDriver); Playwright WebKit missed the lossless-JPEG bug Safari showed.

`tools/verify_seg.py` decodes a SEG independently (pydicom) and compares it with dcm2niix's label NIfTI in patient space; `tools/seg_points.py` and `tools/make_fixture.py` build the e2e fixtures (Python: numpy, pydicom, nibabel, scipy, highdicom). The anchor DICOM and conversions they read live in the gitignored `data/`.

Pages: `.github/workflows/pages.yml` builds and deploys on push to `main` (not pushed yet).

## Unreleased dependencies (`vendor/`)

Until npm releases carry these changes, the app installs local builds:

| File | sha256 | Source |
|---|---|---|
| `dcm2niix-6e8c84f.tgz` | `e18de55b…dfb3984f` | dcm2niix `idc/seg-refs` 6e8c84f (on `development` 67379e8, SEG → label NIfTI): sidecar FrameOfReferenceUID / ReferencedSeriesInstanceUID |
| `niivue-de81ece0.tgz` | `52cd7393…6f6cf087` | mono `idc/seg-materials` (c9f52e55 + 794113f6): bundled `totalsegmentator` table, TotalSegmentator v2 `total` IDs, SNOMED codes, materials |
| `nv-ext-tile-de81ece0.tgz` | `732bb709…d8bbc313` | same branch, de81ece0: WADO-RS JPEG tiles request their stored transfer syntax |

Full hashes: `shasum -a 256 vendor/*.tgz`.

Rebuild: dcm2niix `cd js && PIXI_PROJECT_ROOT=<checkout with built openjpeg-2.5.3> npm run build && npm pack` with emscripten 3.1.58 (pixi env; Homebrew emscripten 7 fails to link); mono `bun run build && bun pm pack` in `packages/niivue` and `packages/nv-ext-tile`. Rename the packs to `vendor/<pkg>-<commit>.tgz`, update `package.json`, run `bun install` (bun.lock integrity).

Release order: npm releases must contain dcm2niix 6e8c84f (without it every SEG fails the reference check, `src/main.ts`), the mono table commits (else no 3D materials) and the nv-ext-tile fix (else Safari shows JPEG slides blank).

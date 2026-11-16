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
| SEG FRACTIONAL / LABELMAP, overlapping SEG | Image shown, overlay refused with the reason |
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

Browser checks (Playwright; need a running dev or preview server, URL as argument):

| Script | Needs | Checks |
|---|---|---|
| `e2e/offline.mjs` | nothing (fixture) | autoload, labels at off-centre points, series switch |
| `e2e/live.mjs` | IDC | anchor CT/SEG pairs: every segment's label in patient space, WASM vs native counts, races, refusals, other buckets |
| `e2e/slide.mjs` | IDC | three slides stream; optical-path picker |
| `e2e/cinematic.mjs`, `e2e/timing.mjs` | IDC, GPU (headed Chrome) | cinematic render; cold/warm stage timings |

`tools/verify_seg.py` decodes a SEG independently (pydicom) and compares it with dcm2niix's label NIfTI in patient space; `tools/seg_points.py` and `tools/make_fixture.py` build the e2e fixtures.

## Unreleased dependencies (`vendor/`)

Until npm releases carry these changes, the app installs local builds:

| File | sha256 | Source |
|---|---|---|
| `dcm2niix-6e8c84f.tgz` | `e18de55b…dfb3984f` | dcm2niix `development` 67379e8 (SEG → label NIfTI) + `6e8c84f` (sidecar FrameOfReferenceUID / ReferencedSeriesInstanceUID). `cd js && PIXI_PROJECT_ROOT=<repo> npm run build && npm pack` with emscripten 3.1.58 (pixi env) |
| `niivue-c9f52e55.tgz` | `f7e17829…a125d77e9` | mono `c9f52e55` (bundled `totalsegmentator` table with SNOMED codes and materials). `cd packages/niivue && bun run build && bun pm pack` |

A dcm2niix release without `6e8c84f` makes every SEG fail the reference check; a NiiVue release without `c9f52e55` drops the 3D materials.

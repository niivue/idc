# Review log

## I0 evidence (2026-11-16)

Anchor STANDARD pair: CT `…97114726565566537928831413367474015470` (129 inst, idc-open-data/19ecafc9-…), SEG `…40027.1706310312.485948` (1 inst, e3e15a77-…). S3 listing + anonymous GET OK.

- dcm2niix 67379e8 native: CT 512×512×129 int16; SEG `74 segments, 2683 frames -> 512x512x129 grid, 9806989 labeled voxels, 0 in more than one segment`, 1.04 s. Label NIfTI 33.8 MB (no 4D needed; the plan's 2.33 GiB per-segment estimate does not apply).
- SEG affine is the CT grid with y and z flipped (max |Δaffine| 359 mm): equal dims, different index order — exactly the case counts alone miss.
- `tools/verify_seg.py` (pydicom decode → per-frame ImagePositionPatient → LPS → NIfTI voxel): 74 segments, 9,806,989 voxels, 0 mismatched; per-segment counts equal.
- Sidecar: LabelValue = SegmentNumber 1..74, SegmentLabel, RGB (already converted from CIELab), SCT codes.
- SEG metadata (pydicom): BINARY, explicit VR LE; ReferencedSeriesSequence = STANDARD CT, all 129 referenced SOPs present; FrameOfReferenceUID identical to CT.
- Browser (vendored WASM, hash = built): label counts per value identical to native; 7 interior points (spleen, kidneys, liver, aorta, lung lobe, T4) sample the right label through NiiVue's placement of the y/z-flipped grid.

## Advisor (Fable) checkpoint 1 — 2026-11-16

Advice: I0 not at exit — WASM never run, representation not demonstrated (`selectedLabels` only dims, so isolate must use `hiddenLabels`), SEG metadata unrecorded; Q1/Q4/Q5 were unconfirmed; tell Chris about side effects; start slides feasibility early; set up the loop.
Disposition: all done above. Chris confirmed Fable = advisor tool and Q4/Q5 defaults. Isolate implemented with `hiddenLabels`. Slides feasibility queued next.

## Advisor (Fable) — I0 exit / first end-to-end, 2026-11-16

Advice: I0 passes. Blocking I1: superseded overlay could install (no abort check after awaited nv calls; `shown` read mid-install); timings not split. Blocking I2: verify LUNG pair, one point per segment, reference/FoR validation owner. Non-blocking: regular-volume gate limitation, URL semantics into Decisions, abort siblings on fetch error, credit innerHTML.
Disposition: race reproduced by e2e (FAIL on old code) and fixed by serialising loads; siblings aborted; credit uses DOM nodes; URL semantics recorded; others queued in Status.

## LUNG pair (2026-11-16)

dcm2niix: 74 segments, 2674 frames, 9,750,875 voxels, 0 overlapping. `verify_seg.py`: 0 mismatched. ReferencedSeriesSequence = LUNG CT; FoR equal. Browser: counts equal native; 74/74 per-segment points (`tools/seg_points.py`) correct for both pairs. Counts differ between pairs, so a pair swap fails the check.

## Timings (2026-11-16, M4 Pro, headed Chrome/WebGPU, home network; `node e2e/timing.mjs`)

| run | stage | download ms | convert ms | render ms |
|---|---|---|---|---|
| cold | CT (68 MB, 129 files) | 1933 | 119 | 199 |
| cold | SEG (89 MB, 1 file) | 5575 | 1494 | 83 |
| warm | CT | 129 | 86 | 179 |
| warm | SEG | 138 | 1476 | 85 |

Total to overlay: cold 9.9 s, warm 2.3 s (includes the IDC SQL query). Warm = browser HTTP cache (S3 sends ETag/Last-Modified). SEG conversion (1.5 s) is the warm bottleneck; Range-chunked SEG retrieval not justified yet.

## Advisor (Fable) — release gate / I1–I2 exit, 2026-11-16

Advice and disposition:
1. Correctness suites never ran on WebGPU → `GPU=1` mode (headed Chrome, Metal) asserts `nv.backend === 'webgpu'`; offline/live/slide pass (35 checks).
2. Built app under `/idc/` stale → `dist/` served at `/idc/`, all suites rerun: headless 31 ok, WebGPU 35 ok, WebKit 31 ok.
3. Safari unverified → Playwright WebKit (`BROWSER=webkit`): offline/live/slide pass. Real Safari still a manual check.
4. Fresh clone → `git clone` + `bun install --frozen-lockfile` + build + test pass. Two committed screenshots removed; `*.png` ignored.
5. Unsupported SEG link showed nothing → base shown with "Segmentation not shown: <reason>"; unit test + live FRACTIONAL SEG (`…2311.230378240269972963231696070064`) pass.
6. Cinematic black without WebGPU → checkbox disabled without a WebGPU adapter and for non-CT images.
7. No README → added (URL recipe, object matrix, limits, rebuild commands, vendor sha256, release-order trap).
8. No offline fixture → `tools/make_fixture.py` (synthetic 16×12×4 CT + 2-segment off-centre SEG, 28 KB) + `e2e/offline.mjs` (IDC/S3 routed to the fixture). It caught a real bug: a SEG without RecommendedDisplayCIELab crashed the overlay; now fallback colours.
Housekeeping: failed-GET retrieval case added. Not done (recorded for Chris): WebGL2 bug repro not yet narrowed with example data on Metal; mono full CI not run.

## Audit 2026-11-17

See audit_response.md. Safari 27.2 (real, safaridriver): CPTAC JPEG slide was solid cyan → IDC proxy transcoded `type="image/jpeg"` requests to lossless JPEG (SOF3, 25 KB vs stored 4.3 KB baseline); nv-ext-tile de81ece0 requests the stored syntax; Safari renders both slides and the anchor CT+SEG (WebGPU, 74 segments). After all fixes, built app under `/idc/`: headless + WebGPU offline/live/slide + cinematic = 73 checks pass; WebKit offline/live/slide 31 pass.

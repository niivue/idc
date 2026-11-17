# Audit response (2026-11-17)

External review (pasted by Chris; no audit_temp.md in this repo) plus internal agents: security/bugs, refactor, docs.

## External findings

| # | Finding | Decision | Result |
|---|---|---|---|
| P1 | Stale optical-path load can show the previous slide under a newly selected series | Fix | Confirmed in code: the picker's `open()` had its own AbortController. Each path open now aborts with `AbortSignal.any([seriesLoadSignal, pathController])`; the abort is rechecked after the first `createSlideView`. |
| P1 | Real Safari renders the JPEG slide solid cyan | Fix (upstream) | Reproduced in Safari 27.2 via safaridriver. Root cause in nv-ext-tile: JPEG tiles were requested as `type="image/jpeg"` without a transfer syntax, so IDC's proxy transcoded them to **lossless JPEG** (SOF3; 25 KB vs 4.3 KB stored), which Safari cannot decode. mono de81ece0 requests the level's stored syntax. Safari now renders CPTAC (JPEG) and CATCH (JPEG 2000); tile bytes drop ~6×. Chrome and Playwright WebKit had masked it. |
| P2 | Bundled `totalsegmentator` colormap names wrong for standard voxel IDs | Fix (upstream) | Confirmed: all 117 standard TotalSegmentator v2 `total` IDs were mislabelled (table was alphabetical, copied from the cinematic example's relabelled file). mono 794113f6 re-indexes to the official `class_map["total"]` (+4 classes the example lacked: prostate, kidney cysts, S1); test pins IDs 1 = spleen, 5 = liver. The app matched by SNOMED code, so its overlays were unaffected. |

## Internal findings fixed

- Cinematic state not reset when an image installed but its SEG failed; error said "Showing the previous selection" while a new image was shown → gate/cinematic/URL now sync after any outcome; message distinguishes "image without its segmentation". Offline e2e regression (SEG GET 503).
- Slide → failing volume blanked UI/URL and revealed an old volume → `showCanvas(false)` only once the new image is ready; `shown` stays the slide on failure.
- SEG on a slide was selectable then silently dropped → refused with "slide segmentation not supported" (unit test); slide path now shows `refused`.
- `createSlideView` may replace the canvas → adopt `slideView.canvas`. Tile source disposed if view creation throws.
- Timing `rendered()` awaited rAF (stalls the queue in background tabs) → not awaited; timing returned from `toNifti` (no module state).
- No Pages pipeline → `.github/workflows/pages.yml` (build + deploy on push to main; not pushed).
- Stray 1.7 MB pack tarball committed in mono → amended out.
- Docs: stale versions/hashes/branch heads, e2e default URL (now :5173), browser modes, rebuild recipe, python deps; CLAUDE.md added.

## Refactor taken / declined

Taken: shared e2e harness `e2e/lib.mjs` (check/errors/labelsAt/launch), weak "superseded load" e2e check removed (the held-`addVolume` race covers it), derived SEG colormap names, single `segSummary`, redundant abort checks reduced to one before the final status, `baseOf()`, unused `Series.segments` and `studySeries` signal removed, seg.ts JSDoc placement.
Declined: dropping the post-install abort check entirely (needed: no await follows the last install); trimming the outline/opacity smoke (cheap); `dicomWindow` unit test (fixture covers WindowCenter; add if the scanner changes).

## Open (uncertain, not fixed)

- dcm2niix `ReferencedSeriesInstanceUID` takes the first nested series UID: a SEG referencing several series with the image not first would be refused. No such SEG seen; revisit in dcm2niix before release.

## Verification

`bun test src` (4 tests, 11 expects); mono niivue cmap tests 181 pass, nv-ext-tile 463 pass. Built app under `/idc/`: offline/live/slide headless + WebGPU and cinematic: 73 checks pass; WebKit 31 pass. Real Safari: both slides and anchor CT+SEG (WebGPU) render.

# Response: audit_temp.md (7322952, 2026-11-17)

- **No findings in the reviewed commit: agreed** (documentation only; the WebKit total of 5 + 15 + 11 = 31 checks matches the harness).
- **Linked dcm2niix findings (multiple SEG references; implicit-VR cross-study references): fixed** on dcm2niix `idc/seg-refs` 8315639 (see `../dcm2niix/audit_response.md`). `ReferencedSeriesInstanceUID` is now an array, and `src/main.ts` requires that the shown image's series be a member and that the FrameOfReferenceUID match. Vendored `vendor/dcm2niix-8315639.tgz`. Offline (5) and live (16) suites pass, as do `bun test src` and the build.

# Response: audit_temp.md (67a70d5, 2026-11-17, final round)

- **No findings: agreed.** The auditor's extra fixture (an implicit-VR cross-study SEG with an unrelated UID first, the CT second and a duplicate) passing through the shipped WASM confirms the array-membership consumer end to end.
- **Reference-list capacity (256 bytes, at least three 64-char UIDs; extras warn and are omitted): accepted, documented.** Raising it enlarges every `TDICOMdata` (dcm2niix keeps one per input file), and no IDC SEG with more than one source series is known. Revisit if one appears.
- **Development of this app is paused** in favour of IDC support in nv-ohif (see PLAN.md Status and `~/src/mono/scratch/plan-idc-ohif.md`).

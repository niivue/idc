# plan-idc: NiiVue as a lean IDC viewer

Status: implementation authorized 2026-11-16 (loop). Canonical copy: this file. Read **Status** (end) first; update it last.

## Decisions (Chris, 2026-11-16)

| ID | Decision |
|---|---|
| Q1 | Fable = Claude Code `advisor` tool (sees the full session transcript; no separate resume). Advises; implementation agent owns changes; Chris owns scope/publication. |
| Q2 | First release = CT + SEG + slides (I0–I3). I4 (portal/MCP/notebook) later. |
| Q3/Q6 | Study-only link shows CT, then auto-adds one deterministically chosen matching SEG. One study, one active SEG; selectors for alternatives. |
| Q4 | Default: shared work allowed on `idc/<topic>` branches in separate worktrees, no push without sign-off; coordinate with the OHIF track. |
| Q5 | Default: desktop Chrome/Safari first; sample CT + SEG is the benchmark; no 10 s gate. |
| dcm2niix | Develop against a local WASM tarball built from dcm2niix `development` 67379e8 (`vendor/`, hash-pinned). Chris publishes an npm rc before release; switch to it then. |
| Publish | Local commits only. Ask before any push/Pages deploy. |
| Slides | SM via IDC's DICOMweb proxy (CORS reflects origin, incl. niivue.github.io); CT/SEG stay S3. Reason: S3 SM objects have empty BOT and no EOT, so Range indexing reads the whole file (CPTAC-LUAD level 0: 15,768 frames, 136 MB). |
| URL (agent choice, revisit if wrong) | `SeriesInstanceUIDs` (alias `seriesInstanceUID`) names what is shown: a SEG brings its referenced base; a volume shows alone (no overlay). A study-only link autoloads and is rewritten to the chosen SEG UID so a copied link is explicit. |

Carry forward the draft's architectural decisions: separate `niivue/idc` repository; static browser app with no application backend; S3 + IDC index first; dcm2niix for conversion, with no interim JavaScript SEG decoder; read-only viewing. Editing/export, RTSTRUCT, SR measurements and DICOMweb implementation remain outside this viewer's initial scope. Thumbnail generation is deferred until basic navigation works.

## Agent and Fable working contract

- Read the current plan and each affected repository's instructions. Use `/ponytail full`. Implement one testable slice at a time; maintain a short status and evidence record so another agent can resume.
- At kickoff, record the Fable invocation, access limits and how to resume its session. If Fable is unavailable, say so; do not label an internal self-review as Fable advice. Whether work may continue without it needs Q1's answer.
- Consult Fable at three checkpoints: after sample feasibility/representation analysis, after the first real CT + SEG end-to-end run, and before the agreed release gate. Consult earlier for disputed DICOM geometry, overlap preservation or a shared API change.
- Each review packet contains the exact commits/package versions, the question to decide, relevant diff, commands/results, quantitative evidence, and known failures. Record advice and its disposition in `review-log.md`. An adviser cannot silently waive a failed acceptance criterion or add a feature.
- The implementation agent performs fixes and reruns the relevant check. A blocked SEG slice does not stop resolver, CT, UI or fixture work. Record the specific missing capability and its owner; never mark a blocked requirement complete.
- Preserve other agents' work. `/Users/chris/src/mono-ohif` and `/Users/chris/src/dcm2niix-ohif` belong to the OHIF track. Use a separate branch/worktree for any approved shared contribution and coordinate its interface before editing.
- Local implementation and verification are separate from publishing. Prepare a reviewable result before asking Chris to create public links, push/publish/deploy, merge, or contact IDC. Do not send messages to the IDC lead as part of research.

## Verified inputs and references

Checked 2026-11-16 unless explicitly described as a draft observation.

- [IDC agent entry point](https://learn.canceridc.dev/ai-assistants/agents): use its hosted MCP/skill for discovery where available. The browser viewer uses HTTP, not an LLM or Python runtime.
- [REST API](https://learn.canceridc.dev/rest-api/api) and [OpenAPI](https://api.imaging.datacommons.cancer.gov/v3/openapi.json): v3 is beta. `POST /v3/sql` accepts `{sql, params, max_rows}` with positional `?` bindings and returns `{columns, rows, row_count, truncated, max_rows}`. The sample query returned CORS `*`. Never treat a truncated result as the complete study.
- [SQL guidance](https://learn.canceridc.dev/rest-api/querying-with-sql): inspect `/v3/tables/{table}` before relying on fields. `index`, `seg_index`, `volume_geometry_index`, and `sm_instance_index` schemas were checked. `segmented_SeriesInstanceUID` is a discovery hint resolved from the first referenced instance; it is not proof of complete SEG geometry or all references.
- [Retrieval/licensing/citation guidance](https://learn.canceridc.dev/rest-api/getting-data): bytes come directly from public storage. Keep the licence and source DOI for both the acquired images and derived SEG; they can differ. The manifest alone is not an attribution record. Display licence/citation information without inventing a click-through consent requirement.
- S3 object pattern: `https://<aws_bucket>.s3.us-east-1.amazonaws.com/<crdc_series_uuid>/<instance_uuid>.dcm`. ListObjectsV2 gives actual object keys; follow continuation tokens, do not construct instance names. A list and 64 KiB Range read of the sample SEG succeeded anonymously with CORS `*`; the object returned `206` and exposed Content-Range/Content-Length/Accept-Ranges. This does not establish CORS for every bucket; test the restricted-licence bucket separately.
- [SlicerRAD-IDC](https://github.com/pieper/SlicerRAD-IDC) is a useful interaction/reference viewer. The draft reports SQL + S3 retrieval and layered handling of overlapping segments; those implementation details need inspection at a pinned revision before reuse. Do not inherit an arbitrary four-layer overlap limit.
- OHIF reference plan: `/Users/chris/src/ohif-niivue/plan-niivue4ohif.md`. Its status prose can lag its sign-off queue; inspect current commits and PRs.

### Anchor study

`StudyInstanceUID = 1.2.840.113654.2.55.187766322555605983451267194286230980878`

Live SQL returned 9 series: two regular CTs (129 instances, about 68 MB each), a 2-instance localizer, two BINARY TotalSegmentator v1.5.6 SEGs (74 segments, about 89 MB each), and four SRs. Both CT/SEG pairs are CC BY 4.0. The CT source DOI is `10.7937/tcia.hmq8-j677`; the SEG source DOI is `10.5281/zenodo.8347011`.

| Pair | CT SeriesInstanceUID | SEG SeriesInstanceUID |
|---|---|---|
| LUNG | `1.2.840.113654.2.55.122344168497038128022524906545138736420` | `1.2.276.0.7230010.3.1.3.313263360.20363.1706320514.804396` |
| STANDARD | `1.2.840.113654.2.55.97114726565566537928831413367474015470` | `1.2.276.0.7230010.3.1.3.313263360.40027.1706310312.485948` |

Reference views: [OHIFv3](https://viewer.imaging.datacommons.cancer.gov/v3/viewer/?StudyInstanceUIDs=1.2.840.113654.2.55.187766322555605983451267194286230980878) and [SlicerRAD](https://pieper.github.io/SlicerRAD-IDC/?StudyInstanceUIDs=1.2.840.113654.2.55.187766322555605983451267194286230980878).

These metadata checks do not establish zero overlap, matching grids, transfer syntax of every instance, or successful conversion. Establish those in I0 before promising the sample overlay.

## Architecture and shared dependencies

Use a small TypeScript/Vite app. Bun manages dependencies; pin tested package versions exactly. Resolve current npm tags and inspect the installed package capabilities at kickoff; the draft's version numbers are historical, not installation instructions. Add dependencies only when their phase needs them. No OHIF/React shell in the standalone app.

Keep IDC-specific resolution/fetching in `src/idc.ts`; keep app state and UI wiring in the app. Use existing NiiVue/uikit controls where they fit. Do not prescribe a line count or create a new framework for this client.

| Need | Reuse and actual boundary |
|---|---|
| Part-10 series → NIfTI | `@niivue/dcm2niix`; downloaded instances must retain common series grouping (`_webkitRelativePath`, as the dcm2niix demo documents). Reuse output-selection and windowing rules from nv-ohif, not its WADO reconstruction or OHIF services. |
| Shared pure helpers | nv-ohif currently exports its OHIF entry, not a public standalone conversion utility. Inspect before importing. If a helper genuinely needs to be shared, coordinate a small public API or relocation; do not deep-import private files or bundle nv-ohif just to obtain it. |
| SEG conversion | OHIF X4: dcm2niix development `67379e8` adds BINARY SEG → 3D label NIfTI + Segments sidecar. The OHIF record reports overlap rejection and no FRACTIONAL/LABELMAP support at that revision. Verify the actual published WASM; a native commit does not prove browser availability. |
| SEG placement | [mono #819](https://github.com/niivue/mono/pull/819) is merged. `loadDrawing` supports lossless axis swaps/flips/integer shifts; it is not arbitrary resampling. Equal dimensions do not prove alignment. Verify the pinned npm release includes it. |
| OHIF SEG presentation | [mono #820](https://github.com/niivue/mono/pull/820) is open, stacked on #814/#812. It loads a SEG as a drawing with a translucent fill/opaque rim. Useful reference, not a hard dependency on all OHIF milestones or a portable viewer component. |
| Names, colours and visibility | Core atlas legends collect label volumes/mesh layers, not the drawing buffer. A drawing plus `isLegendToggleEnabled` does not automatically meet the requested segment controls. I0 must choose and demonstrate the presentation path. |
| Overlap | OHIF X4/X6 plan per-segment 4D representation/display. Preserve all memberships; loading a 4D file alone does not prove simultaneous display. Do not flatten overlap or silently drop fractional information. |
| Slides | nv-ext-tile supports local `File[]` indexing and hosted byte-range manifests, plus DICOMweb metadata/frame sources. It does not currently expose arbitrary S3 URL lists as local files. I3 needs a remote indexing/manifest strategy. |

Standalone S3 viewing does not wait for OHIF M11. Enabling nv-ohif inside IDC's OHIF fork remains a separate integration, with its own version/configuration/CORS checks; it is not automatic when this page works. Do not implement a second DICOMweb stack here.

## Implementation slices

### I0 — sample feasibility and adviser checkpoint

1. Record exact mono/dcm2niix/package revisions and inspect the sample CT/SEG metadata, references, transfer syntax, frame geometry, label count and actual overlap. Fetch only the selected pair, not the whole study. Reuse an existing local copy if present.
2. Convert the pair with the browser WASM intended for shipping. If unreleased work is needed, use recorded local packages for development; publication must use a reproducible, agreed dependency source.
3. Demonstrate segment names/colours, individual visibility, isolate/show-all, fill opacity and outline on the chosen representation. Prefer a label-volume overlay if it already supplies the read-only controls and correct alignment. Choose a drawing only if its segment controls are proven or the required shared work has an owner. Do not independently grow two implementations.
4. Compare decoded masks in patient coordinates against an independent offline decoder. Record overlap counts and label mapping. Matching voxel counts alone cannot catch shifted/flipped overlays.
5. Measure memory before choosing an overlap representation. A 74-frame uint8 array at 512 x 512 x 129 is about 2.33 GiB before conversion copies, CT and GPU storage. Use the sample's actual dimensions in evidence; do not allocate this representation on faith.

Exit: Fable reviews the evidence and representation decision. Either the sample is viable with the chosen packages, or the exact upstream blocker and owner are recorded. Build I1 while shared work proceeds; do not mark I2 complete by showing CT without its required SEG.

### I1 — resolver, volume and basic navigation

- Accept `?StudyInstanceUIDs=<uid>` with optional `SeriesInstanceUIDs` and `seriesInstanceUID` aliases. Validate at the URL boundary and bind values in SQL. Define alias precedence and multiplicity from Q6. A selected UID must resolve to the requested study; an invalid/missing requested series is reported, never silently replaced.
- A requested SEG resolves its referenced base. For a study-only link, apply Q3. Rank eligible series deterministically: prefer a supported SEG/base pair when autoloading overlays, otherwise a regular supported volume; use UID as the final tie-break. `volume_geometry_index` is useful routing evidence, not the sole proof that dcm2niix can convert a series.
- Query explicit required columns, retain image/derived provenance, and handle `truncated`. Follow every S3 list continuation token; filter actual DICOM object keys and reconcile completeness before conversion. Do not order slices by S3 listing order.
- Fetch selected-series files with bounded concurrency (start at 8), progress, abort and actionable errors. Reject incomplete series instead of quietly converting a partial download. Cancel/dispose workers and temporary resources as well as network requests; only the latest selection may install results.
- Apply established dcm2niix output selection and DICOM window rules. Show the selected output and alternatives when conversion splits a series. Start in multiplanar + 3D, with window/level and orientation controls.
- Provide a basic series selector immediately, including unsupported objects with reasons. Do not turn localizers/irregular series into a fictitious regular volume. A real stack viewer is additional work, not an automatic fallback.
- Preserve the last successful view on a failed selection, keep the URL/controls consistent with what is shown, and allow retry. Back/forward and copied links restore the selected series; SEG selection must also be encoded once I2 lands. Use query-based URLs compatible with GitHub Pages rather than assuming server route rewrites.

Exit: the sample's two CTs can be selected, loaded and revisited; cancellation cannot install an old result; a fresh copied link reopens the same selection. Record cold/warm network, conversion and first-render timings separately. Agree the reference device/cache definition before treating the draft's “under 10 seconds warm” as a release gate.

### I2 — complete read-only SEG workflow

- Load the requested/default SEG per Q3/Q6. Discover candidates via `seg_index`, then validate DICOM references and FrameOfReference/geometry against the converted base. Missing references may require resolving another series; never attach to the currently visible CT merely because dimensions match.
- Start with whole-instance GETs for the sample SEG. Introduce chunked Range retrieval only after measurement shows a worthwhile improvement. Keep the CT usable during overlay loading.
- Preserve SegmentNumber, mapped label value, names/laterality, display colour, codes and source references. Use converter sidecar RGB when supplied; do not apply CIELab conversion twice.
- Provide a legible segment list/legend, show/hide, isolate and show-all, opacity and outline controls. Inspect existing interaction conventions before promising a particular double-click gesture. Disable editing tools.
- Unsupported SEG types/geometry/overlap produce an explicit overlay failure while the base remains viewable. Such a refusal is acceptable for an out-of-scope object, not for the anchor SEG required by the release.

Exit: all 74 anchor segments retain identity and match independently decoded masks at corresponding patient-space voxels; geometry and metadata checks pass, and visibility/opacity/outline work. Validate both CT/SEG pairings so a series swap cannot leave the old overlay. Fable reviews the real end-to-end result and remaining limitations.

### I3 — slides, subject to Q2

Start with a named CC BY IDC SM series and record its UID, instances, codecs, byte sizes and licence.

The public local-file indexer needs real `File[]`; downloading a whole slide to fabricate those is not streaming. `sm_instance_index` locates instances and gives some dimensions/metadata, but not a complete frame-offset manifest. Prove one of these paths before committing to generic S3 slide support:

- Reuse an existing hosted manifest when one is available for the selected series. This proves that series only.
- Add a general remote Range-backed indexing capability in nv-ext-tile, coordinated with its owner, retaining frame offsets/fragments, pyramid levels, optical paths, focal planes and codec/ICC metadata.
- If neither is feasible within scope, ask Chris about a DICOMweb exception or defer generic SM support; do not invent an invisible backend or precompute a single fixture and claim arbitrary IDC slide support.

Exit: the selected live slide pans/zooms through Range-fetched tiles without whole-slide download; cancellation and disposal work; bytes read during indexing and interaction are recorded. Any supported link alias must work on the actual static hosting path. A generic SM claim also requires an independent slide, not just the reference manifest.

### I4 — adoption and agent entry points, subject to Q2

- Prepare a concrete working link, supported-object matrix and integration note for the IDC lead. Portal/idc-index adoption requires upstream agreement; track it separately from a release of our viewer. Do not make an external team's merge a hidden implementation gate.
- The lowest-cost agent integration is a documented URL recipe: IDC discovery returns a study/series UID, and an agent constructs this viewer's link. This does not require core to understand IDC.
- Clarify whether an MCP tool must only return/open a link or load data into an attached NiiVue session. If a dedicated tool is required, keep IDC resolution in the adapter and reuse serializable NiiVue loading/state APIs; do not add an `open_idc_study` method to core.
- A notebook uses idc-index for discovery/retrieval and ipyniivue for the same supported conversion/rendering contract. It is a separate deliverable, not automatically obtained from the browser implementation.
- Keep the existing OHIF integration track responsible for instructions and testing inside IDC's OHIF viewer. Record external requests only after Chris authorizes sending them.

Later, if requested: thumbnails generated from already loaded data, multiple simultaneous overlays/studies, SR measurements, broader modality coverage, RTSTRUCT, editing/export. Do not assume “middle slice by Range” is a generic thumbnail strategy for compressed/multiframe DICOM.

## Verification and completion

Use small synthetic/recorded fixtures and existing coverage. Before adding a test, identify the plausible regression existing tests miss. Do not test trivial SQL wrappers or duplicate the shared converter's entire test suite.

- Resolver test: a representative response with two CT/SEG pairs, explicit selection, deterministic fallback and a missing reference; verify the selected pair, not SQL string formatting.
- Retrieval test: a paginated S3 listing plus a failed/cancelled fetch; prove the full intended series is collected and stale/incomplete results never install. Keep distinct failure cases only.
- Geometry regression: small asymmetric masks with known affine/reference identity, including a placement that counts alone would not detect. Extend shared tests for shared converter/rendering bugs rather than creating app mocks of them.
- Offline browser workflow: a tiny real CT/SEG fixture opened by URL, correct named overlay, visibility/isolate/outline, series switch and stale-load rejection. Assert meaningful geometry/pixel/state outcomes; a legend row count alone does not validate rendering.
- Live smoke: the anchor pairs and one selected restricted-licence-bucket case; slides when required by Q2. Check actual browser CORS and Pages base-path/worker loading, not just successful command-line downloads. Do not use live IDC traffic in CI.
- Record peak memory and cold/warm timings on Q5's target machines. No arbitrary performance failure threshold until its conditions are agreed. Do not add streaming/preview infrastructure solely because a larger study might exist.

Done means the agreed Q2 release scope passes its acceptance checks on Q5's targets, fresh install/build and relevant tests pass, supported/unsupported cases are documented, source versions and evidence are reproducible, Fable's review is recorded and material findings are resolved. Publication and portal adoption have their own recorded status. A blocked shared dependency or unanswered release decision is not completion.

For mono changes, run its required checks and any relevant hardware benchmarks; for this plan-only edit, inspect the text and links rather than rerunning unrelated application builds. API beta changes should produce an understandable failure; do not add a Parquet/BigQuery fallback client before one is needed and approved.

## Status

Evidence and adviser dispositions: `review-log.md`.

| Slice | State |
|---|---|
| I0 | done; adviser checkpoint 1 closed |
| I1 | working: resolver, S3 fetch (8-way, abort, completeness), MPR+3D, DICOM window, selector with reasons, URL/back/forward, stale-load guard. Open: separate cold/warm network/conversion/render timings; show alternatives when a series splits; restricted-bucket CORS. Known limit: viewable volume requires `regularly_spaced_3d_volume = true`. |
| I2 | working on anchor: autoload, 74 named segments, toggle/isolate/show all, opacity, outline. Open: validate SEG references/FrameOfReference against the base (today: `seg_index` hint + patient-space placement); explicit failure UX for an unsupported SEG; LUNG pair independent verification; one browser point per segment for both pairs. |
| I3 | working on one slide: SM via IDC DICOMweb proxy + nv-ext-tile `DicomWebWsiSource` (CPTAC-LUAD `…1640912900456.2.0`: open 33 frames/3.0 MB, zoom +5 frames; metadata 0.07 MB). Open: an independent second slide (other collection/codec), multiple optical paths/planes selector, dispose on switch verified. |

Checks: `bun test src` (selection, S3 pagination/completeness); `node e2e/live.mjs [url]` live smoke against IDC (dev server or built `dist/` under `/idc/`): autoload, label at 7 verified patient points, WASM label counts = native, isolate/show all, explicit CT alone, back/forward, superseded load, outline/opacity, no console errors. Cold anchor pair ≈15–20 s on this Mac. `node e2e/slide.mjs [url]`: slide opens via proxy, zoom fetches tiles, bytes ≪ series.

Loop protocol (Claude Code `/loop`, self-paced): each wake read Status, do one testable slice or record a specific blocker and take the next unblocked one, run the checks, commit locally, update Status last. Consult the advisor at the plan's three checkpoints. Stop the loop when the Q2 scope passes or only Chris-owned items remain (publish, npm rc).

Representation: SEG → dcm2niix 3D uint8 label NIfTI (intent LABEL) loaded as a NiiVue overlay volume with a label colormap built from the `Segments` sidecar. Core already supplies names/colours/legend (`isLegendToggleEnabled`, `hiddenLabels`), isolate (`selectedLabels`), outline (`atlasOutline`) and opacity. No drawing path, no 4D (anchor has 0 overlap; overlapping SEG → explicit refusal from dcm2niix).

Versions: dcm2niix worktree `~/src/dcm2niix-idc` detached at 67379e8 (built with pixi emscripten 3.1.58 from `~/src/dcm2niix-ohif/.pixi`; Homebrew emscripten 7.0 fails to link CharLS). `vendor/dcm2niix-67379e8.tgz` sha256 821f9b31…ae749. @niivue/niivue 1.0.0-rc.213 (includes #819), @niivue/nv-ext-tile 1.0.0-rc.122 (peer requires niivue ≥ rc.213).

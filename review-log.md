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

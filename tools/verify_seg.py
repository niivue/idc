"""Independent check: decode DICOM SEG with pydicom, place frames in patient space,
compare to dcm2niix label NIfTI at the same LPS points. Usage: verify_seg.py seg.dcm seg.nii seg.json"""
import sys, json, numpy as np, pydicom, nibabel as nib
seg = pydicom.dcmread(sys.argv[1]); img = nib.load(sys.argv[2]); side = json.load(open(sys.argv[3]))
lab = np.asarray(img.dataobj)
inv = np.linalg.inv(img.affine)  # RAS mm -> voxel
num2val = {s['SegmentNumber']: s['LabelValue'] for s in side['Segments']}
fr = seg.pixel_array.reshape(int(seg.NumberOfFrames), seg.Rows, seg.Columns)
sh = seg.SharedFunctionalGroupsSequence[0]
iop = np.array(sh.PlaneOrientationSequence[0].ImageOrientationPatient, float)
dr, dc = (float(v) for v in sh.PixelMeasuresSequence[0].PixelSpacing)
r, c = iop[:3], iop[3:]
mism = total = 0
counts = {}
for k, pf in enumerate(seg.PerFrameFunctionalGroupsSequence):
    n = int(pf.SegmentIdentificationSequence[0].ReferencedSegmentNumber)
    ipp = np.array(pf.PlanePositionSequence[0].ImagePositionPatient, float)
    m = fr[k].astype(bool)
    j, i = np.nonzero(m)
    lps = ipp + np.outer(i * dc, r) + np.outer(j * dr, c)
    ras = lps * [-1, -1, 1]
    vox = np.rint((inv[:3, :3] @ ras.T).T + inv[:3, 3]).astype(int)
    got = lab[vox[:, 0], vox[:, 1], vox[:, 2]]
    mism += int((got != num2val[n]).sum()); total += m.sum()
    counts[n] = counts.get(n, 0) + int(m.sum())
nifti_counts = {s['SegmentNumber']: int((lab == s['LabelValue']).sum()) for s in side['Segments']}
assert counts == {k: v for k, v in nifti_counts.items() if v}, 'per-segment counts differ'
print(f'segments={len(counts)} voxels={total} mismatched={mism}')
assert mism == 0

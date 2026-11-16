"""One RAS-mm point per segment (interior if any, else any voxel) plus per-label counts,
from a verify_seg.py-validated label NIfTI. Usage: seg_points.py seg.nii seg.json > points.json"""
import sys, json, numpy as np, nibabel as nib
from scipy.ndimage import binary_erosion
img = nib.load(sys.argv[1]); a = np.asarray(img.dataobj); side = json.load(open(sys.argv[2]))
pts = []
for s in side['Segments']:
    m = a == s['LabelValue']
    if not m.any(): continue
    core = binary_erosion(m)
    v = np.argwhere(core if core.any() else m)
    v = v[len(v) // 2]
    pts.append({'label': s['SegmentLabel'], 'mm': [float(x) for x in (img.affine @ [*v, 1])[:3]]})
vals, counts = np.unique(a, return_counts=True)
print(json.dumps({'points': pts, 'counts': {int(x): int(y) for x, y in zip(vals, counts)}}))

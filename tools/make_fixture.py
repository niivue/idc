"""Tiny synthetic CT (4 slices, 16x12) + BINARY SEG (2 segments, off-centre so a flip/shift
mislabels) for the offline e2e. Writes e2e/fixture/{ct/*.dcm, seg/seg.dcm, points.json}.
Usage: make_fixture.py <repo>"""
import sys, os, json, numpy as np, pydicom, highdicom as hd
from pydicom.uid import generate_uid, ExplicitVRLittleEndian
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.sr.codedict import codes

out = os.path.join(sys.argv[1], 'e2e/fixture')
os.makedirs(f'{out}/ct', exist_ok=True); os.makedirs(f'{out}/seg', exist_ok=True)
R, C, Z, sp, th = 12, 16, 4, 2.0, 3.0
study, series, frame = '1.2.826.0.1.3680043.8.498.1', '1.2.826.0.1.3680043.8.498.2', '1.2.826.0.1.3680043.8.498.3'
cts = []
for z in range(Z):
    ds = Dataset()
    ds.file_meta = FileMetaDataset(); ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta.MediaStorageSOPClassUID = '1.2.840.10008.5.1.4.1.1.2'
    ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID = f'1.2.826.0.1.3680043.8.498.10.{z + 1}'
    ds.SOPClassUID = ds.file_meta.MediaStorageSOPClassUID
    ds.StudyInstanceUID, ds.SeriesInstanceUID, ds.FrameOfReferenceUID = study, series, frame
    ds.Modality, ds.PatientID, ds.PatientName, ds.SeriesNumber, ds.InstanceNumber = 'CT', 'fixture', 'Fixture', 1, z + 1
    ds.StudyDate = ds.SeriesDate = '20260101'; ds.StudyTime = '120000'; ds.Manufacturer = 'synthetic'
    ds.ImageType = ['ORIGINAL', 'PRIMARY', 'AXIAL']
    ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]; ds.ImagePositionPatient = [-10.0, -8.0, z * th]
    ds.PixelSpacing = [sp, sp]; ds.SliceThickness = th
    ds.Rows, ds.Columns, ds.SamplesPerPixel, ds.PhotometricInterpretation = R, C, 1, 'MONOCHROME2'
    ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 16, 16, 15, 1
    ds.RescaleIntercept, ds.RescaleSlope, ds.WindowCenter, ds.WindowWidth = 0, 1, 40, 400
    img = np.full((R, C), -1000, np.int16); img[2:10, 2:14] = 40
    ds.PixelData = img.tobytes()
    ds.is_little_endian, ds.is_implicit_VR = True, False
    ds.save_as(f'{out}/ct/{z + 1}.dcm', enforce_file_format=True); cts.append(ds)
mask = np.zeros((Z, R, C, 2), bool)
mask[1:3, 2:5, 2:6, 0] = True     # segment 1: low row, low column corner
mask[0:4, 7:10, 10:14, 1] = True  # segment 2: opposite corner
descs = [hd.seg.SegmentDescription(
    segment_number=i + 1, segment_label=lab, segmented_property_category=codes.SCT.Organ,
    segmented_property_type=t, algorithm_type=hd.seg.SegmentAlgorithmTypeValues.MANUAL)
    for i, (lab, t) in enumerate([('Liver', codes.SCT.Liver), ('Spleen', codes.SCT.Spleen)])]
seg = hd.seg.Segmentation(source_images=cts, pixel_array=mask, segmentation_type=hd.seg.SegmentationTypeValues.BINARY,
    segment_descriptions=descs, series_instance_uid='1.2.826.0.1.3680043.8.498.4', series_number=2,
    sop_instance_uid='1.2.826.0.1.3680043.8.498.40', instance_number=1, manufacturer='synthetic',
    manufacturer_model_name='fixture', software_versions='1', device_serial_number='1')
seg.save_as(f'{out}/seg/seg.dcm')
# Patient LPS -> RAS mm at voxel (z, row, col)
pt = lambda z, r, c: [-(-10.0 + c * sp), -(-8.0 + r * sp), z * th]
json.dump({'study': study, 'ct': series, 'seg': '1.2.826.0.1.3680043.8.498.4',
           'points': [{'label': 'Liver', 'mm': pt(1, 3, 3)}, {'label': 'Spleen', 'mm': pt(2, 8, 12)}, {'label': '', 'mm': pt(1, 8, 3)}]},
          open(f'{out}/points.json', 'w'), indent=1)
print('ok', os.listdir(f'{out}/ct'), os.path.getsize(f'{out}/seg/seg.dcm'))

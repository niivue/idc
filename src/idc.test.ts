import { expect, test } from 'bun:test'
import { fetchSeries, type Series, select } from './idc'

const s = (uid: string, o: Partial<Series>): Series => ({
  uid, modality: 'CT', description: '', instances: 129, bucket: 'b', uuid: uid,
  license: 'CC BY 4.0', doi: '', segType: null, segments: null, segmentedUid: null, regular: true, ...o,
})
// Anchor-study shape: two CT/SEG pairs, a localizer, an SR, plus a SEG whose base is missing.
const study = [
  s('1.9', {}),
  s('1.3', {}),
  s('1.5', { instances: 2, regular: null }),
  s('2.9', { modality: 'SEG', instances: 1, segType: 'BINARY', segmentedUid: '1.9' }),
  s('2.3', { modality: 'SEG', instances: 1, segType: 'BINARY', segmentedUid: '1.3' }),
  s('2.1', { modality: 'SEG', instances: 1, segType: 'BINARY', segmentedUid: '9.9' }),
  s('2.7', { modality: 'SEG', instances: 1, segType: 'FRACTIONAL', segmentedUid: '1.9' }),
  s('3.1', { modality: 'SR', instances: 1, regular: null }),
]

test('study-only link picks the first viewable SEG pair by UID, skipping a missing base', () => {
  const r = select(study)
  expect([r.base.uid, r.seg?.uid]).toEqual(['1.3', '2.3'])
})

test('explicit SEG brings its own base; explicit CT shows alone', () => {
  const r = select(study, '2.9')
  expect([r.base.uid, r.seg?.uid]).toEqual(['1.9', '2.9'])
  expect(select(study, '1.3').seg).toBeUndefined()
})

test('missing or unviewable requested series is reported, not replaced', () => {
  expect(() => select(study, '7.7')).toThrow('not in this study')
  expect(() => select(study, '2.1')).toThrow('referenced series not in study')
  expect(() => select(study, '1.5')).toThrow('not a regular 3D volume')
  // Unsupported SEG type: its base still shows, with the reason.
  expect(select(study, '2.7')).toEqual({ base: study[0], refused: 'Segmentation not shown: FRACTIONAL SEG not supported' })
})

test('S3 listing follows continuation tokens; a short series is rejected', async () => {
  const pages: Record<string, string> = {
    '': '<Contents><Key>u/a.dcm</Key></Contents><NextContinuationToken>t+1=</NextContinuationToken>',
    't+1=': '<Contents><Key>u/b.dcm</Key></Contents><Contents><Key>u/x.json</Key></Contents>',
  }
  globalThis.fetch = (async (url: string) => {
    const q = new URL(url).searchParams
    if (q.has('list-type')) return new Response(pages[q.get('continuation-token') ?? ''])
    return new Response(new Uint8Array(4))
  }) as typeof fetch
  const ct = s('1.1', { uuid: 'u', instances: 2 })
  const files = await fetchSeries(ct, new AbortController().signal, () => {})
  expect(files.map((f) => f.name)).toEqual(['a.dcm', 'b.dcm'])
  await expect(fetchSeries({ ...ct, instances: 3 }, new AbortController().signal, () => {})).rejects.toThrow('2 of 3')
})

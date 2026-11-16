// IDC resolution and retrieval: v3 SQL index + public S3. No app state here.

const SQL_URL = 'https://api.imaging.datacommons.cancer.gov/v3/sql'
const UID = /^[0-9]+(\.[0-9]+)*$/

export type Series = {
  uid: string
  modality: string
  description: string
  instances: number
  bucket: string
  uuid: string
  license: string
  doi: string
  segType: string | null
  segments: number | null
  segmentedUid: string | null
  regular: boolean | null
}

export type Selection = { base: Series; seg?: Series }

export function isUid(s: string): boolean {
  return s.length <= 64 && UID.test(s)
}

export async function studySeries(study: string, signal?: AbortSignal): Promise<Series[]> {
  const sql = `SELECT i.SeriesInstanceUID, i.Modality, i.SeriesDescription, i.instanceCount,
    i.aws_bucket, i.crdc_series_uuid, i.license_short_name, i.source_DOI,
    s.SegmentationType, s.total_segments, s.segmented_SeriesInstanceUID, g.regularly_spaced_3d_volume
    FROM index i
    LEFT JOIN seg_index s ON s.SeriesInstanceUID = i.SeriesInstanceUID
    LEFT JOIN volume_geometry_index g ON g.SeriesInstanceUID = i.SeriesInstanceUID
    WHERE i.StudyInstanceUID = ?`
  const res = await fetch(SQL_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sql, params: [study], max_rows: 1000 }),
    signal,
  })
  if (!res.ok) throw new Error(`IDC query failed: HTTP ${res.status} ${await res.text()}`)
  const body = await res.json()
  if (body.truncated) throw new Error('IDC query truncated: study has too many series')
  return body.rows.map((r: Record<string, unknown>) => ({
    uid: r.SeriesInstanceUID,
    modality: r.Modality,
    description: r.SeriesDescription ?? '',
    instances: r.instanceCount,
    bucket: r.aws_bucket,
    uuid: r.crdc_series_uuid,
    license: r.license_short_name,
    doi: r.source_DOI,
    segType: r.SegmentationType ?? null,
    segments: r.total_segments ?? null,
    segmentedUid: r.segmented_SeriesInstanceUID ?? null,
    regular: r.regularly_spaced_3d_volume ?? null,
  }))
}

/** Why this series cannot be shown; undefined when it can (as a volume or, for SEG, an overlay). */
export function unsupported(s: Series, all: Series[]): string | undefined {
  if (s.modality === 'SEG') {
    if (s.segType !== 'BINARY') return `${s.segType ?? 'unknown'} SEG not supported`
    const base = all.find((b) => b.uid === s.segmentedUid)
    if (!base) return 'referenced series not in study'
    return unsupported(base, all) && 'referenced series not viewable'
  }
  if (s.modality === 'SM') return 'slide microscopy not yet supported'
  if (s.regular !== true) return 'not a regular 3D volume'
  return undefined
}

const byUid = (a: Series, b: Series) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0)

/**
 * The series to show. An explicit UID wins (a SEG brings its referenced base;
 * a volume shows alone). Study-only: the first viewable BINARY SEG by UID with
 * its base, else the largest viewable volume (UID tie-break).
 */
export function select(all: Series[], requested?: string): Selection {
  if (requested) {
    const s = all.find((x) => x.uid === requested)
    if (!s) throw new Error(`Series ${requested} is not in this study`)
    const why = unsupported(s, all)
    if (why) throw new Error(`Series ${requested}: ${why}`)
    if (s.modality !== 'SEG') return { base: s }
    return { base: all.find((b) => b.uid === s.segmentedUid) as Series, seg: s }
  }
  const seg = all.filter((s) => s.modality === 'SEG' && !unsupported(s, all)).sort(byUid)[0]
  if (seg) return { base: all.find((b) => b.uid === seg.segmentedUid) as Series, seg }
  const base = all
    .filter((s) => s.modality !== 'SEG' && !unsupported(s, all))
    .sort((a, b) => b.instances - a.instances || byUid(a, b))[0]
  if (!base) throw new Error('No viewable series in this study')
  return { base }
}

const s3 = (s: Series) => `https://${s.bucket}.s3.us-east-1.amazonaws.com`

export async function listKeys(s: Series, signal?: AbortSignal): Promise<string[]> {
  const keys: string[] = []
  let token = ''
  do {
    const q = new URLSearchParams({ 'list-type': '2', prefix: `${s.uuid}/` })
    if (token) q.set('continuation-token', token)
    const res = await fetch(`${s3(s)}/?${q}`, { signal })
    if (!res.ok) throw new Error(`S3 listing failed: HTTP ${res.status}`)
    // ponytail: regex over S3 XML; IDC keys and tokens carry no XML entities.
    const xml = await res.text()
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1])
    token = /<NextContinuationToken>([^<]+)</.exec(xml)?.[1] ?? ''
  } while (token)
  return keys.filter((k) => k.endsWith('.dcm'))
}

/** All instances of a series as Files dcm2niix groups together; rejects an incomplete series. */
export async function fetchSeries(
  s: Series,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<File[]> {
  const keys = await listKeys(s, signal)
  if (keys.length !== s.instances)
    throw new Error(`S3 has ${keys.length} of ${s.instances} instances for ${s.uid}`)
  const files: File[] = new Array(keys.length)
  let next = 0
  let done = 0
  onProgress(0, keys.length)
  const worker = async () => {
    while (next < keys.length) {
      const i = next++
      const res = await fetch(`${s3(s)}/${keys[i]}`, { signal })
      if (!res.ok) throw new Error(`S3 GET ${keys[i]}: HTTP ${res.status}`)
      const name = keys[i].split('/')[1]
      const f = new File([await res.arrayBuffer()], name)
      // dcm2niix groups by folder; fetched files have none.
      Object.defineProperty(f, '_webkitRelativePath', { value: `${s.uuid}/${name}` })
      files[i] = f
      onProgress(++done, keys.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(8, keys.length) }, worker))
  return files
}

/**
 * First WindowCenter/WindowWidth (0028,1050/1051) as a display range.
 * ponytail: byte scan of the first 64 KiB, explicit or implicit VR little endian; a
 * private tag with the same bytes could fool it. Use a DICOM parser if that bites.
 */
export function dicomWindow(buf: ArrayBuffer): { calMin: number; calMax: number } | undefined {
  const u8 = new Uint8Array(buf, 0, Math.min(buf.byteLength, 65536))
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const read = (elem: number): number | undefined => {
    for (let i = 132; i + 8 < u8.length; i++) {
      if (dv.getUint16(i, true) !== 0x0028 || dv.getUint16(i + 2, true) !== elem) continue
      const explicit = u8[i + 4] === 0x44 && u8[i + 5] === 0x53 // 'DS'
      const len = explicit ? dv.getUint16(i + 6, true) : dv.getUint32(i + 4, true)
      if (len > 64) continue
      const txt = new TextDecoder().decode(u8.subarray(i + 8, i + 8 + len))
      const v = Number.parseFloat(txt.split('\\')[0])
      return Number.isFinite(v) ? v : undefined
    }
  }
  const c = read(0x1050)
  const w = read(0x1051)
  if (c === undefined || w === undefined || w <= 0) return undefined
  return { calMin: c - w / 2, calMax: c + w / 2 }
}

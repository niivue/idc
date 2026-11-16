import { convert, type Series as Converted } from '@niivue/dcm2niix'
import NiiVue, { createSlideView, lookupColorMap, NVSlide, SHOW_RENDER, SLICE_TYPE, type SlideView, VOLUME_RENDER_MODE } from '@niivue/niivue'
import { DicomWebWsiSource, indexDicomWsiMetadata, registerDcm2niixDecoders } from '@niivue/nv-ext-tile/dicom'
import ctCinematic from './ct_cinematic.json'
import { dicomWindow, fetchSeries, isUid, type Selection, type Series, select, seriesUrl, studySeries, unsupported } from './idc'
import { type Segment, segColormaps } from './seg'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const statusEl = $('status')
const seriesEl = $<HTMLSelectElement>('series')
const segPanel = $('segments')
const opacityEl = $<HTMLInputElement>('opacity')
const outlineEl = $<HTMLInputElement>('outline')
const cinematicEl = $<HTMLInputElement>('cinematic')

// WebGPU (WebGL2 fallback): WebGL2 cinematic loses label materials when entered after volumes load (core bug, see PLAN.md).
const hasWebGPU = !!(await (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter())
const nv = new NiiVue({ backend: hasWebGPU ? 'webgpu' : 'webgl2', backgroundColor: [0, 0, 0, 1] })
await nv.attachToCanvas($<HTMLCanvasElement>('gl'))
nv.sliceType = SLICE_TYPE.MULTIPLANAR
nv.showRender = SHOW_RENDER.ALWAYS
// Native legend: click a colour box to hide/show, double-click to show only it (again: all); name moves the crosshair.
nv.isLegendToggleEnabled = true
Object.assign(globalThis, { nv }) // console/e2e handle
registerDcm2niixDecoders() // JPEG 2000 / JPEG-LS slide tiles and ICC colour; workers load on first use
nv.addColormap('ct_cinematic', ctCinematic) // CT transfer function from NiiVue's cinematic example
nv.volumeCinematic = { ao: 0.9, aoRadiusMM: 20 } // settings suggested by the TotalSegmentator table
let flatCmap = ''
let cinematicCmap = ''
let baseWindow: { calMin: number; calMax: number } | undefined

let study = ''
let all: Series[] = []
let shown: Selection | undefined
let baseFrameOfRef: unknown
let segments: Segment[] = []
let materialsMatched = 0
let active: AbortController | undefined
let slideView: SlideView | undefined
const glCanvas = $<HTMLCanvasElement>('gl')
const slideCanvas = $<HTMLCanvasElement>('slide')

function showCanvas(slide: boolean) {
  slideCanvas.hidden = !slide
  glCanvas.hidden = slide
  if (!slide) slideView?.setSlide(null)
}

/** Open the first optical path / focal plane of an SM series over WADO-RS. */
async function loadSlide(s: Series, signal: AbortSignal) {
  status('Slide: reading metadata')
  const url = seriesUrl(study, s)
  const res = await fetch(`${url}/metadata`, { signal })
  if (!res.ok) throw new Error(`Slide metadata: HTTP ${res.status}`)
  const index = indexDicomWsiMetadata(await res.json())
  const first = index.slides[0]
  if (!first) throw new Error('Slide: no tiled VOLUME images in this series')
  const source = await DicomWebWsiSource.open(first, { seriesUrl: url }, signal)
  if (signal.aborted) return source.dispose()
  showCanvas(true)
  slideView ??= await createSlideView(slideCanvas)
  slideView.setSlide(NVSlide.fromSource(source))
  segPanel.hidden = true
  shown = { base: s }
  status(index.slides.length > 1 ? `Slide 1 of ${index.slides.length} (optical paths/focal planes)` : 'Slide')
}

function status(msg: string, error = false) {
  statusEl.textContent = msg
  statusEl.classList.toggle('error', error)
}

/** The requested series from the URL; OHIF's SeriesInstanceUIDs wins over the singular alias. */
function readUrl(): { study: string; series?: string } {
  const q = new URLSearchParams(location.search)
  const st = q.get('StudyInstanceUIDs') ?? ''
  const se = q.get('SeriesInstanceUIDs') || q.get('seriesInstanceUID') || undefined
  if (!st) throw new Error('Add ?StudyInstanceUIDs=<uid> to the URL')
  for (const v of [st, se]) {
    if (v?.includes(',')) throw new Error('One study and one series per link are supported')
    if (v !== undefined && !isUid(v)) throw new Error(`Not a DICOM UID: ${v}`)
  }
  return { study: st, series: se }
}

function urlFor(series?: string): string {
  const q = new URLSearchParams({ StudyInstanceUIDs: study })
  if (series) q.set('SeriesInstanceUIDs', series)
  return `?${q}`
}

// Stage timings (ms) of each install, for e2e/timing.mjs and the console.
type Timing = { label: string; download: number; convert: number; render: number }
const timings: Timing[] = []
Object.assign(globalThis, { timings })
let pending: Timing | undefined
const frame = () => new Promise((r) => requestAnimationFrame(r))
/** Close the timing of the install just made: time from conversion end to the next painted frame. */
async function rendered(t0: number) {
  await frame()
  if (pending) timings.push({ ...pending, render: Math.round(performance.now() - t0) })
  pending = undefined
}

async function toNifti(s: Series, signal: AbortSignal, label: string): Promise<{ out: Converted; first: File }> {
  const t0 = performance.now()
  const files = await fetchSeries(s, signal, (d, t) => status(`${label}: downloading ${d}/${t}`))
  const t1 = performance.now()
  status(`${label}: converting`)
  const { series, log } = await convert(files, { args: ['-z', 'n', '-ba', 'o'], signal })
  pending = { label, download: Math.round(t1 - t0), convert: Math.round(performance.now() - t1), render: 0 }
  // ponytail: largest NIfTI wins when a series splits; list alternatives if real studies need them.
  const out = series.filter((x) => x.image.name.endsWith('.nii')).sort((a, b) => b.image.size - a.image.size)[0]
  if (!out) throw new Error(`${label}: dcm2niix produced no image\n${log.slice(-5).join('\n')}`)
  return { out, first: files[0] }
}

let queue: Promise<void> = Promise.resolve()

/** Supersede any running load, then load once it has unwound, so `shown` is never read mid-install. */
function show(requested?: string): Promise<void> {
  active?.abort()
  const ac = new AbortController()
  active = ac
  delete document.body.dataset.shown
  queue = queue.then(() => load(requested, ac))
  return queue
}

async function load(requested: string | undefined, ac: AbortController) {
  const { signal } = ac
  if (signal.aborted) return
  try {
    const sel = select(all, requested)
    if (sel.base.modality === 'SM') {
      if (shown?.base.uid !== sel.base.uid) await loadSlide(sel.base, signal)
      if (!signal.aborted) syncUi()
      return
    }
    if (shown?.base.modality === 'SM') {
      shown = undefined
      showCanvas(false)
    }
    if (shown?.base.uid !== sel.base.uid) {
      const { out, first } = await toNifti(sel.base, signal, 'Image')
      const win = dicomWindow(await first.slice(0, 65536).arrayBuffer())
      const tr = performance.now()
      const vol = await nv.prepareVolume({ url: out.image, name: out.image.name, ...win })
      if (signal.aborted) return
      await nv.loadVolumes([vol])
      await rendered(tr)
      baseWindow = { calMin: vol.calMin, calMax: vol.calMax }
      shown = { base: sel.base }
      baseFrameOfRef = out.json?.FrameOfReferenceUID
      segPanel.hidden = true
      if (signal.aborted) return
    } else if (shown.seg && shown.seg.uid !== sel.seg?.uid) {
      await nv.removeVolume(1)
      shown = { base: sel.base }
      segPanel.hidden = true
      if (signal.aborted) return
    }
    if (sel.seg && shown?.seg?.uid !== sel.seg.uid) {
      status('Image ready; loading segmentation…')
      const { out } = await toNifti(sel.seg, signal, 'Segmentation')
      const segs = (out.json?.Segments as Segment[] | undefined) ?? []
      if (!segs.length) throw new Error('Segmentation has no Segments table')
      // The index's segmented_SeriesInstanceUID is a hint; the SEG object itself must agree.
      if (out.json?.ReferencedSeriesInstanceUID !== sel.base.uid || out.json?.FrameOfReferenceUID !== baseFrameOfRef)
        throw new Error('Segmentation does not reference the image shown (series or frame of reference differs)')
      const maps = segColormaps(segs, lookupColorMap('totalsegmentator'))
      const cmap = nv.addColormap(`seg-${sel.seg.uid}`, maps.flat)
      const cmap3d = nv.addColormap(`seg-${sel.seg.uid}-3d`, maps.cinematic)
      materialsMatched = maps.matched
      const tr = performance.now()
      const vol = await nv.prepareVolume({
        url: out.image,
        name: out.image.name,
        colormap: cmap,
        opacity: Number(opacityEl.value),
        atlasOutline: outlineEl.checked ? 1 : 0,
      })
      if (signal.aborted) return
      await nv.addVolume(vol)
      await rendered(tr)
      flatCmap = cmap
      cinematicCmap = cmap3d
      shown = sel
      segments = segs
      segPanel.hidden = false
      if (signal.aborted) return
    }
    setCinematic(cinematicEl.checked)
    status(shown?.seg ? `${segments.length} segments (${materialsMatched} with 3D materials)` : 'Ready')
  } catch (e) {
    if (signal.aborted) return
    ac.abort() // stop this load's remaining downloads/workers
    status(`${(e as Error).message}${shown ? '\nShowing the previous selection.' : ''}`, true)
  }
  // Keep the URL and selector on what is actually shown.
  syncUi()
}

function syncUi() {
  const uid = shown ? (shown.seg ?? shown.base).uid : ''
  seriesEl.value = uid
  document.body.dataset.shown = uid // settled marker for e2e
  if (shown && new URLSearchParams(location.search).get('SeriesInstanceUIDs') !== uid)
    history.replaceState(null, '', urlFor(uid))
  const credit = shown ? ([shown.base, shown.seg].filter(Boolean) as Series[]) : []
  $('credit').replaceChildren(
    ...credit.flatMap((s) => {
      const a = document.createElement('a')
      a.href = `https://doi.org/${s.doi}`
      a.target = '_blank'
      a.rel = 'noopener'
      a.textContent = `doi:${s.doi}`
      return [`${s.modality}: ${s.license}, `, a, document.createElement('br')]
    }),
  )
}

/** Cinematic: full-canvas path-traced render with per-segment materials; off: MPR + 3D. */
function setCinematic(on: boolean) {
  const hasSeg = nv.volumes.length > 1
  nv.volumeRenderMode = on ? VOLUME_RENDER_MODE.CINEMATIC : VOLUME_RENDER_MODE.COMPOSITE
  nv.sliceType = on ? SLICE_TYPE.RENDER : SLICE_TYPE.MULTIPLANAR
  if (!nv.volumes.length) return
  // The base colormap is the transfer function in cinematic mode; 2D slices keep grey + DICOM window.
  nv.setVolume(0, on ? { colormap: 'ct_cinematic', calMin: ctCinematic.min, calMax: ctCinematic.max } : { colormap: 'gray', ...baseWindow })
  if (hasSeg) {
    nv.setVolume(1, { colormap: on ? cinematicCmap : flatCmap })
    nv.volumeCinematic = { labelMode: 'only' }
  } else nv.volumeCinematic = { labelMode: 'unlabeled' } // CT alone: the transfer function shows everything
}
cinematicEl.onchange = () => setCinematic(cinematicEl.checked)
opacityEl.oninput = () => nv.volumes.length > 1 && nv.setVolume(1, { opacity: Number(opacityEl.value) })
outlineEl.onchange = () => nv.volumes.length > 1 && nv.setVolume(1, { atlasOutline: outlineEl.checked ? 1 : 0 })

seriesEl.onchange = () => {
  history.pushState(null, '', urlFor(seriesEl.value))
  show(seriesEl.value)
}
window.onpopstate = () => show(readUrl().series)

try {
  const req = readUrl()
  study = req.study
  status('Querying IDC…')
  all = await studySeries(study)
  if (!all.length) throw new Error(`Study ${study} not found in IDC`)
  seriesEl.replaceChildren(
    ...all.map((s) => {
      const why = unsupported(s, all)
      const o = new Option(`${s.modality} ${s.description} (${s.instances})${why ? ` — ${why}` : ''}`, s.uid)
      o.disabled = !!why
      return o
    }),
  )
  await show(req.series)
} catch (e) {
  status((e as Error).message, true)
}

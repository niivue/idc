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
const slidePathEl = $<HTMLSelectElement>('slidePath')

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
let baseWindow: { calMin: number; calMax: number } | undefined

let study = ''
let all: Series[] = []
let shown: Selection | undefined
let baseFrameOfRef: unknown
let segCmap = '' // flat label colormap of the shown SEG; `-3d` adds materials
let segSummary = ''
let splitNote = ''
let active: AbortController | undefined
let slideView: SlideView | undefined
const glCanvas = $<HTMLCanvasElement>('gl')
let slideCanvas = $<HTMLCanvasElement>('slide')

function showCanvas(slide: boolean) {
  slideCanvas.hidden = !slide
  if (!slide) slidePathEl.hidden = true
  glCanvas.hidden = slide
  if (!slide) slideView?.setSlide(null)
}

/** Open the first optical path / focal plane of an SM series over WADO-RS. */
async function loadSlide(s: Series, signal: AbortSignal) {
  status('Slide: reading metadata')
  const url = seriesUrl(study, s)
  const res = await fetch(`${url}/metadata`, { signal })
  if (!res.ok) throw new Error(`Slide metadata: HTTP ${res.status}`)
  const { slides } = indexDicomWsiMetadata(await res.json())
  if (!slides.length) throw new Error('Slide: no tiled VOLUME images in this series')
  // One slide per optical path and focal plane (nv-ext-tile): offer them all, show the first.
  const open = async (i: number, sig: AbortSignal) => {
    const source = await DicomWebWsiSource.open(slides[i], { seriesUrl: url }, sig)
    try {
      if (!slideView) {
        slideView = await createSlideView(slideCanvas)
        slideCanvas = slideView.canvas // a replacement when a failed WebGPU start spoiled the original
      }
      if (sig.aborted) return source.dispose()
      showCanvas(true)
      slideView.setSlide(NVSlide.fromSource(source))
    } catch (e) {
      source.dispose()
      throw e
    }
  }
  await open(0, signal)
  if (signal.aborted) return
  slidePathEl.replaceChildren(
    ...slides.map((x, i) => new Option(`${x.opticalPath}${x.zOffsetUm === undefined ? '' : ` z ${x.zOffsetUm} µm`}`, String(i))),
  )
  slidePathEl.hidden = slides.length < 2
  let pathAc: AbortController | undefined
  slidePathEl.onchange = () => {
    // A newer path choice or any series switch (which aborts `signal`) supersedes this open.
    pathAc?.abort()
    pathAc = new AbortController()
    const sig = AbortSignal.any([signal, pathAc.signal])
    open(Number(slidePathEl.value), sig).catch((e) => sig.aborted || status((e as Error).message, true))
  }
  segPanel.hidden = true
  shown = { base: s }
  status(slides.length > 1 ? `Slide: ${slides.length} optical paths/focal planes` : 'Slide')
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
/** Record an install's timing once the next frame paints; not awaited, as rAF pauses in background tabs. */
const rendered = (t: Timing, t0: number) =>
  requestAnimationFrame(() => timings.push({ ...t, render: Math.round(performance.now() - t0) }))

async function toNifti(s: Series, signal: AbortSignal, label: string): Promise<{ out: Converted; first: File; timing: Timing }> {
  const t0 = performance.now()
  const files = await fetchSeries(s, signal, (d, t) => status(`${label}: downloading ${d}/${t}`))
  const t1 = performance.now()
  status(`${label}: converting`)
  const { series, log } = await convert(files, { args: ['-z', 'n', '-ba', 'o'], signal })
  const timing = { label, download: Math.round(t1 - t0), convert: Math.round(performance.now() - t1), render: 0 }
  // ponytail: largest NIfTI wins when a series splits (named in the status); add a picker when a real study needs one.
  const outs = series.filter((x) => x.image.name.endsWith('.nii')).sort((a, b) => b.image.size - a.image.size)
  const out = outs[0]
  if (!out) throw new Error(`${label}: dcm2niix produced no image\n${log.slice(-5).join('\n')}`)
  if (outs.length > 1) splitNote += `\n${label}: series split into ${outs.length} outputs; showing ${out.stem}`
  return { out, first: files[0], timing }
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
  splitNote = ''
  const prev = shown
  try {
    const sel = select(all, requested)
    if (sel.base.modality === 'SM') {
      if (shown?.base.uid !== sel.base.uid) await loadSlide(sel.base, signal)
      if (signal.aborted) return
      if (sel.refused) status(sel.refused, true)
      gateCinematic()
      syncUi()
      return
    }
    if (shown?.base.uid !== sel.base.uid) {
      const { out, first, timing } = await toNifti(sel.base, signal, 'Image')
      const win = dicomWindow(await first.slice(0, 65536).arrayBuffer())
      const tr = performance.now()
      const vol = await nv.prepareVolume({ url: out.image, name: out.image.name, ...win })
      if (signal.aborted) return
      showCanvas(false) // leaving a slide only once the new image is ready
      await nv.loadVolumes([vol])
      rendered(timing, tr)
      baseWindow = { calMin: vol.calMin, calMax: vol.calMax }
      shown = { base: sel.base }
      baseFrameOfRef = out.json?.FrameOfReferenceUID
      segPanel.hidden = true
    } else if (shown.seg && shown.seg.uid !== sel.seg?.uid) {
      await nv.removeVolume(1)
      shown = { base: sel.base }
      segPanel.hidden = true
    }
    if (sel.seg && shown?.seg?.uid !== sel.seg.uid) {
      status('Image ready; loading segmentation…')
      const { out, timing } = await toNifti(sel.seg, signal, 'Segmentation')
      const segs = (out.json?.Segments as Segment[] | undefined) ?? []
      if (!segs.length) throw new Error('Segmentation has no Segments table')
      // The index's segmented_SeriesInstanceUID is a hint; the SEG object itself must agree.
      const refs = out.json?.ReferencedSeriesInstanceUID // every referenced series (a SEG may derive from several)
      if (!(Array.isArray(refs) && refs.includes(sel.base.uid)) || out.json?.FrameOfReferenceUID !== baseFrameOfRef)
        throw new Error('Segmentation does not reference the image shown (series or frame of reference differs)')
      const maps = segColormaps(segs, lookupColorMap('totalsegmentator'))
      const cmap = nv.addColormap(`seg-${sel.seg.uid}`, maps.flat)
      nv.addColormap(`seg-${sel.seg.uid}-3d`, maps.cinematic)
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
      rendered(timing, tr)
      shown = sel
      segCmap = cmap
      segSummary = `${segs.length} segments (${maps.matched} with 3D materials)`
      segPanel.hidden = false
    }
    if (signal.aborted) return
    if (sel.refused) status(sel.refused + splitNote, true)
    else status((shown?.seg ? segSummary : 'Ready') + splitNote)
  } catch (e) {
    if (signal.aborted) return
    ac.abort() // stop this load's remaining downloads/workers
    const note = shown === prev ? (shown ? '\nShowing the previous selection.' : '') : '\nShowing the image without its segmentation.'
    status(`${(e as Error).message}${note}`, true)
  }
  // Keep cinematic state, the URL and the selector on what is actually shown, also after a partial failure.
  gateCinematic()
  if (shown?.base.modality !== 'SM') setCinematic(cinematicEl.checked)
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
      return [`${s.modality}: ${s.license}, `, a, '  ']
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
    nv.setVolume(1, { colormap: `${segCmap}${on ? '-3d' : ''}` })
    nv.volumeCinematic = { labelMode: 'only' }
  } else nv.volumeCinematic = { labelMode: 'unlabeled' } // CT alone: the transfer function shows everything
}
cinematicEl.onchange = () => setCinematic(cinematicEl.checked)
// The transfer function is in Hounsfield units, and WebGL2 cinematic loses label materials (see PLAN.md).
function gateCinematic() {
  const ok = hasWebGPU && shown?.base.modality === 'CT'
  if (!ok && cinematicEl.checked) {
    cinematicEl.checked = false
    setCinematic(false)
  }
  cinematicEl.disabled = !ok
  cinematicEl.parentElement!.title = ok ? '' : hasWebGPU ? 'CT only' : 'Needs WebGPU'
}
gateCinematic()
opacityEl.oninput = () => nv.volumes.length > 1 && nv.setVolume(1, { opacity: Number(opacityEl.value) })
outlineEl.onchange = () => nv.volumes.length > 1 && nv.setVolume(1, { atlasOutline: outlineEl.checked ? 1 : 0 })

// Datasets verified during development (README, PLAN.md); picking one opens that study.
const EXAMPLES: [label: string, study: string, series?: string][] = [
  ['CT + TotalSegmentator SEG (NLST)', '1.2.840.113654.2.55.187766322555605983451267194286230980878'],
  ['CT + SEG, second pairing (NLST)', '1.2.840.113654.2.55.187766322555605983451267194286230980878', '1.2.276.0.7230010.3.1.3.313263360.40027.1706310312.485948'],
  ['H&E slide, JPEG (CPTAC-LUAD)', '2.25.11321499043287739942958746184768363349'],
  ['H&E slide, JPEG 2000 (CATCH)', '2.25.19454760007169100657755148757857609085'],
  ['Multiplexed fluorescence, 3 channels (HTAN-OHSU)', '2.25.56219147941526607962658668060030231728', '1.3.6.1.4.1.5962.99.1.2000002781.2080371485.1655562444509.4.0'],
  ['Uncompressed fluorescence slide (not supported)', '2.25.56219147941526607962658668060030231728', '1.3.6.1.4.1.5962.99.1.1999891937.339225835.1655562333665.4.0'],
  ['MR, CC BY-NC bucket', '1.3.6.1.4.1.14519.5.2.1.186051521067863971269584893740842397538', '1.3.6.1.4.1.14519.5.2.1.175414966301645518238419021688341658582'],
  ['CT + FRACTIONAL SEG (overlay not supported)', '1.3.6.1.4.1.14519.5.2.1.7695.2311.106039727348255984980483774237', '1.3.6.1.4.1.14519.5.2.1.7695.2311.230378240269972963231696070064'],
]
const exampleGroup = () => {
  const g = document.createElement('optgroup')
  g.label = 'Examples'
  g.append(...EXAMPLES.map(([label], i) => new Option(label, `ex:${i}`)), new Option('Custom UID…', 'custom'))
  return g
}

seriesEl.onchange = () => {
  const open = (st: string, se?: string) =>
    location.assign(`?${new URLSearchParams(se ? { StudyInstanceUIDs: st, SeriesInstanceUIDs: se } : { StudyInstanceUIDs: st })}`)
  if (seriesEl.value.startsWith('ex:')) {
    const [, st, se] = EXAMPLES[Number(seriesEl.value.slice(3))]
    return open(st, se)
  }
  if (seriesEl.value === 'custom') {
    const [st, se] = (prompt('IDC StudyInstanceUID, optionally followed by a space and a SeriesInstanceUID') ?? '').trim().split(/\s+/)
    seriesEl.value = document.body.dataset.shown ?? '' // keep the menu on what is shown until the new page loads
    if (!st) return
    if (![st, se].every((u) => u === undefined || isUid(u))) return status(`Not a DICOM UID: ${st} ${se ?? ''}`, true)
    return open(st, se)
  }
  history.pushState(null, '', urlFor(seriesEl.value))
  show(seriesEl.value)
}
window.onpopstate = () => show(readUrl().series)

// Before any lookup, so a failed one still leaves a way to pick another study.
seriesEl.replaceChildren(new Option('Choose an example…', ''), exampleGroup())
try {
  if (!new URLSearchParams(location.search).has('StudyInstanceUIDs')) {
    throw new Error('Choose an example or "Custom UID…" from the menu')
  }
  const req = readUrl()
  study = req.study
  status('Querying IDC…')
  all = await studySeries(study)
  if (!all.length) throw new Error(`Study ${study} not found in IDC`)
  const thisStudy = document.createElement('optgroup')
  thisStudy.label = 'This study'
  thisStudy.append(
    ...all.map((s) => {
      const why = unsupported(s, all)
      const o = new Option(`${s.modality} ${s.description} (${s.instances})${why ? ` — ${why}` : ''}`, s.uid)
      o.disabled = !!why
      return o
    }),
  )
  seriesEl.replaceChildren(thisStudy, exampleGroup())
  await show(req.series)
} catch (e) {
  status((e as Error).message, true)
}

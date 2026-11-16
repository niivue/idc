import { convert, type Series as Converted } from '@niivue/dcm2niix'
import NiiVue, { SHOW_RENDER, SLICE_TYPE } from '@niivue/niivue'
import { dicomWindow, fetchSeries, isUid, type Selection, type Series, select, studySeries, unsupported } from './idc'

type Segment = { LabelValue: number; SegmentNumber: number; SegmentLabel: string; RGB: [number, number, number] }

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const statusEl = $('status')
const seriesEl = $<HTMLSelectElement>('series')
const segPanel = $('segments')
const segList = $('segList')
const opacityEl = $<HTMLInputElement>('opacity')
const outlineEl = $<HTMLInputElement>('outline')

const nv = new NiiVue({ backgroundColor: [0, 0, 0, 1] })
await nv.attachToCanvas($<HTMLCanvasElement>('gl'))
nv.sliceType = SLICE_TYPE.MULTIPLANAR
nv.showRender = SHOW_RENDER.ALWAYS
nv.isLegendVisible = false // the HTML list is the legend
Object.assign(globalThis, { nv }) // console/e2e handle

let study = ''
let all: Series[] = []
let shown: Selection | undefined
let segments: Segment[] = []
let hidden = new Set<number>()
let active: AbortController | undefined

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

async function toNifti(s: Series, signal: AbortSignal, label: string): Promise<{ out: Converted; first: File }> {
  const files = await fetchSeries(s, signal, (d, t) => status(`${label}: downloading ${d}/${t}`))
  status(`${label}: converting`)
  const { series, log } = await convert(files, { args: ['-z', 'n'], signal })
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
    if (shown?.base.uid !== sel.base.uid) {
      const { out, first } = await toNifti(sel.base, signal, 'Image')
      const win = dicomWindow(await first.slice(0, 65536).arrayBuffer())
      const vol = await nv.prepareVolume({ url: out.image, name: out.image.name, ...win })
      if (signal.aborted) return
      await nv.loadVolumes([vol])
      shown = { base: sel.base }
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
      const cmap = nv.addColormap(`seg-${sel.seg.uid}`, {
        R: [0, ...segs.map((s) => s.RGB[0])],
        G: [0, ...segs.map((s) => s.RGB[1])],
        B: [0, ...segs.map((s) => s.RGB[2])],
        A: [0, ...segs.map(() => 255)],
        I: [0, ...segs.map((s) => s.LabelValue)],
        labels: ['', ...segs.map((s) => s.SegmentLabel)],
      })
      const vol = await nv.prepareVolume({
        url: out.image,
        name: out.image.name,
        colormap: cmap,
        opacity: Number(opacityEl.value),
        atlasOutline: outlineEl.checked ? 1 : 0,
      })
      if (signal.aborted) return
      await nv.addVolume(vol)
      shown = sel
      segments = segs
      hidden = new Set()
      renderSegments()
      segPanel.hidden = false
      if (signal.aborted) return
    }
    status(shown?.seg ? `${segments.length} segments` : 'Ready')
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

function renderSegments() {
  segList.replaceChildren(
    ...segments.map((s) => {
      const li = document.createElement('li')
      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = !hidden.has(s.LabelValue)
      box.onchange = () => {
        box.checked ? hidden.delete(s.LabelValue) : hidden.add(s.LabelValue)
        applyHidden()
      }
      const sw = document.createElement('span')
      sw.className = 'swatch'
      sw.style.background = `rgb(${s.RGB.join(',')})`
      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = s.SegmentLabel
      name.onclick = () => {
        hidden = new Set(segments.map((x) => x.LabelValue).filter((v) => v !== s.LabelValue))
        renderSegments()
        applyHidden()
      }
      li.append(box, sw, name)
      return li
    }),
  )
}

const applyHidden = () => nv.setVolume(1, { hiddenLabels: [...hidden] })
$('showAll').onclick = () => {
  hidden = new Set()
  renderSegments()
  applyHidden()
}
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

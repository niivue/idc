import type { ColorMap } from '@niivue/niivue'

type Code = { CodeValue: string; CodingSchemeDesignator: string }
export type Segment = {
  LabelValue: number
  SegmentLabel: string
  RGB?: [number, number, number] // absent when the SEG states no RecommendedDisplayCIELabValue
  SegmentedPropertyTypeCode?: Code
  SegmentedPropertyTypeModifierCode?: Code
}

const code = (c?: Code) => (c ? `${c.CodingSchemeDesignator}:${c.CodeValue}` : '')
const conceptOf = (s: Segment) =>
  [code(s.SegmentedPropertyTypeCode), code(s.SegmentedPropertyTypeModifierCode)].filter(Boolean).join('/')

// ponytail: soft-tissue material for segments the table lacks (e.g. TotalSegmentator v1 heart chambers).
const DEFAULT = { A: 220, S: 190, lo: -40, hi: 20, surface: 200 }

// Golden-angle hues: distinct colours for segments without a recommended display colour.
const fallbackRGB = (i: number): [number, number, number] => {
  const h = (i * 137.508) % 360
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    return Math.round(255 * (0.55 - 0.45 * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
  }
  return [f(0), f(8), f(4)]
}

/**
 * Label colormaps for a SEG's segments, keeping the SEG's own names and colours:
 * `flat` for 2D (opaque), `cinematic` adds per-label materials found by SNOMED
 * code in `materials` (NiiVue's bundled `totalsegmentator` table).
 */
export function segColormaps(segs: Segment[], materials: ColorMap | null) {
  const index = new Map(materials?.codes?.map((c, i) => [c, i]))
  const rows = segs.map((s) => index.get(conceptOf(s)))
  const pick = (key: keyof typeof DEFAULT) => [
    0,
    ...rows.map((i) => (i === undefined ? DEFAULT[key] : ((materials?.[key] as number[] | undefined)?.[i] ?? DEFAULT[key]))),
  ]
  const rgb = segs.map((s, i) => s.RGB ?? fallbackRGB(i))
  const flat = {
    R: [0, ...rgb.map((c) => c[0])],
    G: [0, ...rgb.map((c) => c[1])],
    B: [0, ...rgb.map((c) => c[2])],
    A: [0, ...segs.map(() => 255)],
    I: [0, ...segs.map((s) => s.LabelValue)],
    labels: ['', ...segs.map((s) => s.SegmentLabel)],
  }
  const cinematic = { ...flat, A: pick('A'), S: pick('S'), lo: pick('lo'), hi: pick('hi'), surface: pick('surface') }
  return { flat, cinematic, matched: rows.filter((i) => i !== undefined).length }
}

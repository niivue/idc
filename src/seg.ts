import type { ColorMap } from '@niivue/niivue'

type Code = { CodeValue: string; CodingSchemeDesignator: string }
export type Segment = {
  LabelValue: number
  SegmentLabel: string
  RGB: [number, number, number]
  SegmentedPropertyTypeCode?: Code
  SegmentedPropertyTypeModifierCode?: Code
}

const code = (c?: Code) => (c ? `${c.CodingSchemeDesignator}:${c.CodeValue}` : '')
const conceptOf = (s: Segment) =>
  [code(s.SegmentedPropertyTypeCode), code(s.SegmentedPropertyTypeModifierCode)].filter(Boolean).join('/')

// ponytail: soft-tissue material for segments the table lacks (e.g. TotalSegmentator v1 heart chambers).
const DEFAULT = { A: 220, S: 190, lo: -40, hi: 20, surface: 200 }

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
  const flat = {
    R: [0, ...segs.map((s) => s.RGB[0])],
    G: [0, ...segs.map((s) => s.RGB[1])],
    B: [0, ...segs.map((s) => s.RGB[2])],
    A: [0, ...segs.map(() => 255)],
    I: [0, ...segs.map((s) => s.LabelValue)],
    labels: ['', ...segs.map((s) => s.SegmentLabel)],
  }
  const cinematic = { ...flat, A: pick('A'), S: pick('S'), lo: pick('lo'), hi: pick('hi'), surface: pick('surface') }
  return { flat, cinematic, matched: rows.filter((i) => i !== undefined).length }
}

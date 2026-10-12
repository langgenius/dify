// Base UI positions a popup with `side` and `align`; a placement joins the two in Floating UI's
// `side-align` notation, with the `center` alignment left off. The inline sides follow the text
// direction, so `inline-end` is right in LTR and left in RTL.

const PLACEMENT_PARTS = {
  top: { side: 'top', align: 'center' },
  'top-start': { side: 'top', align: 'start' },
  'top-end': { side: 'top', align: 'end' },
  right: { side: 'right', align: 'center' },
  'right-start': { side: 'right', align: 'start' },
  'right-end': { side: 'right', align: 'end' },
  bottom: { side: 'bottom', align: 'center' },
  'bottom-start': { side: 'bottom', align: 'start' },
  'bottom-end': { side: 'bottom', align: 'end' },
  left: { side: 'left', align: 'center' },
  'left-start': { side: 'left', align: 'start' },
  'left-end': { side: 'left', align: 'end' },
  'inline-start': { side: 'inline-start', align: 'center' },
  'inline-start-start': { side: 'inline-start', align: 'start' },
  'inline-start-end': { side: 'inline-start', align: 'end' },
  'inline-end': { side: 'inline-end', align: 'center' },
  'inline-end-start': { side: 'inline-end', align: 'start' },
  'inline-end-end': { side: 'inline-end', align: 'end' },
} as const satisfies Record<string, { side: string; align: string }>

export type Placement = keyof typeof PLACEMENT_PARTS

export function parsePlacement(placement: Placement) {
  return PLACEMENT_PARTS[placement]
}

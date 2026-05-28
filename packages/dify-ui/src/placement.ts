// Placement type for overlay positioning.
// Mirrors the Floating UI Placement spec — a stable set of 12 CSS-based position values.
// Reference: https://floating-ui.com/docs/useFloating#placement

type Side = 'top' | 'bottom' | 'left' | 'right'
type Align = 'start' | 'center' | 'end'

export type Placement
  = 'top'
    | 'top-start'
    | 'top-end'
    | 'right'
    | 'right-start'
    | 'right-end'
    | 'bottom'
    | 'bottom-start'
    | 'bottom-end'
    | 'left'
    | 'left-start'
    | 'left-end'

const PLACEMENT_PARTS = {
  'top': { side: 'top', align: 'center' },
  'top-start': { side: 'top', align: 'start' },
  'top-end': { side: 'top', align: 'end' },
  'right': { side: 'right', align: 'center' },
  'right-start': { side: 'right', align: 'start' },
  'right-end': { side: 'right', align: 'end' },
  'bottom': { side: 'bottom', align: 'center' },
  'bottom-start': { side: 'bottom', align: 'start' },
  'bottom-end': { side: 'bottom', align: 'end' },
  'left': { side: 'left', align: 'center' },
  'left-start': { side: 'left', align: 'start' },
  'left-end': { side: 'left', align: 'end' },
} satisfies Record<Placement, { side: Side, align: Align }>

export function parsePlacement(placement: Placement): { side: Side, align: Align } {
  return PLACEMENT_PARTS[placement]
}

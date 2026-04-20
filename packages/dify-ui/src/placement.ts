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

export function parsePlacement(placement: Placement): { side: Side, align: Align } {
  const [side, align] = placement.split('-') as [Side, Align | undefined]

  return {
    side,
    align: align ?? 'center',
  }
}

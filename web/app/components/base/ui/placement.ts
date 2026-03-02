import type { Placement } from '@floating-ui/react'

type ParsedPlacement = {
  side: 'top' | 'bottom' | 'left' | 'right'
  align: 'start' | 'center' | 'end'
}

export function parsePlacement(placement: Placement): ParsedPlacement {
  const [side, align] = placement.split('-') as [
    ParsedPlacement['side'],
    ParsedPlacement['align'] | undefined,
  ]

  return {
    side,
    align: align ?? 'center',
  }
}

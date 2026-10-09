import type { KeyboardEvent } from 'react'

type ResizeOptions = {
  side: 'left' | 'right' | 'top' | 'bottom'
  value: number
  min: number
  max?: number
}

export function getKeyboardResizeValue(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>,
  { side, value, min, max = Infinity }: ResizeOptions,
) {
  if (event.altKey || event.ctrlKey || event.metaKey) return undefined

  const step = event.shiftKey ? 32 : 8
  const horizontal = side === 'left' || side === 'right'
  const backward = horizontal ? 'ArrowLeft' : 'ArrowUp'
  const forward = horizontal ? 'ArrowRight' : 'ArrowDown'
  const sign = side === 'left' || side === 'top' ? -1 : 1
  const upperBound = Math.max(min, max)
  let next: number
  if (event.key === backward) next = value - step * sign
  else if (event.key === forward) next = value + step * sign
  else if (event.key === 'Home') next = min
  else if (event.key === 'End' && Number.isFinite(upperBound)) next = upperBound
  else return undefined

  return Math.max(min, Math.min(next, upperBound))
}

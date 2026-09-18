import type { KeyboardEvent } from 'react'

export function getKeyboardMovement(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'>,
) {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const step = event.shiftKey ? 20 : 5
  switch (event.key) {
    case 'ArrowLeft':
      return { x: -step, y: 0 }
    case 'ArrowRight':
      return { x: step, y: 0 }
    case 'ArrowUp':
      return { x: 0, y: -step }
    case 'ArrowDown':
      return { x: 0, y: step }
  }
}

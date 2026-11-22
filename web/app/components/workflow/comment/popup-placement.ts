import type { PopoverPositionerProps } from '@langgenius/dify-ui/popover'
import { useDirection } from '@langgenius/dify-ui/direction-provider'
import { useStore as useReactFlowStore } from 'reactflow'
import { useStore } from '../store'

/**
 * Where a comment popup (a thread or a new comment's input) sits beside its marker in the
 * design: 17px to the right, top raised by a fifth of the popup's height. Collision handling
 * flips it to the left.
 */
export const commentPopupPlacement = {
  side: 'right',
  align: 'start',
  sideOffset: 17,
  alignOffset: ({ positioner }) => -positioner.height / 5,
} satisfies Pick<PopoverPositionerProps, 'side' | 'align' | 'sideOffset' | 'alignOffset'>

/**
 * Everything a comment popup's `PopoverPositioner` takes. The popup stays on the visible
 * canvas, and stays there, still in use, once its marker is panned out of view; it hides with
 * the marker only while closing.
 */
export function useCommentPopupPositioner() {
  const rightPanelWidth = useStore((state) => state.rightPanelWidth ?? 0)
  const direction = useDirection()
  // The tool bar sits at the start of the canvas and the panel at its end.
  const start = 56
  const end = rightPanelWidth + 8
  const canvas = useReactFlowStore((state) => state.domNode)
  return {
    ...commentPopupPlacement,
    sticky: true,
    collisionBoundary: canvas ?? 'clipping-ancestors',
    // Clear of what floats over the canvas: the header, the tool bar, the zoom and
    // history bar, and the right panel.
    collisionPadding: {
      top: 56,
      bottom: 48,
      left: direction === 'rtl' ? end : start,
      right: direction === 'rtl' ? start : end,
    },
    className:
      'data-open:data-anchor-hidden:visible data-open:data-anchor-hidden:pointer-events-auto',
  } satisfies PopoverPositionerProps
}

import type { PopoverPositionerProps } from '@langgenius/dify-ui/popover'
import { useDirection } from '@langgenius/dify-ui/direction-provider'
import { useStore as useReactFlowStore } from 'reactflow'
import { useStore } from '../store'

type Placement = Pick<PopoverPositionerProps, 'side' | 'align' | 'sideOffset' | 'alignOffset'>

/**
 * Where a thread sits beside its marker in the design: 17px to the right, top raised by a
 * fifth of the popup's height.
 */
export const commentThreadPlacement = {
  side: 'right',
  align: 'start',
  sideOffset: 17,
  alignOffset: ({ positioner }) => -positioner.height / 5,
} satisfies Placement

/**
 * Where a new comment's input sits beside its 27px marker in the design: 12px to the right,
 * top 6.5px above the marker's, so a one-line input centers on it.
 */
export const commentDraftPlacement = {
  side: 'right',
  align: 'start',
  sideOffset: 12,
  alignOffset: -6.5,
} satisfies Placement

/**
 * Where a comment popup may go, spread on its `PopoverPositioner` beside its placement. It
 * stays on the visible canvas, and stays there, still in use, once its marker is panned out of
 * view; it hides with the marker only while closing.
 */
export function getCommentPopupBounds({
  canvas,
  direction,
  panelWidth = 0,
}: {
  canvas: HTMLElement | null
  direction: 'ltr' | 'rtl'
  /** Width of the node panel open at the canvas's end. */
  panelWidth?: number
}) {
  // Clear of what floats over the canvas: the header, the zoom and history bar, the tool bar
  // at the canvas's start and the panel at its end.
  const start = 56
  const end = panelWidth + 8
  return {
    sticky: true,
    collisionBoundary: canvas ?? 'clipping-ancestors',
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

/** `getCommentPopupBounds` for the workflow editor's canvas and node panel. */
export function useCommentPopupBounds() {
  const panelWidth = useStore((state) => state.rightPanelWidth ?? 0)
  const direction = useDirection()
  const canvas = useReactFlowStore((state) => state.domNode)
  return getCommentPopupBounds({ canvas: canvas ?? null, direction, panelWidth })
}

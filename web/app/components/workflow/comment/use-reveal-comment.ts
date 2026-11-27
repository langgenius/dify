import type { WorkflowCommentBasic } from '@dify/contracts/api/console/apps/types.gen'
import { useDirection } from '@langgenius/dify-ui/direction-provider'
import { useCallback } from 'react'
import { useReactFlow, useStoreApi } from 'reactflow'
import { useWorkflowStore } from '../store'

/**
 * Selects a comment the user may not be looking at (thread navigation, the comments panel)
 * and brings it into view. The canvas moves only when the marker is outside the area the
 * side panels leave visible, and at once: this navigation is frequent and often
 * keyboard-driven, and an open thread just moves to its new marker.
 */
export function useRevealComment() {
  const reactflow = useReactFlow()
  const flowStore = useStoreApi()
  const direction = useDirection()
  const workflowStore = useWorkflowStore()

  return useCallback(
    (comment: WorkflowCommentBasic) => {
      const { width, height } = flowStore.getState()
      const { rightPanelWidth, setPendingComment, setActiveCommentId } = workflowStore.getState()
      setPendingComment(null)
      setActiveCommentId(comment.id)
      if (!width || !height) return
      // The side panels sit at the inline end: on the right, or on the left in RTL.
      const panelWidth = rightPanelWidth ?? 0
      const visibleStart = direction === 'rtl' ? panelWidth : 0
      const visibleEnd = direction === 'rtl' ? width : width - panelWidth
      const { x, y, zoom } = reactflow.getViewport()
      const markerX = comment.position_x * zoom + x
      const markerY = comment.position_y * zoom + y
      const inView =
        markerX >= visibleStart + 40 &&
        markerX <= visibleEnd - 40 &&
        markerY >= 40 &&
        markerY <= height - 40
      if (inView) return
      reactflow.setViewport({
        x: (visibleStart + visibleEnd) / 2 - comment.position_x * zoom,
        y: height / 2 - comment.position_y * zoom,
        zoom,
      })
    },
    [direction, flowStore, reactflow, workflowStore],
  )
}

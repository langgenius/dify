import type { CanvasEventData } from '../types'
import { useSetAtom } from 'jotai'
import { useCallback, useMemo } from 'react'
import { selectWorkflowNode } from '@/app/components/workflow/utils/node-navigation'
import { difyBuilderCanvasPendingRefreshAtom } from '../store'

export const useDifyBuilderCanvasEvents = (onFocusCanvas: () => void) => {
  const setPendingRefresh = useSetAtom(difyBuilderCanvasPendingRefreshAtom)
  const onCanvasEvent = useCallback(
    (data: CanvasEventData) => {
      const event = data.event
      switch (event) {
        case 'focus_workflow':
          onFocusCanvas()
          return
        case 'highlight_edit_target':
        case 'focus_error_node':
        case 'focus_checklist_node':
        case 'mark_test_error':
          if (data.node_id) selectWorkflowNode(data.node_id, true)
          return
        case 'reset_build_canvas':
        case 'revert_checkpoint':
          return setPendingRefresh({ sessionId: data.session_id })
        case 'add_start_node':
        case 'add_knowledge_node':
        case 'add_llm_node':
        case 'add_output_node':
        case 'apply_edit_plan':
        case 'apply_error_fix':
        case 'mark_repair_applied':
        case 'apply_preflight_fix':
          // Keep the requested node until its graph is applied, including across later markers.
          return setPendingRefresh((pending) => ({
            sessionId: data.session_id,
            focusNodeId:
              data.node_id ??
              (pending?.sessionId === data.session_id ? pending.focusNodeId : undefined),
          }))
        case 'create_checkpoint':
        case 'start_test_run':
        case 'start_retest':
        case 'mark_test_success':
        case 'mark_review_ready':
        case 'cancel_publish':
        case 'publish_workflow':
          return
        default:
          event satisfies never
      }
    },
    [onFocusCanvas, setPendingRefresh],
  )
  const reset = useCallback(() => setPendingRefresh(null), [setPendingRefresh])
  return useMemo(() => ({ onCanvasEvent, reset }), [onCanvasEvent, reset])
}

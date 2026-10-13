import type { CanvasEventData } from '../types'
import { useSetAtom } from 'jotai'
import { useCallback, useMemo } from 'react'
import { selectWorkflowNode } from '@/app/components/workflow/utils/node-navigation'
import { difyBuilderCanvasPendingRefreshAtom } from '../store'

export const useDifyBuilderCanvasEvents = (
  onPublishWorkflow?: () => void,
  onResetPublication?: () => void,
) => {
  const setPendingRefresh = useSetAtom(difyBuilderCanvasPendingRefreshAtom)

  const onCanvasEvent = useCallback(
    (data: CanvasEventData) => {
      const event = data.event
      switch (event) {
        case 'highlight_edit_target':
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
          // Keep the requested node until its graph is applied, including across later markers.
          return setPendingRefresh((pending) => ({
            sessionId: data.session_id,
            focusNodeId:
              data.node_id ??
              (pending?.sessionId === data.session_id ? pending.focusNodeId : undefined),
          }))
        case 'publish_workflow':
          onPublishWorkflow?.()
          return
        default:
          event satisfies never
      }
    },
    [onPublishWorkflow, setPendingRefresh],
  )
  const reset = useCallback(() => {
    onResetPublication?.()
    setPendingRefresh(null)
  }, [onResetPublication, setPendingRefresh])
  return useMemo(() => ({ onCanvasEvent, reset }), [onCanvasEvent, reset])
}

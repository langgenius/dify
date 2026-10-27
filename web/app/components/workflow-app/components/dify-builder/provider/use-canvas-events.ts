import type { SessionRunEvents } from '../session/types'
import type { CanvasEventData } from '../types'
import { useSetAtom } from 'jotai'
import { useCallback, useMemo } from 'react'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { difyBuilderCanvasPendingRefreshAtom } from '../store'

export const useDifyBuilderCanvasEvents = (
  onPublishWorkflow?: () => void,
  onResetPublication?: () => void,
) => {
  const setPendingRefresh = useSetAtom(difyBuilderCanvasPendingRefreshAtom)
  const workflowStore = useWorkflowStore()
  const clearEditTargets = useCallback(() => {
    const { builderEditTargetNodeIds, setBuilderEditTargetNodeIds } = workflowStore.getState()
    if (builderEditTargetNodeIds.length) setBuilderEditTargetNodeIds([])
  }, [workflowStore])

  const onSessionStateChanged = useCallback<NonNullable<SessionRunEvents['onSessionStateChanged']>>(
    ({ phase, run_status }) => {
      if (run_status === 'complete' || phase === 'test') clearEditTargets()
    },
    [clearEditTargets],
  )

  const onCanvasEvent = useCallback(
    (data: CanvasEventData) => {
      const event = data.event
      switch (event) {
        case 'edit_targets_changed':
          if (data.node_ids.length)
            workflowStore.getState().setBuilderEditTargetNodeIds(data.node_ids)
          else clearEditTargets()
          return
        case 'graph_changed':
          if (data.cause === 'restore') clearEditTargets()
          return setPendingRefresh({
            sessionId: data.session_id,
          })
        case 'publish_workflow':
          onPublishWorkflow?.()
          return
        default:
          event satisfies never
      }
    },
    [clearEditTargets, onPublishWorkflow, setPendingRefresh, workflowStore],
  )
  const reset = useCallback(() => {
    onResetPublication?.()
    clearEditTargets()
  }, [clearEditTargets, onResetPublication])
  return useMemo(
    () => ({ onCanvasEvent, onSessionStateChanged, reset }),
    [onCanvasEvent, onSessionStateChanged, reset],
  )
}

import type { Shape } from '../store'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useStore, useWorkflowStore } from '../store'

export const isBuilderCanvasActive = (
  state: Pick<Shape, 'canvasReadOnly' | 'workflowDraftSyncPhase'>,
) => state.canvasReadOnly || state.workflowDraftSyncPhase !== 'idle'

export const useWorkflowViewport = () => {
  const workflowStore = useWorkflowStore()
  const canvas = useStoreApi()
  const builderCanvasActive = useStore(isBuilderCanvasActive)

  const handleViewportUserInteraction = useCallback(() => {
    const state = workflowStore.getState()
    // The edit lock can be released before a queued Builder focus finishes.
    // The next Builder command resets this flag, rather than unlocking the canvas.
    state.setBuilderViewportManuallyChanged(true)
    // Stop an automatic focus animation before the user's gesture takes over.
    canvas.getState().d3Selection?.interrupt()
  }, [canvas, workflowStore])

  return { builderCanvasActive, handleViewportUserInteraction }
}

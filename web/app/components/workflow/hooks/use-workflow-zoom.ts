import { useCallback } from 'react'
import { useReactFlow } from 'reactflow'
import { useNodesSyncDraft } from './use-nodes-sync-draft'
import { useWorkflowReadOnly } from './use-workflow'

export const useWorkflowZoom = () => {
  const { handleSyncWorkflowDraft } = useNodesSyncDraft()
  const { getWorkflowReadOnly } = useWorkflowReadOnly()
  const {
    zoomIn,
    zoomOut,
    zoomTo,
    fitView,
  } = useReactFlow()

  const runZoomAction = useCallback((action: () => void) => {
    if (getWorkflowReadOnly())
      return

    action()
    handleSyncWorkflowDraft()
  }, [getWorkflowReadOnly, handleSyncWorkflowDraft])

  return {
    handleFitView: useCallback(() => runZoomAction(fitView), [fitView, runZoomAction]),
    handleBackToOriginalSize: useCallback(() => runZoomAction(() => zoomTo(1)), [runZoomAction, zoomTo]),
    handleSizeToHalf: useCallback(() => runZoomAction(() => zoomTo(0.5)), [runZoomAction, zoomTo]),
    handleZoomOut: useCallback(() => runZoomAction(zoomOut), [runZoomAction, zoomOut]),
    handleZoomIn: useCallback(() => runZoomAction(zoomIn), [runZoomAction, zoomIn]),
  }
}

import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useHooksStore } from '../hooks-store'
import { useStore } from '../store'

export const useWorkflowViewport = () => {
  const canvas = useStoreApi()
  const canvasReadOnly = useStore((state) => state.canvasReadOnly)
  const onViewportInteraction = useHooksStore((state) => state.onViewportInteraction)

  const handleViewportUserInteraction = useCallback(() => {
    onViewportInteraction()
    canvas.getState().d3Selection?.interrupt()
  }, [canvas, onViewportInteraction])

  return { canvasReadOnly, handleViewportUserInteraction }
}

import { useCallback } from 'react'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useSetLocalStorage } from '@/hooks/use-local-storage'
import { useStore } from '../store'
import { useNodesReadOnly } from './use-workflow'

const WORKFLOW_CANVAS_MAXIMIZE_STORAGE_KEY = 'workflow-canvas-maximize'

export const useWorkflowCanvasMaximize = () => {
  const { eventEmitter } = useEventEmitterContextContext()
  const maximizeCanvas = useStore(s => s.maximizeCanvas)
  const setMaximizeCanvas = useStore(s => s.setMaximizeCanvas)
  const { getNodesReadOnly } = useNodesReadOnly()
  const setStoredMaximizeCanvas = useSetLocalStorage<boolean>(WORKFLOW_CANVAS_MAXIMIZE_STORAGE_KEY)

  const handleToggleMaximizeCanvas = useCallback(() => {
    if (getNodesReadOnly())
      return

    const nextValue = !maximizeCanvas
    setMaximizeCanvas(nextValue)
    setStoredMaximizeCanvas(nextValue)
    eventEmitter?.emit({
      type: 'workflow-canvas-maximize',
      payload: nextValue,
    } as never)
  }, [eventEmitter, getNodesReadOnly, maximizeCanvas, setMaximizeCanvas, setStoredMaximizeCanvas])

  return {
    handleToggleMaximizeCanvas,
  }
}

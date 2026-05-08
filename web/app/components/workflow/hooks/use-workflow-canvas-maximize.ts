import { useCallback } from 'react'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useStore } from '../store'
import { useNodesReadOnly } from './use-workflow'

export const useWorkflowCanvasMaximize = () => {
  const { eventEmitter } = useEventEmitterContextContext()
  const maximizeCanvas = useStore(s => s.maximizeCanvas)
  const setMaximizeCanvas = useStore(s => s.setMaximizeCanvas)
  const { getNodesReadOnly } = useNodesReadOnly()

  const handleToggleMaximizeCanvas = useCallback(() => {
    if (getNodesReadOnly())
      return

    const nextValue = !maximizeCanvas
    setMaximizeCanvas(nextValue)
    localStorage.setItem('workflow-canvas-maximize', String(nextValue))
    eventEmitter?.emit({
      type: 'workflow-canvas-maximize',
      payload: nextValue,
    } as never)
  }, [eventEmitter, getNodesReadOnly, maximizeCanvas, setMaximizeCanvas])

  return {
    handleToggleMaximizeCanvas,
  }
}

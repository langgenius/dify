import { useCallback } from 'react'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useLocalStorage } from '@/hooks/use-local-storage'
import { useStore } from '../store'
import { useNodesReadOnly } from './use-workflow'

export const useWorkflowCanvasMaximize = () => {
  const { eventEmitter } = useEventEmitterContextContext()
  const maximizeCanvas = useStore(s => s.maximizeCanvas)
  const setMaximizeCanvas = useStore(s => s.setMaximizeCanvas)
  const { getNodesReadOnly } = useNodesReadOnly()
  const [, setWorkflowCanvasMaximize] = useLocalStorage<string>('workflow-canvas-maximize', '0', { raw: true })

  const handleToggleMaximizeCanvas = useCallback(() => {
    if (getNodesReadOnly())
      return

    const nextValue = !maximizeCanvas
    setMaximizeCanvas(nextValue)
    setWorkflowCanvasMaximize(String(nextValue))
    eventEmitter?.emit({
      type: 'workflow-canvas-maximize',
      payload: nextValue,
    } as never)
  }, [eventEmitter, getNodesReadOnly, maximizeCanvas, setMaximizeCanvas, setWorkflowCanvasMaximize])

  return {
    handleToggleMaximizeCanvas,
  }
}

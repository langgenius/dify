import { useCallback } from 'react'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useSetLocalStorage } from '@/hooks/use-local-storage'
import { useStore } from '../store'
import { useNodesReadOnly } from './use-workflow'

export const useWorkflowCanvasMaximize = () => {
  const { eventEmitter } = useEventEmitterContextContext()
  const maximizeCanvas = useStore(s => s.maximizeCanvas)
  const setMaximizeCanvas = useStore(s => s.setMaximizeCanvas)
  const { getNodesReadOnly } = useNodesReadOnly()
  const setLocalStorageMaximize = useSetLocalStorage<string>('workflow-canvas-maximize', { raw: true })

  const handleToggleMaximizeCanvas = useCallback(() => {
    if (getNodesReadOnly())
      return

    const nextValue = !maximizeCanvas
    setMaximizeCanvas(nextValue)
    setLocalStorageMaximize(String(nextValue))
    eventEmitter?.emit({
      type: 'workflow-canvas-maximize',
      payload: nextValue,
    } as never)
  }, [eventEmitter, getNodesReadOnly, maximizeCanvas, setMaximizeCanvas, setLocalStorageMaximize])

  return {
    handleToggleMaximizeCanvas,
  }
}

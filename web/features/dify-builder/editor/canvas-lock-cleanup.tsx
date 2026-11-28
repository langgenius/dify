import { useEffect } from 'react'
import { useWorkflowAppSelector as useStore } from '@/app/components/workflow-app/store/workflow'

export const DifyBuilderCanvasLockCleanup = ({ enabled }: { enabled: boolean }) => {
  const setCanvasReadOnly = useStore((state) => state.setCanvasReadOnly)

  // Release after the parent's session cleanup, which can still update the lock.
  useEffect(() => {
    if (!enabled) {
      setCanvasReadOnly(false)
      return
    }
    return () => setCanvasReadOnly(false)
  }, [enabled, setCanvasReadOnly])

  return null
}

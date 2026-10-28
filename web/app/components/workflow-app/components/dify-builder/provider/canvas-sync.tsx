import { useEffect } from 'react'
import { useStore } from '@/app/components/workflow/store'

export const DifyBuilderCanvasLockCleanup = () => {
  const setCanvasReadOnly = useStore((state) => state.setCanvasReadOnly)

  // Release after the parent's session cleanup, which can still update the lock.
  useEffect(() => {
    return () => setCanvasReadOnly(false)
  }, [setCanvasReadOnly])

  return null
}

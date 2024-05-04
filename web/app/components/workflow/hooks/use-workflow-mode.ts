import { useMemo } from 'react'
import { useStore } from '../store'

export const useWorkflowMode = () => {
  const historyWorkflowData = useStore(s => s.historyWorkflowData)
  const isRestoring = useStore(s => s.isRestoring)
  return useMemo(() => {
    return {
      normal: !historyWorkflowData && !isRestoring,
      restoring: isRestoring,
      viewHistory: !!historyWorkflowData,
    }
  }, [historyWorkflowData, isRestoring])
}

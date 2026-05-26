import { useMemo } from 'react'
import { useStore } from '@/app/components/workflow/store/index'

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

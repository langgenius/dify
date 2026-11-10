import { useCallback } from 'react'
import { useWorkflowAppStore } from '@/app/components/workflow-app/store/workflow'

export function useDifyBuilderViewportInteraction() {
  const workflowStore = useWorkflowAppStore()
  return useCallback(() => {
    workflowStore.getState().setBuilderViewportManuallyChanged(true)
  }, [workflowStore])
}

import { useCallback } from 'react'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useGetRunAndTraceUrl = () => {
  const workflowStore = useWorkflowStore()
  const getWorkflowRunAndTraceUrl = useCallback((runId: string) => {
    const { appId } = workflowStore.getState()

    return {
      runUrl: `/apps/${appId}/workflow-runs/${runId}`,
      traceUrl: `/apps/${appId}/workflow-runs/${runId}/node-executions`,
    }
  }, [workflowStore])

  return {
    getWorkflowRunAndTraceUrl,
  }
}

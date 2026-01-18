import { useCallback } from 'react'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useGetRunAndTraceUrl = () => {
  const workflowStore = useWorkflowStore()
  const getWorkflowRunAndTraceUrl = useCallback((runId?: string) => {
    const { pipelineId } = workflowStore.getState()
    if (!pipelineId || !runId) {
      return {
        runUrl: '',
        traceUrl: '',
      }
    }

    return {
      runUrl: `/rag/pipelines/${pipelineId}/workflow-runs/${runId}`,
      traceUrl: `/rag/pipelines/${pipelineId}/workflow-runs/${runId}/node-executions`,
    }
  }, [workflowStore])

  return {
    getWorkflowRunAndTraceUrl,
  }
}

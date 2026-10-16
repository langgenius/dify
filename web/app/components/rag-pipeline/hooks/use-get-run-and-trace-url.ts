import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { knowledgePipelineIdentityAtom } from '@/app/components/workflow/editor-resource/state'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useGetRunAndTraceUrl = () => {
  const { pipelineId } = useAtomValue(knowledgePipelineIdentityAtom)
  const workflowStore = useWorkflowStore()
  const getWorkflowRunAndTraceUrl = useCallback(
    (runId: string) => {
      return {
        runUrl: `/rag/pipelines/${pipelineId}/workflow-runs/${runId}`,
        traceUrl: `/rag/pipelines/${pipelineId}/workflow-runs/${runId}/node-executions`,
      }
    },
    [workflowStore],
  )

  return {
    getWorkflowRunAndTraceUrl,
  }
}

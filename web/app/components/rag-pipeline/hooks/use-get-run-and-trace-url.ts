import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { knowledgePipelineIdentityAtom } from '@/app/components/workflow/editor-resource/state'

export const useGetRunAndTraceUrl = () => {
  const { pipelineId } = useAtomValue(knowledgePipelineIdentityAtom)
  const getWorkflowRunAndTraceUrl = useCallback(
    (runId: string) => {
      return {
        runUrl: `/rag/pipelines/${pipelineId}/workflow-runs/${runId}`,
        traceUrl: `/rag/pipelines/${pipelineId}/workflow-runs/${runId}/node-executions`,
      }
    },
    [pipelineId],
  )

  return {
    getWorkflowRunAndTraceUrl,
  }
}

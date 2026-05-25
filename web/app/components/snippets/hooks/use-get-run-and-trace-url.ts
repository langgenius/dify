import { useCallback } from 'react'

export const useGetRunAndTraceUrl = (snippetId: string) => {
  const getWorkflowRunAndTraceUrl = useCallback((runId?: string) => {
    if (!runId) {
      return {
        runUrl: '',
        traceUrl: '',
      }
    }

    return {
      runUrl: `/snippets/${snippetId}/workflow-runs/${runId}`,
      traceUrl: `/snippets/${snippetId}/workflow-runs/${runId}/node-executions`,
    }
  }, [snippetId])

  return {
    getWorkflowRunAndTraceUrl,
  }
}

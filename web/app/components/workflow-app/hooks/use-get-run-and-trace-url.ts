import { useAtomValue } from 'jotai'
import { useCallback } from 'react'
import { editorResourceAtom } from '@/app/components/workflow/editor-resource/state'

export const useGetRunAndTraceUrl = () => {
  const resource = useAtomValue(editorResourceAtom)
  if (resource.kind !== 'app') throw new Error('App run URLs require an app editor')
  const { appId } = resource
  const getWorkflowRunAndTraceUrl = useCallback(
    (runId: string) => {
      return {
        runUrl: `/apps/${appId}/workflow-runs/${runId}`,
        traceUrl: `/apps/${appId}/workflow-runs/${runId}/node-executions`,
      }
    },
    [appId],
  )

  return {
    getWorkflowRunAndTraceUrl,
  }
}

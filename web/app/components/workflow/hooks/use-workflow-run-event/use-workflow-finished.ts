import type { NodeRunningStatus } from '@/app/components/workflow/types'
import type { NodeTracing, WorkflowFinishedResponse } from '@/types/workflow'
import { toast } from '@langgenius/dify-ui/toast'
import { produce } from 'immer'
import { useCallback, useEffect, useRef } from 'react'
import { useStoreApi } from 'reactflow'
import { getFilesInLogs } from '@/app/components/base/file-uploader/utils'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useStore, useWorkflowStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { fetchTracingList } from '@/service/log'

function getLatestExecutionsByNodeId(tracing: NodeTracing[]) {
  const latestExecutions = new Map<string, NodeTracing>()
  tracing.forEach((execution) => {
    const current = latestExecutions.get(execution.node_id)
    if (!current || execution.index >= current.index)
      latestExecutions.set(execution.node_id, execution)
  })
  return latestExecutions
}

export const useFailedWorkflowRunReconciliation = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()
  const getWorkflowRunAndTraceUrl = useHooksStore((state) => state.getWorkflowRunAndTraceUrl)
  const failedRunId = useStore((state) => {
    const result = state.workflowRunningData?.result as { id?: string; status: string } | undefined
    return result?.status === WorkflowRunningStatus.Failed ? result.id : undefined
  })
  const reconciledRunIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!failedRunId || reconciledRunIdRef.current === failedRunId) return
    reconciledRunIdRef.current = failedRunId

    const reconcile = async () => {
      try {
        const { traceUrl } = getWorkflowRunAndTraceUrl(failedRunId)
        const { data: tracing } = await fetchTracingList({ url: traceUrl })
        const { workflowRunningData, setWorkflowRunningData } = workflowStore.getState()
        const activeRunId = (workflowRunningData?.result as { id?: string } | undefined)?.id
        if (!workflowRunningData || activeRunId !== failedRunId) return

        setWorkflowRunningData(
          produce(workflowRunningData, (draft) => {
            draft.tracing = tracing
          }),
        )

        const latestExecutions = getLatestExecutionsByNodeId(tracing)
        const { getNodes, setNodes, edges, setEdges } = store.getState()
        setNodes(
          produce(getNodes(), (draft) => {
            draft.forEach((node) => {
              const execution = latestExecutions.get(node.id)
              if (execution) node.data._runningStatus = execution.status as NodeRunningStatus
            })
          }),
        )
        setEdges(
          produce(edges, (draft) => {
            draft.forEach((edge) => {
              const execution = latestExecutions.get(edge.target)
              if (execution) {
                edge.data = {
                  ...edge.data,
                  _targetRunningStatus: execution.status as NodeRunningStatus,
                }
              }
            })
          }),
        )
      } catch (error) {
        const result = workflowStore.getState().workflowRunningData?.result
        const activeRunId = (result as { id?: string } | undefined)?.id
        if (activeRunId === failedRunId) toast.error(`${error}`)
      }
    }

    void reconcile()
  }, [failedRunId, getWorkflowRunAndTraceUrl, store, workflowStore])
}

export const useWorkflowFinished = () => {
  const workflowStore = useWorkflowStore()

  const handleWorkflowFinished = useCallback(
    (params: WorkflowFinishedResponse) => {
      const { data } = params
      const { workflowRunningData, setWorkflowRunningData } = workflowStore.getState()

      const isStringOutput =
        data.outputs &&
        Object.keys(data.outputs).length === 1 &&
        typeof data.outputs[Object.keys(data.outputs)[0]!] === 'string'

      setWorkflowRunningData(
        produce(workflowRunningData!, (draft) => {
          draft.result = {
            ...draft.result,
            ...data,
            files: getFilesInLogs(data.outputs),
          } as any
          if (isStringOutput) {
            draft.resultTabActive = true
            draft.resultText = data.outputs[Object.keys(data.outputs)[0]!]
          }
        }),
      )
    },
    [workflowStore],
  )

  return {
    handleWorkflowFinished,
  }
}

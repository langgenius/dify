import { produce } from 'immer'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { NodeRunningStatus, WorkflowRunningStatus } from '@/app/components/workflow/types'

export const useWorkflowFailed = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()

  const handleWorkflowFailed = useCallback(() => {
    const { workflowRunningData, setWorkflowRunningData } = workflowStore.getState()
    if (!workflowRunningData) return
    if (
      workflowRunningData.result.status === WorkflowRunningStatus.Succeeded ||
      workflowRunningData.result.status === WorkflowRunningStatus.Failed ||
      workflowRunningData.result.status === WorkflowRunningStatus.Stopped
    )
      return

    const { getNodes, setNodes, edges, setEdges } = store.getState()

    setWorkflowRunningData(
      produce(workflowRunningData, (draft) => {
        draft.result = {
          ...draft.result,
          status: WorkflowRunningStatus.Failed,
        }
        draft.tracing?.forEach((trace) => {
          if (trace.status === NodeRunningStatus.Running) trace.status = NodeRunningStatus.Failed
        })
      }),
    )

    setNodes(
      produce(getNodes(), (draft) => {
        draft.forEach((node) => {
          if (node.data._runningStatus === NodeRunningStatus.Running)
            node.data._runningStatus = NodeRunningStatus.Failed
          node.data._waitingRun = false
        })
      }),
    )
    setEdges(
      produce(edges, (draft) => {
        draft.forEach((edge) => {
          if (!edge.data) return
          if (edge.data._sourceRunningStatus === NodeRunningStatus.Running)
            edge.data._sourceRunningStatus = NodeRunningStatus.Failed
          if (edge.data._targetRunningStatus === NodeRunningStatus.Running)
            edge.data._targetRunningStatus = NodeRunningStatus.Failed
          edge.data._waitingRun = false
        })
      }),
    )
  }, [store, workflowStore])

  return {
    handleWorkflowFailed,
  }
}

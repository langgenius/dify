import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { produce } from 'immer'
import type { WorkflowStartedResponse } from '@/types/workflow'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useWorkflowStarted = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()

  const handleWorkflowStarted = useCallback((params: WorkflowStartedResponse) => {
    const { task_id, data } = params
    const {
      workflowRunningData,
      setWorkflowRunningData,
      setIterParallelLogMap,
    } = workflowStore.getState()
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    setIterParallelLogMap(new Map())
    setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
      draft.task_id = task_id
      draft.result = {
        ...draft?.result,
        ...data,
        status: WorkflowRunningStatus.Running,
      }
    }))
    const nodes = getNodes()
    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        node.data._waitingRun = true
        node.data._runningBranchId = undefined
      })
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      draft.forEach((edge) => {
        edge.data = {
          ...edge.data,
          _sourceRunningStatus: undefined,
          _targetRunningStatus: undefined,
          _waitingRun: true,
        }
      })
    })
    setEdges(newEdges)
  }, [workflowStore, store])

  return {
    handleWorkflowStarted,
  }
}

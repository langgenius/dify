import type { WorkflowStartedResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { WorkflowRunningStatus } from '@/app/components/workflow/types'
import { useCollaborativeWorkflow } from '../use-collaborative-workflow'

export const useWorkflowStarted = () => {
  const store = useStoreApi()
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const workflowStore = useWorkflowStore()

  const handleWorkflowStarted = useCallback(
    (params: WorkflowStartedResponse) => {
      const { task_id, data } = params
      const { workflowRunningData, setWorkflowRunningData, setIterParallelLogMap } =
        workflowStore.getState()
      const { getNodes, edges } = store.getState()
      if (workflowRunningData?.result?.status === WorkflowRunningStatus.Paused) {
        setWorkflowRunningData(
          produce(workflowRunningData!, (draft) => {
            draft.result = {
              ...draft.result,
              status: WorkflowRunningStatus.Running,
            }
          }),
        )
        return
      }
      setIterParallelLogMap(new Map())
      setWorkflowRunningData(
        produce(workflowRunningData!, (draft) => {
          draft.task_id = task_id
          draft.result = {
            ...draft?.result,
            ...data,
            status: WorkflowRunningStatus.Running,
          }
          draft.resultText = ''
          draft.resultTextSelectorKey = undefined
        }),
      )
      const nodes = getNodes()
      const newNodes = produce(nodes, (draft) => {
        draft.forEach((node) => {
          node.data._waitingRun = true
          node.data._runningBranchId = undefined
        })
      })
      collaborativeWorkflow.setNodes(newNodes, false)
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
      collaborativeWorkflow.setEdges(newEdges, false)
    },
    [collaborativeWorkflow, workflowStore, store],
  )

  return {
    handleWorkflowStarted,
  }
}

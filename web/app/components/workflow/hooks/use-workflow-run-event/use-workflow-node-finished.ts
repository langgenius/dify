import type { NodeFinishedResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useWorkflowStoreApi } from '@/app/components/workflow/hooks/use-workflow-reactflow'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'
import { useWorkflowStore } from '@/app/components/workflow/store'
import {
  BlockEnum,
  NodeRunningStatus,
} from '@/app/components/workflow/types'

export const useWorkflowNodeFinished = () => {
  const store = useWorkflowStoreApi()
  const workflowStore = useWorkflowStore()

  const handleWorkflowNodeFinished = useCallback((params: NodeFinishedResponse) => {
    const { data } = params
    const status = data.status as NodeRunningStatus
    const {
      workflowRunningData,
      setWorkflowRunningData,
    } = workflowStore.getState()
    const {
      nodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    setWorkflowRunningData(produce(workflowRunningData!, (draft) => {
      const currentIndex = draft.tracing!.findIndex(item => item.id === data.id)
      if (currentIndex > -1) {
        draft.tracing![currentIndex] = {
          ...draft.tracing![currentIndex],
          ...data,
        }
      }
    }))

    const newNodes = produce(nodes, (draft) => {
      const currentNode = draft.find(node => node.id === data.node_id)!
      currentNode.data._runningStatus = status
      if (status === NodeRunningStatus.Exception) {
        if (data.execution_metadata?.error_strategy === ErrorHandleTypeEnum.failBranch)
          currentNode.data._runningBranchId = ErrorHandleTypeEnum.failBranch
      }
      else {
        if (data.node_type === BlockEnum.IfElse)
          currentNode.data._runningBranchId = data?.outputs?.selected_case_id

        if (data.node_type === BlockEnum.QuestionClassifier)
          currentNode.data._runningBranchId = data?.outputs?.class_id
        if (data.node_type === BlockEnum.HumanInput)
          currentNode.data._runningBranchId = data?.outputs?.__action_id
      }
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      const incomeEdges = draft.filter((edge) => {
        return edge.target === data.node_id
      })
      incomeEdges.forEach((edge) => {
        edge.data = {
          ...edge.data,
          _targetRunningStatus: status,
        }
      })
    })
    setEdges(newEdges)
  }, [store, workflowStore])

  return {
    handleWorkflowNodeFinished,
  }
}

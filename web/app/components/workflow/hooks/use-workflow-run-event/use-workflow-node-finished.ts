import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { produce } from 'immer'
import type { NodeFinishedResponse } from '@/types/workflow'
import {
  BlockEnum,
  NodeRunningStatus,
} from '@/app/components/workflow/types'
import { ErrorHandleTypeEnum } from '@/app/components/workflow/nodes/_base/components/error-handle/types'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useWorkflowNodeFinished = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()

  const handleWorkflowNodeFinished = useCallback((params: NodeFinishedResponse) => {
    const { data } = params
    const {
      workflowRunningData,
      setWorkflowRunningData,
    } = workflowStore.getState()
    const {
      getNodes,
      setNodes,
      edges,
      setEdges,
    } = store.getState()
    const nodes = getNodes()
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
      currentNode.data._runningStatus = data.status
      if (data.status === NodeRunningStatus.Exception) {
        if (data.execution_metadata?.error_strategy === ErrorHandleTypeEnum.failBranch)
          currentNode.data._runningBranchId = ErrorHandleTypeEnum.failBranch
      }
      else {
        if (data.node_type === BlockEnum.IfElse)
          currentNode.data._runningBranchId = data?.outputs?.selected_case_id

        if (data.node_type === BlockEnum.QuestionClassifier)
          currentNode.data._runningBranchId = data?.outputs?.class_id
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
          _targetRunningStatus: data.status,
        }
      })
    })
    setEdges(newEdges)
  }, [store, workflowStore])

  return {
    handleWorkflowNodeFinished,
  }
}

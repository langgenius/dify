import type { NodeRunningStatus } from '@/app/components/workflow/types'
import type { LoopFinishedResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useWorkflowStoreApi } from '@/app/components/workflow/hooks/use-workflow-reactflow'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useWorkflowNodeLoopFinished = () => {
  const store = useWorkflowStoreApi()
  const workflowStore = useWorkflowStore()

  const handleWorkflowNodeLoopFinished = useCallback((params: LoopFinishedResponse) => {
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
  }, [workflowStore, store])

  return {
    handleWorkflowNodeLoopFinished,
  }
}

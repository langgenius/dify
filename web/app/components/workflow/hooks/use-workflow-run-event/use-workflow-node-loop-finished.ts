import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import produce from 'immer'
import type { LoopFinishedResponse } from '@/types/workflow'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useWorkflowNodeLoopFinished = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()

  const handleWorkflowNodeLoopFinished = useCallback((params: LoopFinishedResponse) => {
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
    })
    setNodes(newNodes)
    const newEdges = produce(edges, (draft) => {
      const incomeEdges = draft.filter((edge) => {
        return edge.target === data.node_id
      })
      incomeEdges.forEach((edge) => {
        edge.data = {
          ...edge.data,
          _targetRunningStatus: data.status as any,
        }
      })
    })
    setEdges(newEdges)
  }, [workflowStore, store])

  return {
    handleWorkflowNodeLoopFinished,
  }
}

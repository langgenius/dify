import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import produce from 'immer'
import type { LoopNextResponse } from '@/types/workflow'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useWorkflowNodeLoopNext = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()

  const handleWorkflowNodeLoopNext = useCallback((params: LoopNextResponse) => {
    const {
      loopTimes,
      setLoopTimes,
    } = workflowStore.getState()

    const { data } = params
    const {
      getNodes,
      setNodes,
    } = store.getState()

    const nodes = getNodes()
    const newNodes = produce(nodes, (draft) => {
      const currentNode = draft.find(node => node.id === data.node_id)!
      currentNode.data._loopIndex = loopTimes
      setLoopTimes(loopTimes + 1)
    })
    setNodes(newNodes)
  }, [workflowStore, store])

  return {
    handleWorkflowNodeLoopNext,
  }
}

import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { produce } from 'immer'
import type { IterationNextResponse } from '@/types/workflow'
import { useWorkflowStore } from '@/app/components/workflow/store'

export const useWorkflowNodeIterationNext = () => {
  const store = useStoreApi()
  const workflowStore = useWorkflowStore()

  const handleWorkflowNodeIterationNext = useCallback((params: IterationNextResponse) => {
    const {
      iterTimes,
      setIterTimes,
    } = workflowStore.getState()

    const { data } = params
    const {
      getNodes,
      setNodes,
    } = store.getState()

    const nodes = getNodes()
    const newNodes = produce(nodes, (draft) => {
      const currentNode = draft.find(node => node.id === data.node_id)!
      currentNode.data._iterationIndex = iterTimes
      setIterTimes(iterTimes + 1)
    })
    setNodes(newNodes)
  }, [workflowStore, store])

  return {
    handleWorkflowNodeIterationNext,
  }
}

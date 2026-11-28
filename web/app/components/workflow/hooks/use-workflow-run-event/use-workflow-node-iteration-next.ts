import type { IterationNextResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useWorkflowStore } from '@/app/components/workflow/store'
import { useCollaborativeWorkflow } from '../use-collaborative-workflow'

export const useWorkflowNodeIterationNext = () => {
  const store = useStoreApi()
  const collaborativeWorkflow = useCollaborativeWorkflow()
  const workflowStore = useWorkflowStore()

  const handleWorkflowNodeIterationNext = useCallback(
    (params: IterationNextResponse) => {
      const { iterTimes, setIterTimes } = workflowStore.getState()

      const { data } = params
      const { getNodes } = store.getState()

      const nodes = getNodes()
      const newNodes = produce(nodes, (draft) => {
        const currentNode = draft.find((node) => node.id === data.node_id)!
        currentNode.data._iterationIndex = iterTimes
        setIterTimes(iterTimes + 1)
      })
      collaborativeWorkflow.setNodes(newNodes, false)
    },
    [collaborativeWorkflow, workflowStore, store],
  )

  return {
    handleWorkflowNodeIterationNext,
  }
}

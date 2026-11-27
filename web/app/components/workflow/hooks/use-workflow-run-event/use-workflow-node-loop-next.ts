import type { LoopNextResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { NodeRunningStatus } from '@/app/components/workflow/types'
import { useCollaborativeWorkflow } from '../use-collaborative-workflow'

export const useWorkflowNodeLoopNext = () => {
  const store = useStoreApi()
  const collaborativeWorkflow = useCollaborativeWorkflow()

  const handleWorkflowNodeLoopNext = useCallback(
    (params: LoopNextResponse) => {
      const { data } = params
      const { getNodes } = store.getState()

      const nodes = getNodes()
      const newNodes = produce(nodes, (draft) => {
        const currentNode = draft.find((node) => node.id === data.node_id)!
        currentNode.data._loopIndex = data.index

        draft.forEach((node) => {
          if (node.parentId === data.node_id) {
            node.data._waitingRun = true
            node.data._runningStatus = NodeRunningStatus.Waiting
          }
        })
      })
      collaborativeWorkflow.setNodes(newNodes, false)
    },
    [collaborativeWorkflow, store],
  )

  return {
    handleWorkflowNodeLoopNext,
  }
}

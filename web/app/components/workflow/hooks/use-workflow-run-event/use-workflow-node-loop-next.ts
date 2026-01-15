import type { LoopNextResponse } from '@/types/workflow'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { NodeRunningStatus } from '@/app/components/workflow/types'

export const useWorkflowNodeLoopNext = () => {
  const store = useStoreApi()

  const handleWorkflowNodeLoopNext = useCallback((params: LoopNextResponse) => {
    const { data } = params
    const {
      getNodes,
      setNodes,
    } = store.getState()

    const nodes = getNodes()
    const newNodes = produce(nodes, (draft) => {
      const currentNode = draft.find(node => node.id === data.node_id)!
      currentNode.data._loopIndex = data.index

      draft.forEach((node) => {
        if (node.parentId === data.node_id) {
          node.data._waitingRun = true
          node.data._runningStatus = NodeRunningStatus.Waiting
        }
      })
    })
    setNodes(newNodes)
  }, [store])

  return {
    handleWorkflowNodeLoopNext,
  }
}

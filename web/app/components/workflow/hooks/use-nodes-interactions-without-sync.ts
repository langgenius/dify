import { produce } from 'immer'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { NodeRunningStatus } from '../types'
import { useCollaborativeWorkflow } from './use-collaborative-workflow'

export const useNodesInteractionsWithoutSync = () => {
  const store = useStoreApi()
  const collaborativeWorkflow = useCollaborativeWorkflow()

  const handleNodeCancelRunningStatus = useCallback(() => {
    const { getNodes } = store.getState()

    const nodes = getNodes()
    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        node.data._runningStatus = undefined
        node.data._waitingRun = false
      })
    })
    collaborativeWorkflow.setNodes(newNodes, false)
  }, [collaborativeWorkflow, store])

  const handleCancelAllNodeSuccessStatus = useCallback(() => {
    const { getNodes } = store.getState()

    const nodes = getNodes()
    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        if (node.data._runningStatus === NodeRunningStatus.Succeeded)
          node.data._runningStatus = undefined
      })
    })
    collaborativeWorkflow.setNodes(newNodes, false)
  }, [collaborativeWorkflow, store])

  const handleCancelNodeSuccessStatus = useCallback(
    (nodeId: string) => {
      const { getNodes } = store.getState()

      const newNodes = produce(getNodes(), (draft) => {
        const node = draft.find((n) => n.id === nodeId)
        if (node && node.data._runningStatus === NodeRunningStatus.Succeeded) {
          node.data._runningStatus = undefined
          node.data._waitingRun = false
        }
      })
      collaborativeWorkflow.setNodes(newNodes, false)
    },
    [collaborativeWorkflow, store],
  )

  return {
    handleNodeCancelRunningStatus,
    handleCancelAllNodeSuccessStatus,
    handleCancelNodeSuccessStatus,
  }
}

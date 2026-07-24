import { produce } from 'immer'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { NodeRunningStatus } from '../types'

export const useNodesInteractionsWithoutSync = () => {
  const store = useStoreApi()

  const handleNodeCancelRunningStatus = useCallback(() => {
    const {
      getNodes,
      setNodes,
    } = store.getState()

    const nodes = getNodes()
    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        node.data._runningStatus = undefined
        node.data._waitingRun = false
      })
    })
    setNodes(newNodes)
  }, [store])

  const handleCancelAllNodeSuccessStatus = useCallback(() => {
    const {
      getNodes,
      setNodes,
    } = store.getState()

    const nodes = getNodes()
    const newNodes = produce(nodes, (draft) => {
      draft.forEach((node) => {
        if (node.data._runningStatus === NodeRunningStatus.Succeeded)
          node.data._runningStatus = undefined
      })
    })
    setNodes(newNodes)
  }, [store])

  const handleCancelNodeSuccessStatus = useCallback((nodeId: string) => {
    const {
      getNodes,
      setNodes,
    } = store.getState()

    const newNodes = produce(getNodes(), (draft) => {
      const node = draft.find(n => n.id === nodeId)
      if (node && node.data._runningStatus === NodeRunningStatus.Succeeded) {
        node.data._runningStatus = undefined
        node.data._waitingRun = false
      }
    })
    setNodes(newNodes)
  }, [store])

  return {
    handleNodeCancelRunningStatus,
    handleCancelAllNodeSuccessStatus,
    handleCancelNodeSuccessStatus,
  }
}

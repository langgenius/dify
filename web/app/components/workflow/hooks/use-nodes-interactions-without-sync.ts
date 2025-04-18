import { useCallback } from 'react'
import produce from 'immer'
import { useStoreApi } from 'reactflow'

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

  return {
    handleNodeCancelRunningStatus,
  }
}

import { produce } from 'immer'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useCollaborativeWorkflow } from './use-collaborative-workflow'

export const useEdgesInteractionsWithoutSync = () => {
  const store = useStoreApi()
  const collaborativeWorkflow = useCollaborativeWorkflow()

  const handleEdgeCancelRunningStatus = useCallback(() => {
    const { edges } = store.getState()

    const newEdges = produce(edges, (draft) => {
      draft.forEach((edge) => {
        edge.data._sourceRunningStatus = undefined
        edge.data._targetRunningStatus = undefined
        edge.data._waitingRun = false
      })
    })
    collaborativeWorkflow.setEdges(newEdges, false)
  }, [collaborativeWorkflow, store])

  return {
    handleEdgeCancelRunningStatus,
  }
}

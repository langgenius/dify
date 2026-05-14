import { produce } from 'immer'
import { useCallback } from 'react'
import { useWorkflowStoreApi } from '@/app/components/workflow/hooks/use-workflow-reactflow'

export const useEdgesInteractionsWithoutSync = () => {
  const store = useWorkflowStoreApi()

  const handleEdgeCancelRunningStatus = useCallback(() => {
    const {
      edges,
      setEdges,
    } = store.getState()

    const newEdges = produce(edges, (draft) => {
      draft.forEach((edge) => {
        edge.data._sourceRunningStatus = undefined
        edge.data._targetRunningStatus = undefined
        edge.data._waitingRun = false
      })
    })
    setEdges(newEdges)
  }, [store])

  return {
    handleEdgeCancelRunningStatus,
  }
}

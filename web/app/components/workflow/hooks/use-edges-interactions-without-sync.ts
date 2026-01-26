import type { RefObject } from 'react'
import { produce } from 'immer'
import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'

export const useEdgesInteractionsWithoutSync = (isMountedRef?: RefObject<boolean>) => {
  const store = useStoreApi()

  const handleEdgeCancelRunningStatus = useCallback(() => {
    if (isMountedRef && isMountedRef.current === false)
      return

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
  }, [store, isMountedRef])

  return {
    handleEdgeCancelRunningStatus,
  }
}

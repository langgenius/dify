import {
  useCallback,
  useState,
} from 'react'
import { useBoolean } from 'ahooks'
import type { IterationDurationMap, NodeTracing } from '@/types/workflow'

export const useLogs = () => {
  const [showRetryDetail, {
    setTrue: setShowRetryDetailTrue,
    setFalse: setShowRetryDetailFalse,
  }] = useBoolean(false)
  const [retryResultList, setRetryResultList] = useState<NodeTracing[]>([])
  const handleShowRetryResultList = useCallback((detail: NodeTracing[]) => {
    setShowRetryDetailTrue()
    setRetryResultList(detail)
  }, [setShowRetryDetailTrue, setRetryResultList])

  const [showIteratingDetail, {
    setTrue: setShowIteratingDetailTrue,
    setFalse: setShowIteratingDetailFalse,
  }] = useBoolean(false)
  const [iterationResultList, setIterationResultList] = useState<NodeTracing[][]>([])
  const [iterationResultDurationMap, setIterationResultDurationMap] = useState<IterationDurationMap>({})
  const handleShowIterationResultList = useCallback((detail: NodeTracing[][], iterDurationMap: IterationDurationMap) => {
    setShowIteratingDetailTrue()
    setIterationResultList(detail)
    setIterationResultDurationMap(iterDurationMap)
  }, [setShowIteratingDetailTrue, setIterationResultList, setIterationResultDurationMap])

  const [showAgentDetail, {
    setTrue: setShowAgentDetailTrue,
    setFalse: setShowAgentDetailFalse,
  }] = useBoolean(false)

  return {
    showSpecialResultPanel: showRetryDetail || showIteratingDetail,
    showRetryDetail,
    setShowRetryDetailTrue,
    setShowRetryDetailFalse,
    retryResultList,
    setRetryResultList,
    handleShowRetryResultList,

    showIteratingDetail,
    setShowIteratingDetailTrue,
    setShowIteratingDetailFalse,
    iterationResultList,
    setIterationResultList,
    iterationResultDurationMap,
    setIterationResultDurationMap,
    handleShowIterationResultList,

    showAgentDetail,
    setShowAgentDetailTrue,
    setShowAgentDetailFalse,
  }
}

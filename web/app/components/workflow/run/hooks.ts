import {
  useCallback,
  useRef,
  useState,
} from 'react'
import { useBoolean } from 'ahooks'
import type {
  AgentLogItemWithChildren,
  IterationDurationMap,
  NodeTracing,
} from '@/types/workflow'

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

  const [agentOrToolLogIdStack, setAgentOrToolLogIdStack] = useState<string[]>([])
  const agentOrToolLogIdStackRef = useRef(agentOrToolLogIdStack)
  const [agentOrToolLogListMap, setAgentOrToolLogListMap] = useState<Record<string, AgentLogItemWithChildren[]>>({})
  const agentOrToolLogListMapRef = useRef(agentOrToolLogListMap)
  const handleShowAgentOrToolLog = useCallback((detail: AgentLogItemWithChildren) => {
    const { id, children } = detail
    let currentAgentOrToolLogIdStack = agentOrToolLogIdStackRef.current.slice()
    const index = currentAgentOrToolLogIdStack.findIndex(logId => logId === id)

    if (index > -1)
      currentAgentOrToolLogIdStack = currentAgentOrToolLogIdStack.slice(0, index + 1)
    else
      currentAgentOrToolLogIdStack = [...currentAgentOrToolLogIdStack.slice(), id]

    setAgentOrToolLogIdStack(currentAgentOrToolLogIdStack)
    agentOrToolLogIdStackRef.current = currentAgentOrToolLogIdStack

    if (children) {
      setAgentOrToolLogListMap({
        ...agentOrToolLogListMapRef.current,
        [id]: children,
      })
    }
  }, [setAgentOrToolLogIdStack, setAgentOrToolLogListMap])

  return {
    showSpecialResultPanel: showRetryDetail || showIteratingDetail || !!agentOrToolLogIdStack.length,
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

    agentOrToolLogIdStack,
    agentOrToolLogListMap,
    handleShowAgentOrToolLog,
  }
}

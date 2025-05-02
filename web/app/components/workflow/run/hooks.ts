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

  const [agentOrToolLogItemStack, setAgentOrToolLogItemStack] = useState<AgentLogItemWithChildren[]>([])
  const agentOrToolLogItemStackRef = useRef(agentOrToolLogItemStack)
  const [agentOrToolLogListMap, setAgentOrToolLogListMap] = useState<Record<string, AgentLogItemWithChildren[]>>({})
  const agentOrToolLogListMapRef = useRef(agentOrToolLogListMap)
  const handleShowAgentOrToolLog = useCallback((detail?: AgentLogItemWithChildren) => {
    if (!detail) {
      setAgentOrToolLogItemStack([])
      agentOrToolLogItemStackRef.current = []
      return
    }
    const { id, children } = detail
    let currentAgentOrToolLogItemStack = agentOrToolLogItemStackRef.current.slice()
    const index = currentAgentOrToolLogItemStack.findIndex(logItem => logItem.id === id)

    if (index > -1)
      currentAgentOrToolLogItemStack = currentAgentOrToolLogItemStack.slice(0, index + 1)
    else
      currentAgentOrToolLogItemStack = [...currentAgentOrToolLogItemStack.slice(), detail]

    setAgentOrToolLogItemStack(currentAgentOrToolLogItemStack)
    agentOrToolLogItemStackRef.current = currentAgentOrToolLogItemStack

    if (children) {
      setAgentOrToolLogListMap({
        ...agentOrToolLogListMapRef.current,
        [id]: children,
      })
    }
  }, [setAgentOrToolLogItemStack, setAgentOrToolLogListMap])

  return {
    showSpecialResultPanel: showRetryDetail || showIteratingDetail || !!agentOrToolLogItemStack.length,
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

    agentOrToolLogItemStack,
    agentOrToolLogListMap,
    handleShowAgentOrToolLog,
  }
}

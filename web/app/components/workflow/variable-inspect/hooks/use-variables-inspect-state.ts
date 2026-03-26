import type { CurrentVarInInspect } from '../types'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { VarInInspectType } from '@/types/workflow'
import useCurrentVars from '../../hooks/use-inspect-vars-crud'
import useMatchSchemaType from '../../nodes/_base/components/variable/use-match-schema-type'
import { useStore } from '../../store'
import { EVENT_WORKFLOW_STOP } from '../types'
import { toEnvVarInInspect } from '../utils'

export type VariablesInspectStatus = 'listening' | 'empty' | 'split'

export type VariablesInspectView = {
  currentFocusNodeId: string | null
  currentNodeVar?: CurrentVarInInspect
  isValueFetching: boolean
  onSelectVar: (node: CurrentVarInInspect) => void
  onStopListening: () => void
  status: VariablesInspectStatus
}

export const useVariablesInspectView = (): VariablesInspectView => {
  const isListening = useStore(s => s.isListening)
  const environmentVariables = useStore(s => s.environmentVariables)
  const currentFocusNodeId = useStore(s => s.currentFocusNodeId)
  const setCurrentFocusNodeId = useStore(s => s.setCurrentFocusNodeId)
  const [currentVarId, setCurrentVarId] = useState('')

  const {
    conversationVars,
    systemVars,
    nodesWithInspectVars,
    fetchInspectVarValue,
  } = useCurrentVars()

  const isEmpty = useMemo(() => {
    return [...environmentVariables, ...conversationVars, ...systemVars, ...nodesWithInspectVars].length === 0
  }, [environmentVariables, conversationVars, systemVars, nodesWithInspectVars])

  const currentNodeVar = useMemo(() => {
    if (!currentFocusNodeId)
      return undefined

    if (currentFocusNodeId === VarInInspectType.environment) {
      const currentVar = environmentVariables.find(v => v.id === currentVarId)
      return {
        nodeId: VarInInspectType.environment,
        title: VarInInspectType.environment,
        nodeType: VarInInspectType.environment,
        var: currentVar ? toEnvVarInInspect(currentVar) : undefined,
      }
    }

    if (currentFocusNodeId === VarInInspectType.conversation) {
      const currentVar = conversationVars.find(v => v.id === currentVarId)
      return {
        nodeId: VarInInspectType.conversation,
        title: VarInInspectType.conversation,
        nodeType: VarInInspectType.conversation,
        var: currentVar
          ? {
              ...currentVar,
              type: VarInInspectType.conversation,
            }
          : undefined,
      }
    }

    if (currentFocusNodeId === VarInInspectType.system) {
      const currentVar = systemVars.find(v => v.id === currentVarId)
      return {
        nodeId: VarInInspectType.system,
        title: VarInInspectType.system,
        nodeType: VarInInspectType.system,
        var: currentVar
          ? {
              ...currentVar,
              type: VarInInspectType.system,
            }
          : undefined,
      }
    }

    const targetNode = nodesWithInspectVars.find(node => node.nodeId === currentFocusNodeId)
    if (!targetNode)
      return undefined

    const currentVar = targetNode.vars.find(v => v.id === currentVarId)
    return {
      nodeId: targetNode.nodeId,
      nodeType: targetNode.nodeType,
      title: targetNode.title,
      isValueFetched: targetNode.isValueFetched,
      nodeData: targetNode.nodePayload,
      var: currentVar,
    }
  }, [conversationVars, currentFocusNodeId, currentVarId, environmentVariables, nodesWithInspectVars, systemVars])

  const currentAliasMeta = useMemo(() => {
    if (!currentFocusNodeId || !currentVarId)
      return undefined

    const targetNode = nodesWithInspectVars.find(node => node.nodeId === currentFocusNodeId)
    const targetVar = targetNode?.vars.find(v => v.id === currentVarId)
    return targetVar?.aliasMeta
  }, [currentFocusNodeId, currentVarId, nodesWithInspectVars])

  const fetchNodeId = currentAliasMeta?.extractorNodeId || currentFocusNodeId

  const isValueFetching = useMemo(() => {
    if (!fetchNodeId)
      return false

    const targetNode = nodesWithInspectVars.find(node => node.nodeId === fetchNodeId)
    return targetNode ? !targetNode.isValueFetched : false
  }, [fetchNodeId, nodesWithInspectVars])

  const onSelectVar = useCallback((node: CurrentVarInInspect) => {
    setCurrentFocusNodeId(node.nodeId)
    if (node.var)
      setCurrentVarId(node.var.id)
  }, [setCurrentFocusNodeId])

  const { isLoading, schemaTypeDefinitions } = useMatchSchemaType()
  const { eventEmitter } = useEventEmitterContextContext()

  const onStopListening = useCallback(() => {
    eventEmitter?.emit({ type: EVENT_WORKFLOW_STOP })
  }, [eventEmitter])

  useEffect(() => {
    if (!currentFocusNodeId || !currentVarId || isLoading || !fetchNodeId)
      return

    const targetNode = nodesWithInspectVars.find(node => node.nodeId === fetchNodeId)
    if (targetNode && !targetNode.isValueFetched)
      fetchInspectVarValue([fetchNodeId], schemaTypeDefinitions!)
  }, [currentFocusNodeId, currentVarId, fetchInspectVarValue, fetchNodeId, isLoading, nodesWithInspectVars, schemaTypeDefinitions])

  if (isListening) {
    return {
      currentFocusNodeId,
      currentNodeVar,
      isValueFetching,
      onSelectVar,
      onStopListening,
      status: 'listening',
    }
  }

  if (isEmpty) {
    return {
      currentFocusNodeId,
      currentNodeVar,
      isValueFetching,
      onSelectVar,
      onStopListening,
      status: 'empty',
    }
  }

  return {
    currentFocusNodeId,
    currentNodeVar,
    isValueFetching,
    onSelectVar,
    onStopListening,
    status: 'split',
  }
}

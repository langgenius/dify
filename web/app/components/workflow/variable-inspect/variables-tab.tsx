import type { FC } from 'react'
import type { NodeProps } from '../types'
import type { VarInInspect } from '@/types/workflow'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { VarInInspectType } from '@/types/workflow'
import { cn } from '@/utils/classnames'
import useCurrentVars from '../hooks/use-inspect-vars-crud'
import useMatchSchemaType from '../nodes/_base/components/variable/use-match-schema-type'
import { useStore } from '../store'
import Empty from './empty'
import Left from './left'
import Listening from './listening'
import Right from './right'
import { EVENT_WORKFLOW_STOP } from './types'
import { toEnvVarInInspect } from './utils'

export type currentVarType = {
  nodeId: string
  nodeType: string
  title: string
  isValueFetched?: boolean
  var?: VarInInspect
  nodeData?: NodeProps['data']
}

const VariablesTab: FC = () => {
  const bottomPanelWidth = useStore(s => s.bottomPanelWidth)
  const [showLeftPanel, setShowLeftPanel] = useState(true)
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
    const allVars = [...environmentVariables, ...conversationVars, ...systemVars, ...nodesWithInspectVars]
    return allVars.length === 0
  }, [environmentVariables, conversationVars, systemVars, nodesWithInspectVars])

  const currentNodeInfo = useMemo(() => {
    if (!currentFocusNodeId)
      return
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
      return
    const currentVar = targetNode.vars.find(v => v.id === currentVarId)
    return {
      nodeId: targetNode.nodeId,
      nodeType: targetNode.nodeType,
      title: targetNode.title,
      isSingRunRunning: targetNode.isSingRunRunning,
      isValueFetched: targetNode.isValueFetched,
      nodeData: targetNode.nodePayload,
      var: currentVar,
    }
  }, [currentFocusNodeId, currentVarId, environmentVariables, conversationVars, systemVars, nodesWithInspectVars])

  const currentAliasMeta = useMemo(() => {
    if (!currentFocusNodeId || !currentVarId)
      return undefined
    const targetNode = nodesWithInspectVars.find(node => node.nodeId === currentFocusNodeId)
    const targetVar = targetNode?.vars.find(v => v.id === currentVarId)
    return targetVar?.aliasMeta
  }, [currentFocusNodeId, currentVarId, nodesWithInspectVars])
  const fetchNodeId = currentAliasMeta?.extractorNodeId || currentFocusNodeId

  const isCurrentNodeVarValueFetching = useMemo(() => {
    if (!fetchNodeId)
      return false
    const targetNode = nodesWithInspectVars.find(node => node.nodeId === fetchNodeId)
    if (!targetNode)
      return false
    return !targetNode.isValueFetched
  }, [fetchNodeId, nodesWithInspectVars])

  const handleNodeVarSelect = useCallback((node: currentVarType) => {
    setCurrentFocusNodeId(node.nodeId)
    if (node.var)
      setCurrentVarId(node.var.id)
  }, [setCurrentFocusNodeId, setCurrentVarId])

  const { isLoading, schemaTypeDefinitions } = useMatchSchemaType()
  const { eventEmitter } = useEventEmitterContextContext()

  const handleStopListening = useCallback(() => {
    // eslint-disable-next-line ts/no-explicit-any -- EventEmitter is typed as string but project-wide convention passes { type } objects
    eventEmitter?.emit({ type: EVENT_WORKFLOW_STOP } as any)
  }, [eventEmitter])

  useEffect(() => {
    if (currentFocusNodeId && currentVarId && !isLoading && fetchNodeId) {
      const targetNode = nodesWithInspectVars.find(node => node.nodeId === fetchNodeId)
      if (targetNode && !targetNode.isValueFetched)
        fetchInspectVarValue([fetchNodeId], schemaTypeDefinitions!)
    }
  }, [currentFocusNodeId, currentVarId, nodesWithInspectVars, fetchInspectVarValue, schemaTypeDefinitions, isLoading, fetchNodeId])

  if (isListening) {
    return (
      <div className="grow p-2">
        <Listening onStop={handleStopListening} />
      </div>
    )
  }

  if (isEmpty) {
    return (
      <div className="h-full p-2">
        <Empty />
      </div>
    )
  }

  return (
    <div className={cn('relative flex h-full')}>
      {bottomPanelWidth < 488 && showLeftPanel && <div role="presentation" className="absolute left-0 top-0 h-full w-full" onClick={() => setShowLeftPanel(false)}></div>}
      <div
        className={cn(
          'w-60 shrink-0 border-r border-divider-burn',
          bottomPanelWidth < 488
            ? showLeftPanel
              ? 'absolute left-0 top-0 z-10 h-full w-[217px] rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg backdrop-blur-sm'
              : 'hidden'
            : 'block',
        )}
      >
        <Left
          currentNodeVar={currentNodeInfo as currentVarType}
          handleVarSelect={handleNodeVarSelect}
        />
      </div>
      <div className="w-0 grow">
        <Right
          nodeId={currentFocusNodeId!}
          isValueFetching={isCurrentNodeVarValueFetching}
          currentNodeVar={currentNodeInfo as currentVarType}
          handleOpenMenu={() => setShowLeftPanel(true)}
        />
      </div>
    </div>
  )
}

export default VariablesTab

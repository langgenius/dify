import type { FC } from 'react'
import type { RerunVariableMeta } from '../store/workflow/panel-slice'
import type { EnvironmentVariable, NodeProps } from '../types'
import type { VarInInspect } from '@/types/workflow'
import {
  RiCloseLine,
} from '@remixicon/react'
import { isEqual } from 'es-toolkit/predicate'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { EVENT_WORKFLOW_STOP } from '@/app/components/workflow/variable-inspect/types'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { VarInInspectType } from '@/types/workflow'
import { cn } from '@/utils/classnames'
import useCurrentVars from '../hooks/use-inspect-vars-crud'
import useMatchSchemaType from '../nodes/_base/components/variable/use-match-schema-type'
import { useStore } from '../store'
import { VarType } from '../types'
import Empty from './empty'
import Left from './left'
import Listening from './listening'
import { RERUN_MASK_PLACEHOLDER } from './rerun-adapter'
import Right from './right'

export type currentVarType = {
  nodeId: string
  nodeType: string
  title: string
  isValueFetched?: boolean
  var: VarInInspect
  nodeData: NodeProps['data']
  rerunMeta?: RerunVariableMeta
  rerunOriginalValue?: unknown
}

export type selectedVarState = Pick<currentVarType, 'nodeId' | 'var'>
  & Partial<Pick<currentVarType, 'nodeType' | 'title' | 'nodeData'>>

const normalizeEnvVar = (varItem: VarInInspect | EnvironmentVariable): VarInInspect => {
  if ('selector' in varItem)
    return varItem as VarInInspect

  return {
    id: varItem.id,
    type: VarInInspectType.environment,
    name: varItem.name,
    description: varItem.description || '',
    selector: [VarInInspectType.environment, varItem.name],
    value_type: varItem.value_type as VarInInspect['value_type'],
    value: varItem.value,
    edited: false,
    visible: true,
    is_truncated: false,
    full_content: {
      size_bytes: 0,
      download_url: '',
    },
  }
}

const Panel: FC = () => {
  const { t } = useTranslation()

  const bottomPanelWidth = useStore(s => s.bottomPanelWidth)
  const setShowVariableInspectPanel = useStore(s => s.setShowVariableInspectPanel)
  const variableInspectMode = useStore(s => s.variableInspectMode)
  const setVariableInspectMode = useStore(s => s.setVariableInspectMode)
  const rerunContext = useStore(s => s.rerunContext)
  const clearRerunContext = useStore(s => s.clearRerunContext)
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

  const isRerunEditMode = variableInspectMode === 'rerun-edit'
  const envVars = useMemo(() => (isRerunEditMode ? (rerunContext?.envVars || []) : environmentVariables), [isRerunEditMode, rerunContext?.envVars, environmentVariables])
  const nodeVarGroups = useMemo(() => (isRerunEditMode ? (rerunContext?.nodeGroups || []) : nodesWithInspectVars), [isRerunEditMode, rerunContext?.nodeGroups, nodesWithInspectVars])
  const conversationVarList = useMemo(() => (isRerunEditMode ? [] : conversationVars), [isRerunEditMode, conversationVars])
  const systemVarList = useMemo(() => (isRerunEditMode ? [] : systemVars), [isRerunEditMode, systemVars])

  const resolvedFocusNodeId = useMemo(() => {
    if (currentFocusNodeId)
      return currentFocusNodeId
    if (nodeVarGroups.length > 0)
      return nodeVarGroups[0].nodeId
    if (envVars.length > 0)
      return VarInInspectType.environment
    if (conversationVarList.length > 0)
      return VarInInspectType.conversation
    if (systemVarList.length > 0)
      return VarInInspectType.system
    return ''
  }, [currentFocusNodeId, nodeVarGroups, envVars, conversationVarList, systemVarList])

  const resolvedVarId = useMemo(() => {
    if (!resolvedFocusNodeId)
      return ''

    let candidateVarList: VarInInspect[] = []
    if (resolvedFocusNodeId === VarInInspectType.environment)
      candidateVarList = envVars.map(item => normalizeEnvVar(item))
    else if (resolvedFocusNodeId === VarInInspectType.conversation)
      candidateVarList = conversationVarList
    else if (resolvedFocusNodeId === VarInInspectType.system)
      candidateVarList = systemVarList
    else
      candidateVarList = nodeVarGroups.find(node => node.nodeId === resolvedFocusNodeId)?.vars || []

    if (currentVarId && candidateVarList.some(item => item.id === currentVarId))
      return currentVarId
    return candidateVarList[0]?.id || ''
  }, [resolvedFocusNodeId, envVars, conversationVarList, systemVarList, nodeVarGroups, currentVarId])

  const isEmpty = useMemo(() => {
    const allVars = [...envVars, ...conversationVarList, ...systemVarList, ...nodeVarGroups]
    return allVars.length === 0
  }, [envVars, conversationVarList, systemVarList, nodeVarGroups])

  const toRerunDisplayVar = useCallback((varItem: VarInInspect) => {
    if (!isRerunEditMode || !rerunContext)
      return varItem

    const meta = rerunContext.metaByVarId[varItem.id]
    const currentValue = rerunContext.currentValueByVarId[varItem.id]
    const originalValue = rerunContext.originalValueByVarId[varItem.id]
    const edited = !isEqual(currentValue, originalValue)
    const shouldShowMasked = !!meta?.masked && !edited
    return {
      ...varItem,
      value: shouldShowMasked ? RERUN_MASK_PLACEHOLDER : currentValue,
      edited,
      value_type: shouldShowMasked ? VarType.secret : varItem.value_type,
    }
  }, [isRerunEditMode, rerunContext])

  const currentNodeInfo = useMemo(() => {
    if (!resolvedFocusNodeId)
      return
    if (resolvedFocusNodeId === VarInInspectType.environment) {
      const currentVar = envVars.find(v => v.id === resolvedVarId)
      const res = {
        nodeId: VarInInspectType.environment,
        title: VarInInspectType.environment,
        nodeType: VarInInspectType.environment,
      }
      if (currentVar) {
        const normalizedEnvVar = normalizeEnvVar(currentVar)
        const rerunVar = toRerunDisplayVar({
          ...normalizedEnvVar,
          ...(!isRerunEditMode && normalizedEnvVar.value_type === 'secret' ? { value: RERUN_MASK_PLACEHOLDER } : {}),
        })
        return {
          ...res,
          var: rerunVar,
          rerunMeta: rerunContext?.metaByVarId[rerunVar.id],
          rerunOriginalValue: rerunContext?.originalValueByVarId[rerunVar.id],
        }
      }
      return res
    }
    if (resolvedFocusNodeId === VarInInspectType.conversation) {
      const currentVar = conversationVarList.find(v => v.id === resolvedVarId)
      const res = {
        nodeId: VarInInspectType.conversation,
        title: VarInInspectType.conversation,
        nodeType: VarInInspectType.conversation,
      }
      if (currentVar) {
        return {
          ...res,
          var: {
            ...currentVar,
            type: VarInInspectType.conversation,
          },
        }
      }
      return res
    }
    if (resolvedFocusNodeId === VarInInspectType.system) {
      const currentVar = systemVarList.find(v => v.id === resolvedVarId)
      const res = {
        nodeId: VarInInspectType.system,
        title: VarInInspectType.system,
        nodeType: VarInInspectType.system,
      }
      if (currentVar) {
        return {
          ...res,
          var: {
            ...currentVar,
            type: VarInInspectType.system,
          },
        }
      }
      return res
    }
    const targetNode = nodeVarGroups.find(node => node.nodeId === resolvedFocusNodeId)
    if (!targetNode)
      return
    const currentVar = targetNode.vars.find(v => v.id === resolvedVarId)
    return {
      nodeId: targetNode.nodeId,
      nodeType: targetNode.nodeType,
      title: targetNode.title,
      isSingRunRunning: targetNode.isSingRunRunning,
      isValueFetched: targetNode.isValueFetched,
      nodeData: targetNode.nodePayload,
      ...(currentVar
        ? {
            var: toRerunDisplayVar(currentVar),
            rerunMeta: rerunContext?.metaByVarId[currentVar.id],
            rerunOriginalValue: rerunContext?.originalValueByVarId[currentVar.id],
          }
        : {}),
    }
  }, [
    resolvedFocusNodeId,
    resolvedVarId,
    envVars,
    conversationVarList,
    systemVarList,
    nodeVarGroups,
    isRerunEditMode,
    rerunContext,
    toRerunDisplayVar,
  ])

  const isCurrentNodeVarValueFetching = useMemo(() => {
    if (isRerunEditMode)
      return !!rerunContext?.loading
    if (!currentNodeInfo)
      return false
    const targetNode = nodeVarGroups.find(node => node.nodeId === currentNodeInfo.nodeId)
    if (!targetNode)
      return false
    return !targetNode.isValueFetched
  }, [isRerunEditMode, rerunContext?.loading, currentNodeInfo, nodeVarGroups])

  const handleNodeVarSelect = useCallback((node: selectedVarState) => {
    setCurrentFocusNodeId(node.nodeId)
    setCurrentVarId(node.var.id)
  }, [setCurrentFocusNodeId, setCurrentVarId])

  const { isLoading, schemaTypeDefinitions } = useMatchSchemaType()
  const { eventEmitter } = useEventEmitterContextContext()

  const handleStopListening = useCallback(() => {
    eventEmitter?.emit({ type: EVENT_WORKFLOW_STOP } as any)
  }, [eventEmitter])

  const handleClose = useCallback(() => {
    setShowVariableInspectPanel(false)
    setCurrentFocusNodeId('')
    setCurrentVarId('')
    if (isRerunEditMode) {
      setVariableInspectMode('cache')
      clearRerunContext()
    }
  }, [setShowVariableInspectPanel, setCurrentFocusNodeId, setCurrentVarId, isRerunEditMode, setVariableInspectMode, clearRerunContext])

  useEffect(() => {
    if (!isRerunEditMode && resolvedFocusNodeId && resolvedVarId && !isLoading) {
      const targetNode = nodeVarGroups.find(node => node.nodeId === resolvedFocusNodeId)
      if (targetNode && !targetNode.isValueFetched)
        fetchInspectVarValue([resolvedFocusNodeId], schemaTypeDefinitions!)
    }
  }, [
    isRerunEditMode,
    resolvedFocusNodeId,
    resolvedVarId,
    nodeVarGroups,
    isLoading,
    fetchInspectVarValue,
    schemaTypeDefinitions,
  ])

  if (isListening) {
    return (
      <div className={cn('flex h-full flex-col')}>
        <div className="flex shrink-0 items-center justify-between pl-4 pr-2 pt-2">
          <div className="text-text-primary system-sm-semibold-uppercase">{t('debug.variableInspect.title', { ns: 'workflow' })}</div>
          <ActionButton onClick={handleClose}>
            <RiCloseLine className="h-4 w-4" />
          </ActionButton>
        </div>
        <div className="grow p-2">
          <Listening
            onStop={handleStopListening}
          />
        </div>
      </div>
    )
  }

  if (isEmpty && !isRerunEditMode) {
    return (
      <div className={cn('flex h-full flex-col')}>
        <div className="flex shrink-0 items-center justify-between pl-4 pr-2 pt-2">
          <div className="text-text-primary system-sm-semibold-uppercase">{t('debug.variableInspect.title', { ns: 'workflow' })}</div>
          <ActionButton onClick={handleClose}>
            <RiCloseLine className="h-4 w-4" />
          </ActionButton>
        </div>
        <div className="grow p-2">
          <Empty />
        </div>
      </div>
    )
  }

  return (
    <div className={cn('relative flex h-full')}>
      {/* left */}
      {bottomPanelWidth < 488 && showLeftPanel && <div className="absolute left-0 top-0 h-full w-full" onClick={() => setShowLeftPanel(false)}></div>}
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
      {/* right */}
      <div className="w-0 grow">
        <Right
          nodeId={resolvedFocusNodeId}
          isValueFetching={isCurrentNodeVarValueFetching}
          currentNodeVar={currentNodeInfo as currentVarType}
          handleOpenMenu={() => setShowLeftPanel(true)}
        />
      </div>
    </div>
  )
}

export default Panel

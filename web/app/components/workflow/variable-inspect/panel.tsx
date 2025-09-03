import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiCloseLine,
} from '@remixicon/react'
import { useStore } from '../store'
import useCurrentVars from '../hooks/use-inspect-vars-crud'
import Empty from './empty'
import Left from './left'
import Right from './right'
import ActionButton from '@/app/components/base/action-button'
import type { VarInInspect } from '@/types/workflow'
import { VarInInspectType } from '@/types/workflow'

import cn from '@/utils/classnames'
import type { NodeProps } from '../types'
import useMatchSchemaType from '../nodes/_base/components/variable/use-match-schema-type'

export type currentVarType = {
  nodeId: string
  nodeType: string
  title: string
  isValueFetched?: boolean
  var: VarInInspect
  nodeData: NodeProps['data']
}

const Panel: FC = () => {
  const { t } = useTranslation()

  const bottomPanelWidth = useStore(s => s.bottomPanelWidth)
  const setShowVariableInspectPanel = useStore(s => s.setShowVariableInspectPanel)
  const [showLeftPanel, setShowLeftPanel] = useState(true)

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
    if (!currentFocusNodeId) return
    if (currentFocusNodeId === VarInInspectType.environment) {
      const currentVar = environmentVariables.find(v => v.id === currentVarId)
      const res = {
        nodeId: VarInInspectType.environment,
        title: VarInInspectType.environment,
        nodeType: VarInInspectType.environment,
      }
      if (currentVar) {
        return {
          ...res,
          var: {
            ...currentVar,
            type: VarInInspectType.environment,
            visible: true,
            ...(currentVar.value_type === 'secret' ? { value: '******************' } : {}),
          },
        }
      }
      return res
    }
    if (currentFocusNodeId === VarInInspectType.conversation) {
      const currentVar = conversationVars.find(v => v.id === currentVarId)
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
    if (currentFocusNodeId === VarInInspectType.system) {
      const currentVar = systemVars.find(v => v.id === currentVarId)
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
    const targetNode = nodesWithInspectVars.find(node => node.nodeId === currentFocusNodeId)
    if (!targetNode) return
    const currentVar = targetNode.vars.find(v => v.id === currentVarId)
    return {
      nodeId: targetNode.nodeId,
      nodeType: targetNode.nodeType,
      title: targetNode.title,
      isSingRunRunning: targetNode.isSingRunRunning,
      isValueFetched: targetNode.isValueFetched,
      nodeData: targetNode.nodePayload,
      ...(currentVar ? { var: currentVar } : {}),
    }
  }, [currentFocusNodeId, currentVarId, environmentVariables, conversationVars, systemVars, nodesWithInspectVars])

  const isCurrentNodeVarValueFetching = useMemo(() => {
    if (!currentNodeInfo) return false
    const targetNode = nodesWithInspectVars.find(node => node.nodeId === currentNodeInfo.nodeId)
    if (!targetNode) return false
    return !targetNode.isValueFetched
  }, [currentNodeInfo, nodesWithInspectVars])

  const handleNodeVarSelect = useCallback((node: currentVarType) => {
    setCurrentFocusNodeId(node.nodeId)
    setCurrentVarId(node.var.id)
  }, [setCurrentFocusNodeId, setCurrentVarId])

  const { isLoading, schemaTypeDefinitions } = useMatchSchemaType()

  useEffect(() => {
    if (currentFocusNodeId && currentVarId && !isLoading) {
      const targetNode = nodesWithInspectVars.find(node => node.nodeId === currentFocusNodeId)
      if (targetNode && !targetNode.isValueFetched)
        fetchInspectVarValue([currentFocusNodeId], schemaTypeDefinitions!)
    }
  }, [currentFocusNodeId, currentVarId, nodesWithInspectVars, fetchInspectVarValue, schemaTypeDefinitions, isLoading])

  if (isEmpty) {
    return (
      <div className={cn('flex h-full flex-col')}>
        <div className='flex shrink-0 items-center justify-between pl-4 pr-2 pt-2'>
          <div className='system-sm-semibold-uppercase text-text-primary'>{t('workflow.debug.variableInspect.title')}</div>
          <ActionButton onClick={() => setShowVariableInspectPanel(false)}>
            <RiCloseLine className='h-4 w-4' />
          </ActionButton>
        </div>
        <div className='grow p-2'>
          <Empty />
        </div>
      </div>
    )
  }

  return (
    <div className={cn('relative flex h-full')}>
      {/* left */}
      {bottomPanelWidth < 488 && showLeftPanel && <div className='absolute left-0 top-0 h-full w-full' onClick={() => setShowLeftPanel(false)}></div>}
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
      <div className='w-0 grow'>
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

export default Panel

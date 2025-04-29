import type { FC } from 'react'
import { useCallback, useMemo, useState } from 'react'
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
import cn from '@/utils/classnames'

export type currentVarType = {
  nodeId: string
  nodeType: string
  title: string
  isValueFetched?: boolean
  var: VarInInspect
}

const Panel: FC = () => {
  const { t } = useTranslation()

  const bottomPanelWidth = useStore(s => s.bottomPanelWidth)
  const setShowVariableInspectPanel = useStore(s => s.setShowVariableInspectPanel)
  const [showLeftPanel, setShowLeftPanel] = useState(true)
  const [currentNodeVar, setCurrentNodeVar] = useState<currentVarType>()

  const environmentVariables = useStore(s => s.environmentVariables)
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

  const isCurrentNodeVarValueFetching = useMemo(() => {
    if (!currentNodeVar) return false
    const targetNode = nodesWithInspectVars.find(node => node.nodeId === currentNodeVar.nodeId)
    if (!targetNode) return false
    return !targetNode.isValueFetched
  }, [currentNodeVar, nodesWithInspectVars])

  const handleNodeVarSelect = useCallback((node: currentVarType) => {
    setCurrentNodeVar(node)
    const targetNode = nodesWithInspectVars.find(n => n.nodeId === node.nodeId)
    if (targetNode && !targetNode.isValueFetched)
      fetchInspectVarValue([node.nodeId])
  }, [fetchInspectVarValue, nodesWithInspectVars])

  if (isEmpty) {
    return (
      <div className={cn('flex h-full flex-col')}>
        <div className='flex shrink-0 items-center justify-between pl-4 pr-2 pt-2'>
          <div className='system-sm-semibold-uppercase'>{t('workflow.debug.variableInspect.title')}</div>
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
          currentNodeVar={currentNodeVar}
          handleVarSelect={handleNodeVarSelect}
        />
      </div>
      {/* right */}
      <div className='w-0 grow'>
        <Right
          isValueFetching={isCurrentNodeVarValueFetching}
          currentNodeVar={currentNodeVar}
          handleOpenMenu={() => setShowLeftPanel(true)}
        />
      </div>
    </div>
  )
}

export default Panel

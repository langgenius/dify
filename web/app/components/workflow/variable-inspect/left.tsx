// import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useStore } from '../store'
import Button from '@/app/components/base/button'
// import ActionButton from '@/app/components/base/action-button'
// import Tooltip from '@/app/components/base/tooltip'
import Group from './group'
import useCurrentVars from '../hooks/use-inspect-vars-crud'
import { useNodesInteractions } from '../hooks/use-nodes-interactions'
import type { currentVarType } from './panel'
import type { VarInInspect } from '@/types/workflow'
import { VarInInspectType } from '@/types/workflow'
import cn from '@/utils/classnames'

type Props = {
  currentNodeVar?: currentVarType
  handleVarSelect: (state: any) => void
}

const Left = ({
  currentNodeVar,
  handleVarSelect,
}: Props) => {
  const { t } = useTranslation()

  const environmentVariables = useStore(s => s.environmentVariables)
  const setCurrentFocusNodeId = useStore(s => s.setCurrentFocusNodeId)

  const {
    conversationVars,
    systemVars,
    nodesWithInspectVars,
    deleteAllInspectorVars,
    deleteNodeInspectorVars,
  } = useCurrentVars()
  const { handleNodeSelect } = useNodesInteractions()

  const showDivider = environmentVariables.length > 0 || conversationVars.length > 0 || systemVars.length > 0

  const handleClearAll = () => {
    deleteAllInspectorVars()
    setCurrentFocusNodeId('')
  }

  const handleClearNode = (nodeId: string) => {
    deleteNodeInspectorVars(nodeId)
    setCurrentFocusNodeId('')
  }

  return (
    <div className={cn('flex h-full flex-col')}>
      {/* header */}
      <div className='flex shrink-0 items-center justify-between gap-1 pl-4 pr-1 pt-2'>
        <div className='system-sm-semibold-uppercase truncate text-text-primary'>{t('workflow.debug.variableInspect.title')}</div>
        <Button variant='ghost' size='small' className='shrink-0' onClick={handleClearAll}>{t('workflow.debug.variableInspect.clearAll')}</Button>
      </div>
      {/* content */}
      <div className='grow overflow-y-auto py-1'>
        {/* group ENV */}
        {environmentVariables.length > 0 && (
          <Group
            varType={VarInInspectType.environment}
            varList={environmentVariables as VarInInspect[]}
            currentVar={currentNodeVar}
            handleSelect={handleVarSelect}
          />
        )}
        {/* group CHAT VAR */}
        {conversationVars.length > 0 && (
          <Group
            varType={VarInInspectType.conversation}
            varList={conversationVars}
            currentVar={currentNodeVar}
            handleSelect={handleVarSelect}
          />
        )}
        {/* group SYSTEM VAR */}
        {systemVars.length > 0 && (
          <Group
            varType={VarInInspectType.system}
            varList={systemVars}
            currentVar={currentNodeVar}
            handleSelect={handleVarSelect}
          />
        )}
        {/* divider */}
        {showDivider && (
          <div className='px-4 py-1'>
            <div className='h-px bg-divider-subtle'></div>
          </div>
        )}
        {/* group nodes */}
        {nodesWithInspectVars.length > 0 && nodesWithInspectVars.map(group => (
          <Group
            key={group.nodeId}
            varType={VarInInspectType.node}
            varList={group.vars}
            nodeData={group}
            currentVar={currentNodeVar}
            handleSelect={handleVarSelect}
            handleView={() => handleNodeSelect(group.nodeId, false, true)}
            handleClear={() => handleClearNode(group.nodeId)}
          />
        ))}
      </div>
    </div>
  )
}

export default Left

import type { currentVarType, selectedVarState } from './panel'

import type { VarInInspect } from '@/types/workflow'
// import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { VarInInspectType } from '@/types/workflow'
import { cn } from '@/utils/classnames'
import { useRerunEditor } from '../hooks'
import useCurrentVars from '../hooks/use-inspect-vars-crud'
import { useNodesInteractions } from '../hooks/use-nodes-interactions'
import { useStore } from '../store'
// import ActionButton from '@/app/components/base/action-button'
// import Tooltip from '@/app/components/base/tooltip'
import Group from './group'

type Props = {
  currentNodeVar?: currentVarType
  handleVarSelect: (state: selectedVarState) => void
}

const Left = ({
  currentNodeVar,
  handleVarSelect,
}: Props) => {
  const { t } = useTranslation()
  const { handleSubmitRerun } = useRerunEditor()

  const environmentVariables = useStore(s => s.environmentVariables)
  const setCurrentFocusNodeId = useStore(s => s.setCurrentFocusNodeId)
  const variableInspectMode = useStore(s => s.variableInspectMode)
  const rerunContext = useStore(s => s.rerunContext)

  const {
    conversationVars,
    systemVars,
    nodesWithInspectVars,
    deleteAllInspectorVars,
    deleteNodeInspectorVars,
  } = useCurrentVars()
  const { handleNodeSelect } = useNodesInteractions()
  const isRerunEditMode = variableInspectMode === 'rerun-edit'
  const envVars = isRerunEditMode ? (rerunContext?.envVars || []) : environmentVariables
  const nodeVarGroups = isRerunEditMode ? (rerunContext?.nodeGroups || []) : nodesWithInspectVars
  const conversationVarList = isRerunEditMode ? [] : conversationVars
  const systemVarList = isRerunEditMode ? [] : systemVars

  const showDivider = envVars.length > 0 || conversationVarList.length > 0 || systemVarList.length > 0

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
      <div className="flex shrink-0 items-center justify-between gap-1 pl-4 pr-1 pt-2">
        <div className="truncate text-text-primary system-sm-semibold-uppercase">
          {isRerunEditMode
            ? t('debug.rerun.editVariablesTitle', { ns: 'workflow' })
            : t('debug.variableInspect.title', { ns: 'workflow' })}
        </div>
        {!isRerunEditMode && (
          <Button variant="ghost" size="small" className="shrink-0" onClick={handleClearAll}>{t('debug.variableInspect.clearAll', { ns: 'workflow' })}</Button>
        )}
      </div>
      {/* content */}
      <div className="grow overflow-y-auto py-1">
        {/* group ENV */}
        {envVars.length > 0 && (
          <Group
            varType={VarInInspectType.environment}
            varList={envVars as VarInInspect[]}
            mode={isRerunEditMode ? 'rerun-edit' : 'cache'}
            currentVar={currentNodeVar}
            handleSelect={handleVarSelect}
          />
        )}
        {/* group CHAT VAR */}
        {conversationVarList.length > 0 && (
          <Group
            varType={VarInInspectType.conversation}
            varList={conversationVarList}
            currentVar={currentNodeVar}
            handleSelect={handleVarSelect}
          />
        )}
        {/* group SYSTEM VAR */}
        {systemVarList.length > 0 && (
          <Group
            varType={VarInInspectType.system}
            varList={systemVarList}
            currentVar={currentNodeVar}
            handleSelect={handleVarSelect}
          />
        )}
        {/* divider */}
        {showDivider && (
          <div className="px-4 py-1">
            <div className="h-px bg-divider-subtle"></div>
          </div>
        )}
        {/* group nodes */}
        {nodeVarGroups.length > 0 && nodeVarGroups.map(group => (
          <Group
            key={group.nodeId}
            varType={VarInInspectType.node}
            varList={group.vars}
            nodeData={group}
            mode={isRerunEditMode ? 'rerun-edit' : 'cache'}
            currentVar={currentNodeVar}
            handleSelect={handleVarSelect}
            handleView={() => handleNodeSelect(group.nodeId, false, true)}
            handleClear={() => handleClearNode(group.nodeId)}
          />
        ))}
      </div>
      {isRerunEditMode && (
        <div className="border-t border-divider-subtle p-2">
          <Button
            variant="primary"
            className="w-full"
            disabled={!!rerunContext?.loading || !!rerunContext?.submitting}
            loading={!!rerunContext?.submitting}
            onClick={handleSubmitRerun}
          >
            {t('debug.rerun.submit', { ns: 'workflow' })}
          </Button>
        </div>
      )}
    </div>
  )
}

export default Left

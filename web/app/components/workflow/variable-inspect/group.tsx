import type { currentVarType } from './panel'
import type { NodeWithVar, VarInInspect } from '@/types/workflow'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import {
  RiArrowRightSLine,
  RiDeleteBinLine,
  RiFileList3Line,
  RiLoader2Line,
  // RiErrorWarningFill,
} from '@remixicon/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
// import { Button } from '@langgenius/dify-ui/button'
import ActionButton from '@/app/components/base/action-button'
import BlockIcon from '@/app/components/workflow/block-icon'
import { VariableIconWithColor } from '@/app/components/workflow/nodes/_base/components/variable/variable-label'
import { VarInInspectType } from '@/types/workflow'
import { useToolIcon } from '../hooks'

type Props = {
  nodeData?: NodeWithVar
  currentVar?: currentVarType
  varType: VarInInspectType
  varList: VarInInspect[]
  handleSelect: (state: any) => void
  handleView?: () => void
  handleClear?: () => void
}

const Group = ({
  nodeData,
  currentVar,
  varType,
  varList,
  handleSelect,
  handleView,
  handleClear,
}: Props) => {
  const { t } = useTranslation()
  const [isCollapsed, setIsCollapsed] = useState(false)

  const toolIcon = useToolIcon(nodeData?.nodePayload)

  const isEnv = varType === VarInInspectType.environment
  const isChatVar = varType === VarInInspectType.conversation
  const isSystem = varType === VarInInspectType.system
  const groupTitle = nodeData?.title
    || (isEnv && t('debug.variableInspect.envNode', { ns: 'workflow' }))
    || (isChatVar && t('debug.variableInspect.chatNode', { ns: 'workflow' }))
    || (isSystem && t('debug.variableInspect.systemNode', { ns: 'workflow' }))
    || ''

  const visibleVarList = isEnv ? varList : varList.filter(v => v.visible)

  const handleSelectVar = (varItem: any, type?: string) => {
    if (type === VarInInspectType.environment) {
      handleSelect({
        nodeId: VarInInspectType.environment,
        title: VarInInspectType.environment,
        nodeType: VarInInspectType.environment,
        var: {
          ...varItem,
          type: VarInInspectType.environment,
          ...(varItem.value_type === 'secret' ? { value: '******************' } : {}),
        },
      })
      return
    }
    if (type === VarInInspectType.conversation) {
      handleSelect({
        nodeId: VarInInspectType.conversation,
        nodeType: VarInInspectType.conversation,
        title: VarInInspectType.conversation,
        var: {
          ...varItem,
          type: VarInInspectType.conversation,
        },
      })
      return
    }
    if (type === VarInInspectType.system) {
      handleSelect({
        nodeId: VarInInspectType.system,
        nodeType: VarInInspectType.system,
        title: VarInInspectType.system,
        var: {
          ...varItem,
          type: VarInInspectType.system,
        },
      })
      return
    }
    if (!nodeData)
      return
    handleSelect({
      nodeId: nodeData.nodeId,
      nodeType: nodeData.nodeType,
      title: nodeData.title,
      var: varItem,
    })
  }

  return (
    <div className="p-0.5">
      {/* node item */}
      <div className="group flex h-6 items-center gap-0.5">
        <button
          type="button"
          aria-expanded={visibleVarList.length > 0 ? !isCollapsed : undefined}
          className="flex min-w-0 grow cursor-pointer items-center gap-0.5 rounded-sm border-none bg-transparent p-0 text-left outline-hidden focus-visible:ring-1 focus-visible:ring-components-input-border-hover"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <div className="h-3 w-3 shrink-0">
            {nodeData?.isSingRunRunning && (
              <RiLoader2Line className="h-3 w-3 animate-spin text-text-accent" aria-hidden />
            )}
            {(!nodeData || !nodeData.isSingRunRunning) && visibleVarList.length > 0 && (
              <RiArrowRightSLine className={cn('h-3 w-3 text-text-tertiary', !isCollapsed && 'rotate-90')} aria-hidden />
            )}
          </div>
          {nodeData && (
            <>
              <BlockIcon
                className="shrink-0"
                type={nodeData.nodeType}
                toolIcon={toolIcon || ''}
                size="xs"
              />
              <div className="truncate system-xs-medium-uppercase text-text-tertiary">{nodeData.title}</div>
            </>
          )}
          {!nodeData && (
            <div className="truncate system-xs-medium-uppercase text-text-tertiary">
              {groupTitle}
            </div>
          )}
        </button>
        {nodeData && !nodeData.isSingRunRunning && (
          <div className="hidden shrink-0 items-center group-hover:flex">
            <Tooltip>
              <TooltipTrigger
                render={(
                  <ActionButton aria-label={t('debug.variableInspect.view', { ns: 'workflow' })} onClick={handleView}>
                    <RiFileList3Line className="h-4 w-4" aria-hidden />
                  </ActionButton>
                )}
              />
              <TooltipContent>
                {t('debug.variableInspect.view', { ns: 'workflow' })}
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={(
                  <ActionButton aria-label={t('debug.variableInspect.clearNode', { ns: 'workflow' })} onClick={handleClear}>
                    <RiDeleteBinLine className="h-4 w-4" aria-hidden />
                  </ActionButton>
                )}
              />
              <TooltipContent>
                {t('debug.variableInspect.clearNode', { ns: 'workflow' })}
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
      {/* var item list */}
      {!isCollapsed && !nodeData?.isSingRunRunning && (
        <div className="px-0.5">
          {visibleVarList.length > 0 && visibleVarList.map(varItem => (
            <button
              type="button"
              key={varItem.id}
              className={cn(
                'relative flex w-full cursor-pointer items-center gap-1 rounded-md border-none px-3 py-1 text-left outline-hidden hover:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover',
                varItem.id === currentVar?.var?.id
                  ? 'bg-state-base-hover-alt hover:bg-state-base-hover-alt'
                  : 'bg-transparent',
              )}
              onClick={() => handleSelectVar(varItem, varType)}
            >
              <VariableIconWithColor
                variableCategory={varType}
                isExceptionVariable={['error_type', 'error_message'].includes(varItem.name)}
                className="size-4"
              />
              <div className="grow truncate system-sm-medium text-text-secondary">{varItem.name}</div>
              <div className="shrink-0 system-xs-regular text-text-tertiary">{varItem.value_type}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default Group

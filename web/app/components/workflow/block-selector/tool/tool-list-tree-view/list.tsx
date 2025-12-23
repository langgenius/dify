'use client'
import type { FC } from 'react'
import type { BlockEnum, ToolWithProvider } from '../../../types'
import type { ToolDefaultValue, ToolValue } from '../../types'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { AGENT_GROUP_NAME, CUSTOM_GROUP_NAME, WORKFLOW_GROUP_NAME } from '../../index-bar'
import Item from './item'

type Props = {
  payload: Record<string, ToolWithProvider[]>
  hasSearchText: boolean
  onSelect: (type: BlockEnum, tool: ToolDefaultValue) => void
  canNotSelectMultiple?: boolean
  onSelectMultiple?: (type: BlockEnum, tools: ToolDefaultValue[]) => void
  selectedTools?: ToolValue[]
  canChooseMCPTool?: boolean
}

const ToolListTreeView: FC<Props> = ({
  payload,
  hasSearchText,
  onSelect,
  canNotSelectMultiple,
  onSelectMultiple,
  selectedTools,
  canChooseMCPTool,
}) => {
  const { t } = useTranslation()
  const getI18nGroupName = useCallback((name: string) => {
    if (name === CUSTOM_GROUP_NAME)
      return t('workflow.tabs.customTool')

    if (name === WORKFLOW_GROUP_NAME)
      return t('workflow.tabs.workflowTool')

    if (name === AGENT_GROUP_NAME)
      return t('workflow.tabs.agent')

    return name
  }, [t])

  if (!payload)
    return null

  return (
    <div>
      {Object.keys(payload).map(groupName => (
        <Item
          key={groupName}
          groupName={getI18nGroupName(groupName)}
          toolList={payload[groupName]}
          hasSearchText={hasSearchText}
          onSelect={onSelect}
          canNotSelectMultiple={canNotSelectMultiple}
          onSelectMultiple={onSelectMultiple}
          selectedTools={selectedTools}
          canChooseMCPTool={canChooseMCPTool}
        />
      ))}
    </div>
  )
}

export default React.memo(ToolListTreeView)

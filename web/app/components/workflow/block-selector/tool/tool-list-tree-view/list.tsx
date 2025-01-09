'use client'
import type { FC } from 'react'
import React, { useCallback } from 'react'
import type { ToolWithProvider } from '../../../types'
import type { BlockEnum } from '../../../types'
import type { ToolDefaultValue } from '../../types'
import Item from './item'
import { useTranslation } from 'react-i18next'
import { AGENT_GROUP_NAME, CUSTOM_GROUP_NAME, WORKFLOW_GROUP_NAME } from '../../index-bar'

type Props = {
  payload: Record<string, ToolWithProvider[]>
  hasSearchText: boolean
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
}

const ToolListTreeView: FC<Props> = ({
  payload,
  hasSearchText,
  onSelect,
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

  if (!payload) return null

  return (
    <div>
      {Object.keys(payload).map(groupName => (
        <Item
          key={groupName}
          groupName={getI18nGroupName(groupName)}
          toolList={payload[groupName]}
          hasSearchText={hasSearchText}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

export default React.memo(ToolListTreeView)

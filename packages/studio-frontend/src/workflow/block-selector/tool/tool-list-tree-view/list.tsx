'use client'
import type { FC } from 'react'
import type { BlockEnum, ToolWithProvider } from '@/app/components/workflow/types'
import type { ToolDefaultValue, ToolValue } from '@/app/components/workflow/block-selector/types'
import type { ToolActionPreviewCardHandle } from '@/app/components/workflow/block-selector/tool/action-item'
import * as React from 'react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { AGENT_GROUP_NAME, CUSTOM_GROUP_NAME, WORKFLOW_GROUP_NAME } from '@/app/components/workflow/block-selector/index-bar'
import Item from '@/app/components/workflow/block-selector/tool/tool-list-tree-view/item'

type Props = {
  payload: Record<string, ToolWithProvider[]>
  previewCardHandle: ToolActionPreviewCardHandle
  hasSearchText: boolean
  onSelect: (type: BlockEnum, tool: ToolDefaultValue) => void
  canNotSelectMultiple?: boolean
  onSelectMultiple?: (type: BlockEnum, tools: ToolDefaultValue[]) => void
  selectedTools?: ToolValue[]
}

const ToolListTreeView: FC<Props> = ({
  payload,
  previewCardHandle,
  hasSearchText,
  onSelect,
  canNotSelectMultiple,
  onSelectMultiple,
  selectedTools,
}) => {
  const { t } = useTranslation()
  const getI18nGroupName = useCallback((name: string) => {
    if (name === CUSTOM_GROUP_NAME)
      return t('tabs.customTool', { ns: 'workflow' })

    if (name === WORKFLOW_GROUP_NAME)
      return t('tabs.workflowTool', { ns: 'workflow' })

    if (name === AGENT_GROUP_NAME)
      return t('tabs.agent', { ns: 'workflow' })

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
          toolList={payload[groupName]!}
          previewCardHandle={previewCardHandle}
          hasSearchText={hasSearchText}
          onSelect={onSelect}
          canNotSelectMultiple={canNotSelectMultiple}
          onSelectMultiple={onSelectMultiple}
          selectedTools={selectedTools}
        />
      ))}
    </div>
  )
}

export default React.memo(ToolListTreeView)

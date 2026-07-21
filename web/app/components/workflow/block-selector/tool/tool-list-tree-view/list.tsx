'use client'
import type { BlockEnum } from '../../../types'
import type { ToolGroup } from '../../tool-list-data'
import type { ToolDefaultValue, ToolValue } from '../../types'
import type { ToolActionPreviewCardHandle } from '../action-item'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Item from './item'

type Props = Readonly<{
  payload: ToolGroup[]
  previewCardHandle: ToolActionPreviewCardHandle
  hasSearchText: boolean
  onSelect: (type: BlockEnum, tool: ToolDefaultValue) => void
  canNotSelectMultiple?: boolean
  onSelectMultiple?: (type: BlockEnum, tools: ToolDefaultValue[]) => void
  selectedTools?: ToolValue[]
}>

export const ToolListTreeView = memo(
  ({
    payload,
    previewCardHandle,
    hasSearchText,
    onSelect,
    canNotSelectMultiple,
    onSelectMultiple,
    selectedTools,
  }: Props) => {
    const { t } = useTranslation()
    const getGroupName = (group: ToolGroup) => {
      if (group.kind === 'author') return group.author

      switch (group.category) {
        case 'custom':
          return t(($) => $['tabs.customTool'], { ns: 'workflow' })
        case 'workflow':
          return t(($) => $['tabs.workflowTool'], { ns: 'workflow' })
        case 'data-source':
          return t(($) => $['tabs.sources'], { ns: 'workflow' })
        case 'mcp':
          return 'MCP'
      }
    }

    return (
      <div>
        {payload.map((group) => (
          <Item
            key={group.kind === 'author' ? `author:${group.author}` : `category:${group.category}`}
            groupName={getGroupName(group)}
            toolList={group.tools}
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
  },
)

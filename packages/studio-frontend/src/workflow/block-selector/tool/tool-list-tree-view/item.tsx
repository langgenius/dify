'use client'
import type { FC } from 'react'
import type { BlockEnum, ToolWithProvider } from '@/app/components/workflow/types'
import type { ToolDefaultValue, ToolValue } from '@/app/components/workflow/block-selector/types'
import type { ToolActionPreviewCardHandle } from '@/app/components/workflow/block-selector/tool/action-item'
import * as React from 'react'
import { ViewType } from '@/app/components/workflow/block-selector/view-type-select'
import Tool from '@/app/components/workflow/block-selector/tool/tool'

type Props = {
  groupName: string
  toolList: ToolWithProvider[]
  previewCardHandle: ToolActionPreviewCardHandle
  hasSearchText: boolean
  onSelect: (type: BlockEnum, tool: ToolDefaultValue) => void
  canNotSelectMultiple?: boolean
  onSelectMultiple?: (type: BlockEnum, tools: ToolDefaultValue[]) => void
  selectedTools?: ToolValue[]
}

const Item: FC<Props> = ({
  groupName,
  toolList,
  previewCardHandle,
  hasSearchText,
  onSelect,
  canNotSelectMultiple,
  onSelectMultiple,
  selectedTools,
}) => {
  return (
    <div>
      <div className="flex h-[22px] items-center px-3 text-xs font-medium text-text-tertiary">
        {groupName}
      </div>
      <div>
        {toolList.map((tool: ToolWithProvider) => (
          <Tool
            key={tool.id}
            payload={tool}
            previewCardHandle={previewCardHandle}
            viewType={ViewType.tree}
            hasSearchText={hasSearchText}
            onSelect={onSelect}
            canNotSelectMultiple={canNotSelectMultiple}
            onSelectMultiple={onSelectMultiple}
            selectedTools={selectedTools}
          />
        ))}
      </div>
    </div>
  )
}

export default React.memo(Item)

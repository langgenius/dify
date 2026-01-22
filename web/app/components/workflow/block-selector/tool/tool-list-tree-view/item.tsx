'use client'
import type { FC } from 'react'
import type { BlockEnum, ToolWithProvider } from '../../../types'
import type { ToolDefaultValue, ToolValue } from '../../types'
import * as React from 'react'
import { ViewType } from '../../view-type-select'
import Tool from '../tool'

type Props = {
  groupName: string
  toolList: ToolWithProvider[]
  hasSearchText: boolean
  onSelect: (type: BlockEnum, tool: ToolDefaultValue) => void
  canNotSelectMultiple?: boolean
  onSelectMultiple?: (type: BlockEnum, tools: ToolDefaultValue[]) => void
  selectedTools?: ToolValue[]
  hideSelectedInfo?: boolean
}

const Item: FC<Props> = ({
  groupName,
  toolList,
  hasSearchText,
  onSelect,
  canNotSelectMultiple,
  onSelectMultiple,
  selectedTools,
  hideSelectedInfo,
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
            viewType={ViewType.tree}
            hasSearchText={hasSearchText}
            onSelect={onSelect}
            canNotSelectMultiple={canNotSelectMultiple}
            onSelectMultiple={onSelectMultiple}
            selectedTools={selectedTools}
            hideSelectedInfo={hideSelectedInfo}
          />
        ))}
      </div>
    </div>
  )
}

export default React.memo(Item)

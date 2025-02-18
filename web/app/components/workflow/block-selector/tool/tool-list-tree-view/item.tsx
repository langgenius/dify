'use client'
import type { FC } from 'react'
import React from 'react'
import type { ToolWithProvider } from '../../../types'
import Tool from '../tool'
import type { BlockEnum } from '../../../types'
import { ViewType } from '../../view-type-select'
import type { ToolDefaultValue, ToolValue } from '../../types'

type Props = {
  groupName: string
  toolList: ToolWithProvider[]
  hasSearchText: boolean
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
  selectedTools?: ToolValue[]
}

const Item: FC<Props> = ({
  groupName,
  toolList,
  hasSearchText,
  onSelect,
  selectedTools,
}) => {
  return (
    <div>
      <div className='text-text-tertiary flex h-[22px] items-center px-3 text-xs font-medium'>
        {groupName}
      </div>
      <div>
        {toolList.map((tool: ToolWithProvider) => (
          <Tool
            key={tool.id}
            payload={tool}
            viewType={ViewType.tree}
            isShowLetterIndex={false}
            hasSearchText={hasSearchText}
            onSelect={onSelect}
            selectedTools={selectedTools}
          />
        ))}
      </div>
    </div>
  )
}

export default React.memo(Item)

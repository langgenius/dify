'use client'
import type { FC } from 'react'
import React from 'react'
import type { ToolWithProvider } from '../../../types'
import type { BlockEnum } from '../../../types'
import type { ToolDefaultValue } from '../../types'
import Tool from '../tool'
import { ViewType } from '../../view-type-select'

type Props = {
  payload: ToolWithProvider[]
  isShowLetterIndex: boolean
  hasSearchText: boolean
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
}

const ToolViewFlatView: FC<Props> = ({
  payload,
  isShowLetterIndex,
  hasSearchText,
  onSelect,
}) => {
  return (
    <div>
      {payload.map(tool => (
        <Tool
          key={tool.id}
          payload={tool}
          viewType={ViewType.flat}
          isShowLetterIndex={isShowLetterIndex}
          hasSearchText={hasSearchText}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

export default React.memo(ToolViewFlatView)

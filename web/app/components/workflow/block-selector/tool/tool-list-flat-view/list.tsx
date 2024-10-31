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
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
}

const ToolViewFlatView: FC<Props> = ({
  payload,
  onSelect,
}) => {
  return (
    <div>
      {payload.map(tool => (
        <Tool
          key={tool.id}
          payload={tool}
          viewType={ViewType.flat}
          isShowLetterIndex={false}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}

export default React.memo(ToolViewFlatView)

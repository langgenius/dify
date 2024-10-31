'use client'
import type { FC } from 'react'
import React from 'react'
import type { ToolWithProvider } from '../../../types'
import type { BlockEnum } from '../../../types'
import type { ToolDefaultValue } from '../../types'
import Item from './item'

type Props = {
  payload: Record<string, ToolWithProvider[]>
  onSelect: (type: BlockEnum, tool?: ToolDefaultValue) => void
}

const OrgTools: FC<Props> = ({
  payload,
  onSelect,
}) => {
  if (!payload) return null

  return (
    <div>
      {Object.keys(payload).map(groupName => (
        <Item
          key={groupName}
          groupName={groupName}
          toolList={payload[groupName]}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
export default React.memo(OrgTools)

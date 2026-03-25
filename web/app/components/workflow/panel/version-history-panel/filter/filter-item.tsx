import type { FC } from 'react'
import type { WorkflowVersionFilterOptions } from '../../../types'
import { RiCheckLine } from '@remixicon/react'
import * as React from 'react'

type FilterItemProps = {
  item: {
    key: WorkflowVersionFilterOptions
    name: string
  }
  isSelected?: boolean
  onClick: (value: WorkflowVersionFilterOptions) => void
}

const FilterItem: FC<FilterItemProps> = ({
  item,
  isSelected = false,
  onClick,
}) => {
  return (
    <div
      className="flex cursor-pointer items-center justify-between gap-x-1 rounded-lg px-2 py-1.5 hover:bg-state-base-hover"
      onClick={() => {
        onClick(item.key)
      }}
    >
      <div className="system-md-regular flex-1 text-text-primary">{item.name}</div>
      {isSelected && <RiCheckLine className="h-4 w-4 shrink-0 text-text-accent" />}
    </div>
  )
}

export default React.memo(FilterItem)

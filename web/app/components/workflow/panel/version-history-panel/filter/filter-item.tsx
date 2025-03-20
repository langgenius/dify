import { RiCheckLine } from '@remixicon/react'
import React, { type FC } from 'react'
import type { WorkflowVersionFilterOptions } from '../../../types'

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
      className='flex items-center justify-between gap-x-1 px-2 py-1.5 cursor-pointer rounded-lg hover:bg-state-base-hover'
      onClick={() => {
        onClick(item.key)
      }}
    >
      <div className='flex-1 text-text-primary system-md-regular'>{item.name}</div>
      {isSelected && <RiCheckLine className='w-4 h-4 text-text-accent shrink-0' />}
    </div>
  )
}

export default React.memo(FilterItem)

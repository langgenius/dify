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

const FilterItem: FC<FilterItemProps> = ({ item, isSelected = false, onClick }) => {
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      className="flex w-full cursor-pointer appearance-none items-center justify-between gap-x-1 rounded-lg px-2 py-1.5 text-start outline-hidden hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid"
      onClick={() => {
        onClick(item.key)
      }}
    >
      <span className="flex-1 system-md-regular text-text-primary">{item.name}</span>
      {isSelected && <RiCheckLine aria-hidden className="size-4 shrink-0 text-text-accent" />}
    </button>
  )
}

export default React.memo(FilterItem)

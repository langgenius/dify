import type { FC } from 'react'
import type { SortField, SortOrder } from '../hooks'
import { RiArrowDownLine } from '@remixicon/react'
import * as React from 'react'
import { cn } from '@/utils/classnames'

type SortHeaderProps = {
  field: Exclude<SortField, null>
  label: string
  currentSortField: SortField
  sortOrder: SortOrder
  onSort: (field: SortField) => void
}

const SortHeader: FC<SortHeaderProps> = React.memo(({
  field,
  label,
  currentSortField,
  sortOrder,
  onSort,
}) => {
  const isActive = currentSortField === field
  const isDesc = isActive && sortOrder === 'desc'

  return (
    <div
      className="flex cursor-pointer items-center hover:text-text-secondary"
      onClick={() => onSort(field)}
    >
      {label}
      <RiArrowDownLine
        className={cn(
          'ml-0.5 h-3 w-3 transition-all',
          isActive ? 'text-text-tertiary' : 'text-text-disabled',
          isActive && !isDesc ? 'rotate-180' : '',
        )}
      />
    </div>
  )
})

SortHeader.displayName = 'SortHeader'

export default SortHeader

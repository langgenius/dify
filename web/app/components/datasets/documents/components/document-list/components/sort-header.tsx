import type { FC } from 'react'
import type { SortField, SortOrder } from '../hooks'
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
    <button
      type="button"
      className="flex items-center bg-transparent p-0 text-left hover:text-text-secondary"
      onClick={() => onSort(field)}
    >
      {label}
      <span
        className={cn(
          'i-ri-arrow-down-line ml-0.5 h-3 w-3 transition-all',
          isActive ? 'text-text-tertiary' : 'text-text-disabled',
          isActive && !isDesc ? 'rotate-180' : '',
        )}
      />
    </button>
  )
})

SortHeader.displayName = 'SortHeader'

export default SortHeader

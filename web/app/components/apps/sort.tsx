'use client'

import { useTranslation } from 'react-i18next'
import { RiSortAsc, RiSortDesc } from '@remixicon/react'
import { useMemo } from 'react'
import type { SortBy, SortOrder } from './hooks/use-apps-query-state'

type SortOption = {
  value: SortBy
  label: string
}

type SortDropdownProps = {
  sortBy?: SortBy
  sortOrder?: SortOrder
  onChange: (sortBy: SortBy, sortOrder: SortOrder) => void
}

const SortDropdown = ({ sortBy, sortOrder = 'desc', onChange }: SortDropdownProps) => {
  const { t } = useTranslation()

  const sortOptions: SortOption[] = useMemo(() => [
    { value: 'created_at', label: t('app.sort.createdAt') },
    { value: 'updated_at', label: t('app.sort.updatedAt') },
    { value: 'name', label: t('app.sort.name') },
    { value: 'owner_name', label: t('app.sort.ownerName') },
  ], [t])

  const currentOption = useMemo(
    () => sortOptions.find(opt => opt.value === sortBy),
    [sortOptions, sortBy],
  )
  const displayText = currentOption?.label || t('app.sort.sortBy')

  const handleNextSort = () => {
    const currentIndex = sortOptions.findIndex(opt => opt.value === sortBy)
    const nextIndex = (currentIndex + 1) % sortOptions.length
    const nextOption = sortOptions[nextIndex]
    onChange(nextOption.value, sortOrder)
  }

  const handleToggleOrder = () => {
    if (sortBy) {
      const newOrder = sortOrder === 'asc' ? 'desc' : 'asc'
      onChange(sortBy, newOrder)
    }
  }

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className="flex h-9 items-center gap-1 rounded-lg border-0 bg-transparent px-3 text-text-secondary hover:bg-state-base-hover hover:text-text-primary"
        onClick={handleNextSort}
      >
        <span className="system-sm-medium">{displayText}</span>
      </button>
      <button
        type="button"
        className="flex h-9 w-9 items-center justify-center rounded-lg border-0 bg-transparent text-text-secondary hover:bg-state-base-hover hover:text-text-primary"
        onClick={handleToggleOrder}
        title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
      >
        {sortOrder === 'asc' ? (
          <RiSortAsc className="h-4 w-4" />
        ) : (
          <RiSortDesc className="h-4 w-4" />
        )}
      </button>
    </div>
  )
}

export default SortDropdown

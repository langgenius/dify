import type { ReactNode } from 'react'
import { useState } from 'react'
import { usePluginPageContext } from '../context'
import CategoriesFilter from './category-filter'
import SearchBox from './search-box'
import TagFilter from './tag-filter'

export type FilterState = {
  categories: string[]
  tags: string[]
  searchQuery: string
}

type FilterManagementProps = {
  hideCategoryFilter?: boolean
  hideTagFilter?: boolean
  onFilterChange: (filters: FilterState) => void
  rightSlot?: ReactNode
}

const FilterManagement = ({
  hideCategoryFilter,
  hideTagFilter,
  onFilterChange,
  rightSlot,
}: FilterManagementProps) => {
  const initFilters = usePluginPageContext(v => v.filters) as FilterState
  const [filters, setFilters] = useState<FilterState>(initFilters)
  const showRightSlot = rightSlot !== undefined && rightSlot !== null

  const updateFilters = (newFilters: Partial<FilterState>) => {
    const updatedFilters = { ...filters, ...newFilters }
    setFilters(updatedFilters)
    onFilterChange(updatedFilters)
  }

  return (
    <div className="flex w-full items-center gap-2 self-stretch">
      {!hideCategoryFilter && (
        <CategoriesFilter
          value={filters.categories}
          onChange={categories => updateFilters({ categories })}
        />
      )}
      {!hideTagFilter && (
        <TagFilter
          value={filters.tags}
          onChange={tags => updateFilters({ tags })}
        />
      )}
      <SearchBox
        searchQuery={filters.searchQuery}
        onChange={searchQuery => updateFilters({ searchQuery })}
      />
      {showRightSlot && (
        <div className="ml-auto shrink-0">
          {rightSlot}
        </div>
      )}
    </div>
  )
}

export default FilterManagement

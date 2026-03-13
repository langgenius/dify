import * as React from 'react'
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
  onFilterChange: (filters: FilterState) => void
}

const FilterManagement: React.FC<FilterManagementProps> = ({ onFilterChange }) => {
  const initFilters = usePluginPageContext(v => v.filters) as FilterState
  const [filters, setFilters] = useState<FilterState>(initFilters)

  const updateFilters = (newFilters: Partial<FilterState>) => {
    const updatedFilters = { ...filters, ...newFilters }
    setFilters(updatedFilters)
    onFilterChange(updatedFilters)
  }

  return (
    <div className="flex items-center gap-2 self-stretch">
      <CategoriesFilter
        value={filters.categories}
        onChange={categories => updateFilters({ categories })}
      />
      <TagFilter
        value={filters.tags}
        onChange={tags => updateFilters({ tags })}
      />
      <SearchBox
        searchQuery={filters.searchQuery}
        onChange={searchQuery => updateFilters({ searchQuery })}
      />
    </div>
  )
}

export default FilterManagement

type SearchEmptyStateInput = {
  hasActiveFilter?: boolean
  isLoading: boolean
  resultCount: number
  searchText?: string
  sourceCount: number
}

export const hasSearchText = (searchText?: string) => {
  return !!searchText?.trim()
}

export const isSearchResultEmpty = ({
  hasActiveFilter,
  isLoading,
  resultCount,
  searchText,
  sourceCount,
}: SearchEmptyStateInput) => {
  const isFiltering = hasActiveFilter ?? hasSearchText(searchText)

  return !isLoading && sourceCount > 0 && resultCount === 0 && isFiltering
}

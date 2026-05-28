import { describe, expect, it } from 'vitest'
import { hasSearchText, isSearchResultEmpty } from '../search-state'

describe('search-state', () => {
  it('detects trimmed search text', () => {
    expect(hasSearchText(' query ')).toBe(true)
    expect(hasSearchText('   ')).toBe(false)
    expect(hasSearchText()).toBe(false)
  })

  it('treats search empty as filtering existing source data to no results', () => {
    expect(isSearchResultEmpty({
      isLoading: false,
      resultCount: 0,
      searchText: 'missing',
      sourceCount: 2,
    })).toBe(true)
  })

  it('does not treat loading or true source empty as search empty', () => {
    expect(isSearchResultEmpty({
      isLoading: true,
      resultCount: 0,
      searchText: 'missing',
      sourceCount: 2,
    })).toBe(false)
    expect(isSearchResultEmpty({
      isLoading: false,
      resultCount: 0,
      searchText: 'missing',
      sourceCount: 0,
    })).toBe(false)
  })

  it('supports non-text filters', () => {
    expect(isSearchResultEmpty({
      hasActiveFilter: true,
      isLoading: false,
      resultCount: 0,
      sourceCount: 2,
    })).toBe(true)
  })
})

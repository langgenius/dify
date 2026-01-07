import { type ReadonlyURLSearchParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo } from 'react'

export type SortBy = 'created_at' | 'updated_at' | 'name' | 'owner_name'
export type SortOrder = 'asc' | 'desc'

type AppsQuery = {
  tagIDs?: string[]
  keywords?: string
  isCreatedByMe?: boolean
  sortBy?: SortBy
  sortOrder?: SortOrder
}

const SORT_STORAGE_KEY = 'apps_sort_preferences'

// Validate sort parameters
function isValidSortBy(value: string | null): value is SortBy {
  return value === 'created_at' || value === 'updated_at' || value === 'name' || value === 'owner_name'
}

function isValidSortOrder(value: string | null): value is SortOrder {
  return value === 'asc' || value === 'desc'
}

// Load sort preferences from localStorage
function loadSortPreferences(): { sortBy: SortBy; sortOrder: SortOrder } {
  if (typeof window === 'undefined')
    return { sortBy: 'updated_at', sortOrder: 'desc' }

  try {
    const stored = localStorage.getItem(SORT_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (isValidSortBy(parsed.sortBy) && isValidSortOrder(parsed.sortOrder))
        return parsed
    }
  }
  catch (error) {
    // Ignore parsing errors
  }
  return { sortBy: 'updated_at', sortOrder: 'desc' }
}

// Save sort preferences to localStorage
function saveSortPreferences(sortBy: SortBy, sortOrder: SortOrder) {
  if (typeof window === 'undefined')
    return

  try {
    localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ sortBy, sortOrder }))
  }
  catch (error) {
    // Ignore storage errors
  }
}

// Parse the query parameters from the URL search string.
function parseParams(params: ReadonlyURLSearchParams): AppsQuery {
  const tagIDs = params.get('tagIDs')?.split(';')
  const keywords = params.get('keywords') || undefined
  const isCreatedByMeParam = params.get('isCreatedByMe')
  // Default to true when parameter is not present, false when explicitly set to 'false'
  const isCreatedByMe = isCreatedByMeParam === 'false' ? false : true
  const sortByParam = params.get('sortBy')
  const sortOrderParam = params.get('sortOrder')

  // Priority: URL params > localStorage > hardcoded defaults
  const storedPreferences = loadSortPreferences()
  const sortBy = isValidSortBy(sortByParam) ? sortByParam : storedPreferences.sortBy
  const sortOrder = isValidSortOrder(sortOrderParam) ? sortOrderParam : storedPreferences.sortOrder

  return { tagIDs, keywords, isCreatedByMe, sortBy, sortOrder }
}

// Update the URL search string with the given query parameters.
function updateSearchParams(query: AppsQuery, current: URLSearchParams) {
  const { tagIDs, keywords, isCreatedByMe, sortBy, sortOrder } = query || {}

  if (tagIDs && tagIDs.length > 0)
    current.set('tagIDs', tagIDs.join(';'))
  else
    current.delete('tagIDs')

  if (keywords)
    current.set('keywords', keywords)
  else
    current.delete('keywords')

  // Only set the parameter if it's different from the default (true)
  if (isCreatedByMe === false)
    current.set('isCreatedByMe', 'false')
  else
    current.delete('isCreatedByMe')

  if (sortBy)
    current.set('sortBy', sortBy)
  else
    current.delete('sortBy')

  if (sortOrder)
    current.set('sortOrder', sortOrder)
  else
    current.delete('sortOrder')
}

function useAppsQueryState() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const query = useMemo(() => parseParams(searchParams), [searchParams])

  const setQuery = useCallback((updater: AppsQuery | ((prev: AppsQuery) => AppsQuery)) => {
    const newQuery = typeof updater === 'function' ? updater(query) : updater

    const params = new URLSearchParams()
    updateSearchParams(newQuery, params)
    const search = params.toString()
    router.push(`${pathname}${search ? `?${search}` : ''}`, { scroll: false })
  }, [query, router, pathname])

  // Save sort preferences to localStorage whenever they change
  useEffect(() => {
    if (query.sortBy && query.sortOrder)
      saveSortPreferences(query.sortBy, query.sortOrder)
  }, [query.sortBy, query.sortOrder])

  return useMemo(() => ({ query, setQuery }), [query, setQuery])
}

export default useAppsQueryState

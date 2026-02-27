import type { ReadonlyURLSearchParams } from 'next/navigation'
import type { SortType } from '@/service/datasets'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo } from 'react'
import { sanitizeStatusValue } from '../status-filter'

const ALLOWED_SORT_VALUES: SortType[] = ['-created_at', 'created_at', '-hit_count', 'hit_count']

const sanitizeSortValue = (value?: string | null): SortType => {
  if (!value)
    return '-created_at'

  return (ALLOWED_SORT_VALUES.includes(value as SortType) ? value : '-created_at') as SortType
}

export type DocumentListQuery = {
  page: number
  limit: number
  keyword: string
  status: string
  sort: SortType
}

const DEFAULT_QUERY: DocumentListQuery = {
  page: 1,
  limit: 10,
  keyword: '',
  status: 'all',
  sort: '-created_at',
}

// Parse the query parameters from the URL search string.
function parseParams(params: ReadonlyURLSearchParams): DocumentListQuery {
  const page = Number.parseInt(params.get('page') || '1', 10)
  const limit = Number.parseInt(params.get('limit') || '10', 10)
  const keyword = params.get('keyword') || ''
  const status = sanitizeStatusValue(params.get('status'))
  const sort = sanitizeSortValue(params.get('sort'))

  return {
    page: page > 0 ? page : 1,
    limit: (limit > 0 && limit <= 100) ? limit : 10,
    keyword: keyword ? decodeURIComponent(keyword) : '',
    status,
    sort,
  }
}

// Update the URL search string with the given query parameters.
function updateSearchParams(query: DocumentListQuery, searchParams: URLSearchParams) {
  const { page, limit, keyword, status, sort } = query || {}

  const hasNonDefaultParams = (page && page > 1) || (limit && limit !== 10) || (keyword && keyword.trim())

  if (hasNonDefaultParams) {
    searchParams.set('page', (page || 1).toString())
    searchParams.set('limit', (limit || 10).toString())
  }
  else {
    searchParams.delete('page')
    searchParams.delete('limit')
  }

  if (keyword && keyword.trim())
    searchParams.set('keyword', encodeURIComponent(keyword))
  else
    searchParams.delete('keyword')

  const sanitizedStatus = sanitizeStatusValue(status)
  if (sanitizedStatus && sanitizedStatus !== 'all')
    searchParams.set('status', sanitizedStatus)
  else
    searchParams.delete('status')

  const sanitizedSort = sanitizeSortValue(sort)
  if (sanitizedSort !== '-created_at')
    searchParams.set('sort', sanitizedSort)
  else
    searchParams.delete('sort')
}

function useDocumentListQueryState() {
  const searchParams = useSearchParams()
  const query = useMemo(() => parseParams(searchParams), [searchParams])

  const router = useRouter()
  const pathname = usePathname()

  // Helper function to update specific query parameters
  const updateQuery = useCallback((updates: Partial<DocumentListQuery>) => {
    const newQuery = { ...query, ...updates }
    newQuery.status = sanitizeStatusValue(newQuery.status)
    newQuery.sort = sanitizeSortValue(newQuery.sort)
    const params = new URLSearchParams()
    updateSearchParams(newQuery, params)
    const search = params.toString()
    const queryString = search ? `?${search}` : ''
    router.push(`${pathname}${queryString}`, { scroll: false })
  }, [query, router, pathname])

  // Helper function to reset query to defaults
  const resetQuery = useCallback(() => {
    const params = new URLSearchParams()
    updateSearchParams(DEFAULT_QUERY, params)
    const search = params.toString()
    const queryString = search ? `?${search}` : ''
    router.push(`${pathname}${queryString}`, { scroll: false })
  }, [router, pathname])

  return useMemo(() => ({
    query,
    updateQuery,
    resetQuery,
  }), [query, updateQuery, resetQuery])
}

export default useDocumentListQueryState

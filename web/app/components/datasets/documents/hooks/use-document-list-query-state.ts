import type { SortType } from '@/service/datasets'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
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

type DocumentListQueryInput = {
  page?: number
  limit?: number
  keyword?: string | null
  status?: string | null
  sort?: string | null
}

const DEFAULT_QUERY: DocumentListQuery = {
  page: 1,
  limit: 10,
  keyword: '',
  status: 'all',
  sort: '-created_at',
}

const normalizeKeywordValue = (value?: string | null) => (value && value.trim() ? value : '')

const normalizeDocumentListQuery = (query: DocumentListQueryInput): DocumentListQuery => {
  const page = (query.page && query.page > 0) ? query.page : DEFAULT_QUERY.page
  const limit = (query.limit && query.limit > 0 && query.limit <= 100) ? query.limit : DEFAULT_QUERY.limit
  const keyword = normalizeKeywordValue(query.keyword ?? DEFAULT_QUERY.keyword)
  const status = sanitizeStatusValue(query.status ?? DEFAULT_QUERY.status)
  const sort = sanitizeSortValue(query.sort ?? DEFAULT_QUERY.sort)

  return {
    page,
    limit,
    keyword,
    status,
    sort,
  }
}

function useDocumentListQueryState() {
  const [query, setQuery] = useQueryStates(
    {
      page: parseAsInteger.withDefault(DEFAULT_QUERY.page),
      limit: parseAsInteger.withDefault(DEFAULT_QUERY.limit),
      keyword: parseAsString.withDefault(DEFAULT_QUERY.keyword),
      status: parseAsString.withDefault(DEFAULT_QUERY.status),
      sort: parseAsString.withDefault(DEFAULT_QUERY.sort),
    },
    {
      history: 'push',
      urlKeys: {
        page: 'page',
        limit: 'limit',
        keyword: 'keyword',
        status: 'status',
        sort: 'sort',
      },
    },
  )

  const finalQuery = useMemo(() => normalizeDocumentListQuery(query), [query])

  const updateQuery = useCallback((updates: Partial<DocumentListQuery>) => {
    setQuery(prev => normalizeDocumentListQuery({ ...prev, ...updates }))
  }, [setQuery])

  const resetQuery = useCallback(() => {
    setQuery(DEFAULT_QUERY)
  }, [setQuery])

  return {
    query: finalQuery,
    updateQuery,
    resetQuery,
  }
}

export default useDocumentListQueryState

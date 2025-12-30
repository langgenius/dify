import type { SortType } from '@/service/datasets'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
import { useMemo } from 'react'
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
      urlKeys: {
        page: 'page',
        limit: 'limit',
        keyword: 'keyword',
        status: 'status',
        sort: 'sort',
      },
    },
  )

  const finalQuery = useMemo(() => {
    const page = query.page > 0 ? query.page : 1
    const limit = (query.limit > 0 && query.limit <= 100) ? query.limit : 10

    return {
      ...query,
      page,
      limit,
      status: sanitizeStatusValue(query.status),
      sort: sanitizeSortValue(query.sort),
    }
  }, [query])

  const updateQuery = (updates: Partial<DocumentListQuery>) => {
    setQuery(prev => ({ ...prev, ...updates }))
  }

  const resetQuery = () => {
    setQuery(DEFAULT_QUERY)
  }

  return {
    query: finalQuery,
    updateQuery,
    resetQuery,
  }
}

export default useDocumentListQueryState

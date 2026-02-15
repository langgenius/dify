import type { SortType } from '@/service/datasets'
import { createParser, useQueryStates } from 'nuqs'
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

const parseAsPage = createParser<number>({
  parse: (value) => {
    const n = Number.parseInt(value, 10)
    return Number.isNaN(n) || n <= 0 ? null : n
  },
  serialize: value => value.toString(),
}).withDefault(1)

const parseAsLimit = createParser<number>({
  parse: (value) => {
    const n = Number.parseInt(value, 10)
    return Number.isNaN(n) || n <= 0 || n > 100 ? null : n
  },
  serialize: value => value.toString(),
}).withDefault(10)

const parseAsDocStatus = createParser<string>({
  parse: value => sanitizeStatusValue(value),
  serialize: value => value,
}).withDefault('all')

const parseAsDocSort = createParser<SortType>({
  parse: value => sanitizeSortValue(value),
  serialize: value => value,
}).withDefault('-created_at' as SortType)

const parseAsKeyword = createParser<string>({
  parse: (value) => {
    if (!value)
      return ''
    try {
      // Backward compatibility: legacy URLs may contain double-encoded keywords.
      return decodeURIComponent(value)
    }
    catch {
      return value
    }
  },
  serialize: value => value,
}).withDefault('')

export const documentListParsers = {
  page: parseAsPage,
  limit: parseAsLimit,
  keyword: parseAsKeyword,
  status: parseAsDocStatus,
  sort: parseAsDocSort,
}

function useDocumentListQueryState() {
  const [query, setQuery] = useQueryStates(documentListParsers, {
    history: 'push',
  })

  const updateQuery = useCallback((updates: Partial<DocumentListQuery>) => {
    const patch = { ...updates }
    if ('status' in patch)
      patch.status = sanitizeStatusValue(patch.status)
    if ('sort' in patch)
      patch.sort = sanitizeSortValue(patch.sort)
    setQuery(patch)
  }, [setQuery])

  const resetQuery = useCallback(() => {
    setQuery(null)
  }, [setQuery])

  return useMemo(() => ({
    query,
    updateQuery,
    resetQuery,
  }), [query, updateQuery, resetQuery])
}

export default useDocumentListQueryState

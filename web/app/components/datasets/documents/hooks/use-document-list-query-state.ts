import type { inferParserType } from 'nuqs'
import type { SortType } from '@/service/datasets'
import { createParser, parseAsString, throttle, useQueryStates } from 'nuqs'
import { useCallback, useMemo } from 'react'
import { sanitizeStatusValue } from '../status-filter'

const ALLOWED_SORT_VALUES: SortType[] = ['-created_at', 'created_at', '-hit_count', 'hit_count']

const sanitizeSortValue = (value?: string | null): SortType => {
  if (!value)
    return '-created_at'

  return (ALLOWED_SORT_VALUES.includes(value as SortType) ? value : '-created_at') as SortType
}

const sanitizePageValue = (value: number): number => {
  return Number.isInteger(value) && value > 0 ? value : 1
}

const sanitizeLimitValue = (value: number): number => {
  return Number.isInteger(value) && value > 0 && value <= 100 ? value : 10
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

const parseAsKeyword = parseAsString.withDefault('')

export const documentListParsers = {
  page: parseAsPage,
  limit: parseAsLimit,
  keyword: parseAsKeyword,
  status: parseAsDocStatus,
  sort: parseAsDocSort,
}

export type DocumentListQuery = inferParserType<typeof documentListParsers>

// Search input updates can be frequent; throttle URL writes to reduce history/api churn.
const KEYWORD_URL_UPDATE_THROTTLE = throttle(300)

export function useDocumentListQueryState() {
  const [query, setQuery] = useQueryStates(documentListParsers)

  const updateQuery = useCallback((updates: Partial<DocumentListQuery>) => {
    const patch = { ...updates }
    if ('page' in patch && patch.page !== undefined)
      patch.page = sanitizePageValue(patch.page)
    if ('limit' in patch && patch.limit !== undefined)
      patch.limit = sanitizeLimitValue(patch.limit)
    if ('status' in patch)
      patch.status = sanitizeStatusValue(patch.status)
    if ('sort' in patch)
      patch.sort = sanitizeSortValue(patch.sort)
    if ('keyword' in patch && typeof patch.keyword === 'string' && patch.keyword.trim() === '')
      patch.keyword = ''

    // If keyword is part of this patch (even with page reset), treat it as a search update:
    // use replace to avoid creating a history entry per input-driven change.
    if ('keyword' in patch) {
      setQuery(patch, {
        history: 'replace',
        limitUrlUpdates: patch.keyword === '' ? undefined : KEYWORD_URL_UPDATE_THROTTLE,
      })
      return
    }

    setQuery(patch, { history: 'push' })
  }, [setQuery])

  const resetQuery = useCallback(() => {
    setQuery(null, { history: 'replace' })
  }, [setQuery])

  return useMemo(() => ({
    query,
    updateQuery,
    resetQuery,
  }), [query, updateQuery, resetQuery])
}

import type { inferParserType } from 'nuqs'
import { debounce, parseAsArrayOf, parseAsBoolean, parseAsString, useQueryStates } from 'nuqs'
import { useCallback, useMemo } from 'react'
import { APP_LIST_SEARCH_DEBOUNCE_MS } from '../constants'

const appListQueryParsers = {
  tagIDs: parseAsArrayOf(parseAsString, ';').withDefault([]),
  keywords: parseAsString.withDefault('').withOptions({
    shallow: false,
    limitUrlUpdates: debounce(APP_LIST_SEARCH_DEBOUNCE_MS),
  }),
  isCreatedByMe: parseAsBoolean.withDefault(false),
}

export type AppsQuery = inferParserType<typeof appListQueryParsers>

export function useAppsQueryState() {
  const [query, setQuery] = useQueryStates(appListQueryParsers)

  const setKeywords = useCallback((keywords: string) => {
    setQuery({ keywords })
  }, [setQuery])

  const setTagIDs = useCallback((tagIDs: string[]) => {
    setQuery({ tagIDs }, { history: 'push' })
  }, [setQuery])

  const setIsCreatedByMe = useCallback((isCreatedByMe: boolean) => {
    setQuery({ isCreatedByMe }, { history: 'push' })
  }, [setQuery])

  return useMemo(() => ({
    query,
    setKeywords,
    setTagIDs,
    setIsCreatedByMe,
  }), [query, setKeywords, setTagIDs, setIsCreatedByMe])
}

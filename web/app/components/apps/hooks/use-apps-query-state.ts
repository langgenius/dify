import type { AppListCategory } from '../app-type-filter-shared'
import { debounce, parseAsString, useQueryStates } from 'nuqs'
import { useCallback, useMemo } from 'react'
import { parseAsAppListCategory } from '../app-type-filter-shared'
import { APP_LIST_SEARCH_DEBOUNCE_MS } from '../constants'

const appListQueryParsers = {
  category: parseAsAppListCategory,
  keywords: parseAsString.withDefault('').withOptions({
    limitUrlUpdates: debounce(APP_LIST_SEARCH_DEBOUNCE_MS),
  }),
  creatorID: parseAsString
    .withDefault('')
    .withOptions({ history: 'push' }),
}

export function useAppsQueryState() {
  const [query, setQuery] = useQueryStates(appListQueryParsers)

  const setCategory = useCallback((category: AppListCategory) => {
    setQuery({ category })
  }, [setQuery])

  const setKeywords = useCallback((keywords: string) => {
    setQuery({ keywords })
  }, [setQuery])

  const setCreatorID = useCallback((creatorID: string) => {
    setQuery({ creatorID })
  }, [setQuery])

  return useMemo(() => ({
    query,
    setCategory,
    setKeywords,
    setCreatorID,
  }), [query, setCategory, setKeywords, setCreatorID])
}

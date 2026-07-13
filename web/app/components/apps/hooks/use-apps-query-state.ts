import type { AppListCategory } from '../app-type-filter-shared'
import { debounce, parseAsString, useQueryStates } from 'nuqs'
import { useCallback, useMemo, useState } from 'react'
import { parseAsAppListCategory } from '../app-type-filter-shared'
import { APP_LIST_SEARCH_DEBOUNCE_MS } from '../constants'

const appListQueryParsers = {
  category: parseAsAppListCategory,
  keywords: parseAsString.withDefault('').withOptions({
    limitUrlUpdates: debounce(APP_LIST_SEARCH_DEBOUNCE_MS),
  }),
}

export function useAppsQueryState() {
  const [urlQuery, setUrlQuery] = useQueryStates(appListQueryParsers)
  const [creatorIDs, setCreatorIDs] = useState<string[]>([])

  const setCategory = useCallback(
    (category: AppListCategory) => {
      setUrlQuery({ category })
    },
    [setUrlQuery],
  )

  const setKeywords = useCallback(
    (keywords: string) => {
      setUrlQuery({ keywords })
    },
    [setUrlQuery],
  )

  const handleSetCreatorIDs = useCallback((creatorIDs: string[]) => {
    setCreatorIDs(creatorIDs)
  }, [])

  const query = useMemo(
    () => ({
      ...urlQuery,
      creatorIDs,
    }),
    [creatorIDs, urlQuery],
  )

  return useMemo(
    () => ({
      query,
      setCategory,
      setKeywords,
      setCreatorIDs: handleSetCreatorIDs,
    }),
    [handleSetCreatorIDs, query, setCategory, setKeywords],
  )
}

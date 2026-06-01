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
  const [creatorID, setCreatorID] = useState('')

  const setCategory = useCallback((category: AppListCategory) => {
    setUrlQuery({ category })
  }, [setUrlQuery])

  const setKeywords = useCallback((keywords: string) => {
    setUrlQuery({ keywords })
  }, [setUrlQuery])

  const handleSetCreatorID = useCallback((creatorID: string) => {
    setCreatorID(creatorID)
  }, [])

  const query = useMemo(() => ({
    ...urlQuery,
    creatorID,
  }), [creatorID, urlQuery])

  return useMemo(() => ({
    query,
    setCategory,
    setKeywords,
    setCreatorID: handleSetCreatorID,
  }), [handleSetCreatorID, query, setCategory, setKeywords])
}

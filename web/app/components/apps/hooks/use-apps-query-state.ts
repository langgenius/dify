import { debounce, parseAsArrayOf, parseAsBoolean, parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppModes } from '@/types/app'
import { APP_LIST_SEARCH_DEBOUNCE_MS } from '../constants'

const APP_LIST_CATEGORY_VALUES = ['all', ...AppModes] as const
export type AppListCategory = typeof APP_LIST_CATEGORY_VALUES[number]

const appListCategorySet = new Set<string>(APP_LIST_CATEGORY_VALUES)

export const isAppListCategory = (value: string): value is AppListCategory => {
  return appListCategorySet.has(value)
}

const appListQueryParsers = {
  category: parseAsStringLiteral(APP_LIST_CATEGORY_VALUES)
    .withDefault('all')
    .withOptions({ history: 'push' }),
  tagIDs: parseAsArrayOf(parseAsString, ';')
    .withDefault([])
    .withOptions({ history: 'push' }),
  keywords: parseAsString.withDefault('').withOptions({
    limitUrlUpdates: debounce(APP_LIST_SEARCH_DEBOUNCE_MS),
  }),
  isCreatedByMe: parseAsBoolean
    .withDefault(false)
    .withOptions({ history: 'push' }),
}

export function useAppsQueryState() {
  // eslint-disable-next-line react/use-state -- custom URL query hook, not React.useState
  const [{ tagIDs: urlTagIDs, ...urlQuery }, setQuery] = useQueryStates(appListQueryParsers)
  const [tagIDs, setTagIDs] = useState<string[]>([])

  useEffect(() => {
    if (urlTagIDs.length) {
      // eslint-disable-next-line react/set-state-in-effect -- removes legacy URL-only state while preserving other filters
      setQuery({ tagIDs: null }, { history: 'replace' })
    }
  }, [setQuery, urlTagIDs])

  const setCategory = useCallback((category: AppListCategory) => {
    setQuery({ category })
  }, [setQuery])

  const setKeywords = useCallback((keywords: string) => {
    setQuery({ keywords })
  }, [setQuery])

  const setIsCreatedByMe = useCallback((isCreatedByMe: boolean) => {
    setQuery({ isCreatedByMe })
  }, [setQuery])

  return useMemo(() => ({
    query: {
      ...urlQuery,
      tagIDs,
    },
    setCategory,
    setKeywords,
    setTagIDs,
    setIsCreatedByMe,
  }), [urlQuery, tagIDs, setCategory, setKeywords, setTagIDs, setIsCreatedByMe])
}

import { debounce, parseAsArrayOf, parseAsBoolean, parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs'
import { useCallback, useMemo } from 'react'
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
  const [query, setQuery] = useQueryStates(appListQueryParsers)

  const setCategory = useCallback((category: AppListCategory) => {
    setQuery({ category })
  }, [setQuery])

  const setKeywords = useCallback((keywords: string) => {
    setQuery({ keywords })
  }, [setQuery])

  const setTagIDs = useCallback((tagIDs: string[]) => {
    setQuery({ tagIDs })
  }, [setQuery])

  const setIsCreatedByMe = useCallback((isCreatedByMe: boolean) => {
    setQuery({ isCreatedByMe })
  }, [setQuery])

  return useMemo(() => ({
    query,
    setCategory,
    setKeywords,
    setTagIDs,
    setIsCreatedByMe,
  }), [query, setCategory, setKeywords, setTagIDs, setIsCreatedByMe])
}

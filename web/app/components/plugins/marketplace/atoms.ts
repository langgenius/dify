import type { PluginsSort, SearchParamsFromCollection } from './types'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useQueryState } from 'nuqs'
import { useCallback } from 'react'
import { DEFAULT_SORT, getValidatedPluginCategory, getValidatedTemplateCategory, PLUGIN_CATEGORY_WITH_COLLECTIONS } from './constants'
import type { SearchTab } from './search-params'
import { marketplaceSearchParamsParsers } from './search-params'

const marketplaceSortAtom = atom<PluginsSort>(DEFAULT_SORT)
export function useMarketplaceSort() {
  return useAtom(marketplaceSortAtom)
}
export function useMarketplaceSortValue() {
  return useAtomValue(marketplaceSortAtom)
}
export function useSetMarketplaceSort() {
  return useSetAtom(marketplaceSortAtom)
}

export function useSearchText() {
  return useQueryState('q', marketplaceSearchParamsParsers.q)
}
export function useActivePluginCategory() {
  const [category, setCategory] = useQueryState('category', marketplaceSearchParamsParsers.category)
  return [getValidatedPluginCategory(category), setCategory] as const
}

export function useActiveTemplateCategory() {
  const [category, setCategory] = useQueryState('category', marketplaceSearchParamsParsers.category)
  return [getValidatedTemplateCategory(category), setCategory] as const
}
export function useFilterPluginTags() {
  return useQueryState('tags', marketplaceSearchParamsParsers.tags)
}

export function useSearchTab() {
  return useQueryState('searchTab', marketplaceSearchParamsParsers.searchTab)
}

/**
 * Not all categories have collections, so we need to
 * force the search mode for those categories.
 */
export const searchModeAtom = atom<true | null>(null)

export function useMarketplaceSearchMode() {
  // const [searchText] = useSearchText()
  const [searchTab] = useSearchTab()
  // const [filterPluginTags] = useFilterPluginTags()
  const [activePluginCategory] = useActivePluginCategory()

  const searchMode = useAtomValue(searchModeAtom)
  const isSearchMode = searchTab
    || (searchMode ?? (!PLUGIN_CATEGORY_WITH_COLLECTIONS.has(activePluginCategory)))
  return isSearchMode
}

export function useMarketplaceMoreClick() {
  const [, setQ] = useSearchText()
  const [, setSearchTab] = useSearchTab()
  const setSort = useSetAtom(marketplaceSortAtom)
  const setSearchMode = useSetAtom(searchModeAtom)

  return useCallback((searchParams?: SearchParamsFromCollection, searchTab?: SearchTab) => {
    if (!searchParams)
      return
    setQ(searchParams?.query || '')
    setSort({
      sortBy: searchParams?.sort_by || DEFAULT_SORT.sortBy,
      sortOrder: searchParams?.sort_order || DEFAULT_SORT.sortOrder,
    })
    setSearchMode(true)
    if (searchTab)
      setSearchTab(searchTab)
  }, [setQ, setSearchTab, setSort, setSearchMode])
}

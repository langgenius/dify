import type { PluginsSort, SearchParamsFromCollection } from './types'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useQueryState } from 'nuqs'
import { useCallback } from 'react'
import { DEFAULT_SORT, PLUGIN_CATEGORY_WITH_COLLECTIONS } from './constants'
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

export function useSearchPluginText() {
  return useQueryState('q', marketplaceSearchParamsParsers.q)
}
export function useActivePluginType() {
  return useQueryState('category', marketplaceSearchParamsParsers.category)
}
export function useFilterPluginTags() {
  return useQueryState('tags', marketplaceSearchParamsParsers.tags)
}

/**
 * Not all categories have collections, so we need to
 * force the search mode for those categories.
 */
export const searchModeAtom = atom<true | null>(null)

export function useMarketplaceSearchMode() {
  const [searchPluginText] = useSearchPluginText()
  const [filterPluginTags] = useFilterPluginTags()
  const [activePluginType] = useActivePluginType()

  const searchMode = useAtomValue(searchModeAtom)
  const isSearchMode = !!searchPluginText
    || filterPluginTags.length > 0
    || (searchMode ?? (!PLUGIN_CATEGORY_WITH_COLLECTIONS.has(activePluginType)))
  return isSearchMode
}

export function useMarketplaceMoreClick() {
  const [,setQ] = useSearchPluginText()
  const setSort = useSetAtom(marketplaceSortAtom)
  const setSearchMode = useSetAtom(searchModeAtom)

  return useCallback((searchParams?: SearchParamsFromCollection) => {
    if (!searchParams)
      return
    setQ(searchParams?.query || '')
    setSort({
      sortBy: searchParams?.sort_by || DEFAULT_SORT.sortBy,
      sortOrder: searchParams?.sort_order || DEFAULT_SORT.sortOrder,
    })
    setSearchMode(true)
  }, [setQ, setSort, setSearchMode])
}

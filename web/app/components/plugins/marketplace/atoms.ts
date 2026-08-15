import type { PluginsSort, SearchParamsFromCollection } from '@dify/contracts/marketplace'
import type { ActivePluginType } from './constants'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useQueryState } from 'nuqs'
import { useCallback, useEffect } from 'react'
import { DEFAULT_SORT, PLUGIN_CATEGORY_WITH_COLLECTIONS } from './constants'
import { marketplaceSearchParamsParsers } from './search-params'

const marketplaceSortAtom = atom<PluginsSort>(DEFAULT_SORT)
export function useMarketplaceSort() {
  return useAtom(marketplaceSortAtom)
}
export function useMarketplaceSortValue() {
  return useAtomValue(marketplaceSortAtom)
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

export function useMarketplaceSearchMode(activePluginTypeOverride?: ActivePluginType) {
  const [searchPluginText] = useSearchPluginText()
  const [filterPluginTags] = useFilterPluginTags()
  const [activePluginTypeFromUrl] = useActivePluginType()
  const activePluginType = activePluginTypeOverride ?? activePluginTypeFromUrl

  const searchMode = useAtomValue(searchModeAtom)
  const isSearchMode =
    !!searchPluginText ||
    filterPluginTags.length > 0 ||
    (searchMode ?? !PLUGIN_CATEGORY_WITH_COLLECTIONS.has(activePluginType))
  return isSearchMode
}

/**
 * The forced search mode lives in the app-wide Jotai store, so a "View More"
 * click would otherwise leak into the next visit of the plugin catalog after
 * navigating away (e.g. to /templates) and back, rendering empty-query search
 * results instead of the prefetched collections. Reset it when the catalog
 * route mounts; URL-owned state (q, tags, category) is not affected.
 */
export function useResetMarketplaceSearchModeOnMount() {
  const setSearchMode = useSetAtom(searchModeAtom)

  useEffect(() => {
    setSearchMode(null)
  }, [setSearchMode])
}

export function useMarketplaceMoreClick() {
  const [, setQ] = useSearchPluginText()
  const setSort = useSetAtom(marketplaceSortAtom)
  const setSearchMode = useSetAtom(searchModeAtom)

  return useCallback(
    (searchParams?: SearchParamsFromCollection) => {
      if (!searchParams) return
      setQ(searchParams?.query || '')
      setSort({
        sortBy: searchParams?.sort_by || DEFAULT_SORT.sortBy,
        sortOrder: searchParams?.sort_order || DEFAULT_SORT.sortOrder,
      })
      setSearchMode(true)
    },
    [setQ, setSort, setSearchMode],
  )
}

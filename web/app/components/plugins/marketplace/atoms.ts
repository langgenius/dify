import type { ActivePluginType } from './constants'
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

/**
 * Preserve the state for marketplace
 */
export const preserveSearchStateInQueryAtom = atom<boolean>(false)

const searchPluginTextAtom = atom<string>('')
const activePluginTypeAtom = atom<ActivePluginType>('all')
const filterPluginTagsAtom = atom<string[]>([])

export function useSearchPluginText() {
  const preserveSearchStateInQuery = useAtomValue(preserveSearchStateInQueryAtom)
  const queryState = useQueryState('q', marketplaceSearchParamsParsers.q)
  const atomState = useAtom(searchPluginTextAtom)
  return preserveSearchStateInQuery ? queryState : atomState
}
export function useActivePluginType() {
  const preserveSearchStateInQuery = useAtomValue(preserveSearchStateInQueryAtom)
  const queryState = useQueryState('category', marketplaceSearchParamsParsers.category)
  const atomState = useAtom(activePluginTypeAtom)
  return preserveSearchStateInQuery ? queryState : atomState
}
export function useFilterPluginTags() {
  const preserveSearchStateInQuery = useAtomValue(preserveSearchStateInQueryAtom)
  const queryState = useQueryState('tags', marketplaceSearchParamsParsers.tags)
  const atomState = useAtom(filterPluginTagsAtom)
  return preserveSearchStateInQuery ? queryState : atomState
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

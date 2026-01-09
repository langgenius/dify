import type { ActivePluginType } from './constants'
import type { PluginsSort } from './types'
import { atom, useAtom, useAtomValue } from 'jotai'
import { useQueryState } from 'nuqs'
import { DEFAULT_SORT, PLUGIN_CATEGORY_WITH_COLLECTIONS } from './constants'
import { marketplaceSearchParamsParsers } from './search-params'

export const marketplaceSortAtom = atom<PluginsSort>(DEFAULT_SORT)

/**
 * Preserve the state for marketplace
 */
export const preserveSearchStateInQueryAtom = atom<boolean>(false)

export const searchPluginTextAtom = atom<string>('')
export const activePluginTypeAtom = atom<ActivePluginType>('all')
export const filterPluginTagsAtom = atom<string[]>([])

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

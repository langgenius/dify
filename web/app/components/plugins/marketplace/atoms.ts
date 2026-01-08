import type { PluginsSort } from './types'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { DEFAULT_SORT, PLUGIN_CATEGORY_WITH_COLLECTIONS } from './constants'
import { useActivePluginType, useFilterPluginTags, useSearchPluginText } from './state'

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
 * Not all categories have collections, so we need to
 * force the search mode for those categories.
 */
const searchModeAtom = atom<true | null>(null)

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

export function useSetSearchMode() {
  return useSetAtom(searchModeAtom)
}

import type { PluginsSort } from './types'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useMarketplaceCategory, useMarketplaceSearchQuery, useMarketplaceTags } from '@/hooks/use-query-params'
import { DEFAULT_SORT, PLUGIN_CATEGORY_WITH_COLLECTIONS } from './constants'

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

const searchModeAtom = atom<true | null>(null)

export function useMarketplaceSearchMode() {
  const [searchPluginText] = useMarketplaceSearchQuery()
  const [filterPluginTags] = useMarketplaceTags()
  const [activePluginType] = useMarketplaceCategory()

  const searchMode = useAtomValue(searchModeAtom)
  const isSearchMode = !!searchPluginText
    || filterPluginTags.length > 0
    || (searchMode ?? (!PLUGIN_CATEGORY_WITH_COLLECTIONS.has(activePluginType)))
  return isSearchMode
}

export function useSetSearchMode() {
  return useSetAtom(searchModeAtom)
}

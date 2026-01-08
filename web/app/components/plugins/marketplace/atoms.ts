import type { PluginsSort } from './types'
import { atom, getDefaultStore, useAtom, useAtomValue, useSetAtom } from 'jotai'
import { useMarketplaceSearchQuery, useMarketplaceTags } from '@/hooks/use-query-params'
import { DEFAULT_SORT } from './constants'

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

const searchModeAtom = atom(false)

export function useMarketplaceSearchMode() {
  const [searchPluginText] = useMarketplaceSearchQuery()
  const [filterPluginTags] = useMarketplaceTags()

  const searchMode = useAtomValue(searchModeAtom)
  const isSearchMode = !!searchPluginText
    || filterPluginTags.length > 0
    || searchMode
  return isSearchMode
}

export function setSearchMode(mode: boolean) {
  getDefaultStore().set(searchModeAtom, mode)
}

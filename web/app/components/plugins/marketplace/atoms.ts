import type { PluginsSort } from './types'
import { atom, useAtom, useAtomValue } from 'jotai'
import { DEFAULT_SORT } from './constants'

// Sort state - not persisted in URL
const marketplaceSortAtom = atom<PluginsSort>(DEFAULT_SORT)

export function useMarketplaceSort() {
  return useAtom(marketplaceSortAtom)
}

export function useMarketplaceSortValue() {
  return useAtomValue(marketplaceSortAtom)
}

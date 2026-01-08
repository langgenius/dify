import type { PluginsSort } from './types'
import { atom, useAtom, useAtomValue, useSetAtom } from 'jotai'
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

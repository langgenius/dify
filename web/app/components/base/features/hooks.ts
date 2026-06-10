import type { StoreApi } from 'zustand'
import type { FeatureStoreState } from './store'
import { useContextStore, useContextStoreApi } from '@/stores/create-context-store'
import { FeaturesContext } from './context'

export function useFeatures<T>(selector: (state: FeatureStoreState) => T): T {
  return useContextStore(FeaturesContext, selector)
}

export function useFeaturesStore(): StoreApi<FeatureStoreState> {
  return useContextStoreApi(FeaturesContext)
}

import { use } from 'react'
import { useStore } from 'zustand'
import { FeaturesContext } from './context'
import type { FeatureStoreState } from './store'

export function useFeatures<T>(selector: (state: FeatureStoreState) => T): T {
  const store = use(FeaturesContext)
  if (!store)
    throw new Error('Missing FeaturesContext.Provider in the tree')

  return useStore(store, selector)
}

export function useFeaturesStore() {
  return use(FeaturesContext)
}

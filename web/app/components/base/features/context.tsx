import type {
  FeaturesState,
  FeatureStoreState,
} from './store'
import { createStoreContext, useStoreRef } from '@/stores/create-context-store'
import { createFeaturesStore } from './store'

export const FeaturesContext = createStoreContext<FeatureStoreState>('Features')

type FeaturesProviderProps = {
  children: React.ReactNode
} & Partial<FeaturesState>
export function FeaturesProvider({ children, ...props }: FeaturesProviderProps) {
  const store = useStoreRef(() => createFeaturesStore(props))

  return (
    <FeaturesContext.Provider value={store}>
      {children}
    </FeaturesContext.Provider>
  )
}

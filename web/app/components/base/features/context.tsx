import type { FeaturesState, FeaturesStore } from './store'
import { createContext, useState } from 'react'
import { createFeaturesStore } from './store'

export const FeaturesContext = createContext<FeaturesStore | null>(null)

type FeaturesProviderProps = {
  children: React.ReactNode
} & Partial<FeaturesState>
export const FeaturesProvider = ({ children, ...props }: FeaturesProviderProps) => {
  const [store] = useState(() => createFeaturesStore(props))

  return <FeaturesContext.Provider value={store}>{children}</FeaturesContext.Provider>
}

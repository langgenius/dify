import type {
  FeaturesState,
  FeaturesStore,
} from './store'
import {
  createContext,
  useRef,
} from 'react'
import { createFeaturesStore } from './store'

export const FeaturesContext = createContext<FeaturesStore | null>(null)

type FeaturesProviderProps = {
  children: React.ReactNode
} & Partial<FeaturesState>
export const FeaturesProvider = ({ children, ...props }: FeaturesProviderProps) => {
  const storeRef = useRef<FeaturesStore | undefined>(undefined)

  if (!storeRef.current)
    storeRef.current = createFeaturesStore(props)

  return (
    <FeaturesContext.Provider value={storeRef.current}>
      {children}
    </FeaturesContext.Provider>
  )
}

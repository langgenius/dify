import {
  useRef,
} from 'react'
import type {
  FeaturesState,
  FeaturesStore,
} from './store'
import { createFeaturesStore } from './store'
import { createCtx } from '@/utils/context'

export const [, , FeaturesContext] = createCtx<FeaturesStore>()

type FeaturesProviderProps = {
  children: React.ReactNode
} & Partial<FeaturesState>
export const FeaturesProvider = ({ children, ...props }: FeaturesProviderProps) => {
  const storeRef = useRef<FeaturesStore>()

  if (!storeRef.current)
    storeRef.current = createFeaturesStore(props)

  return (
    <FeaturesContext.Provider value={storeRef.current}>
      {children}
    </FeaturesContext.Provider>
  )
}

import type { FeaturesState, FeaturesStore } from './store'
import type { Features } from './types'
import { createContext, useRef } from 'react'
import { createFeaturesStore } from './store'

export const FeaturesContext = createContext<FeaturesStore | null>(null)

type FeaturesProviderProps = {
  children: React.ReactNode
  onFeaturesChange?: (features: Features) => void
} & Partial<FeaturesState>
export const FeaturesProvider = ({
  children,
  onFeaturesChange,
  ...props
}: FeaturesProviderProps) => {
  const storeRef = useRef<FeaturesStore | undefined>(undefined)
  const onFeaturesChangeRef = useRef(onFeaturesChange)
  onFeaturesChangeRef.current = onFeaturesChange

  if (!storeRef.current)
    storeRef.current = createFeaturesStore(props, (features) =>
      onFeaturesChangeRef.current?.(features),
    )

  return <FeaturesContext.Provider value={storeRef.current}>{children}</FeaturesContext.Provider>
}

'use client'

import type { ReactNode } from 'react'
import { useState } from 'react'
import {
  createContext,
  useContextSelector,
} from 'use-context-selector'

export type MarketplaceContextValue = {
  scrollIntersected: boolean
  setScrollIntersected: (scrollIntersected: boolean) => void
}

export const MarketplaceContext = createContext<MarketplaceContextValue>({
  scrollIntersected: false,
  setScrollIntersected: () => {},
})

type MarketplaceContextProviderProps = {
  children: ReactNode
}

export function useMarketplaceContext(selector: (value: MarketplaceContextValue) => any) {
  return useContextSelector(MarketplaceContext, selector)
}

export const MarketplaceContextProvider = ({
  children,
}: MarketplaceContextProviderProps) => {
  const [scrollIntersected, setScrollIntersected] = useState(false)

  return (
    <MarketplaceContext.Provider value={{
      scrollIntersected,
      setScrollIntersected,
    }}>
      {children}
    </MarketplaceContext.Provider>
  )
}

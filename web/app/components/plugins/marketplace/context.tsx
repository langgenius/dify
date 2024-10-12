'use client'

import type { ReactNode } from 'react'
import {
  useState,
} from 'react'
import {
  createContext,
  useContextSelector,
} from 'use-context-selector'

export type MarketplaceContextValue = {
  intersected: boolean
  setIntersected: (intersected: boolean) => void
}

export const MarketplaceContext = createContext<MarketplaceContextValue>({
  intersected: true,
  setIntersected: () => {},
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
  const [intersected, setIntersected] = useState(true)

  return (
    <MarketplaceContext.Provider
      value={{
        intersected,
        setIntersected,
      }}
    >
      {children}
    </MarketplaceContext.Provider>
  )
}

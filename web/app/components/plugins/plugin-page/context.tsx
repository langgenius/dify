'use client'

import type { ReactNode } from 'react'
import { useRef } from 'react'
import { createContext } from 'use-context-selector'

export type PluginPageContextValue = {
  containerRef: React.RefObject<HTMLDivElement>
}

export const PluginPageContext = createContext<PluginPageContextValue>({
  containerRef: { current: null },
})

type PluginPageContextProviderProps = {
  children: ReactNode
}

export const PluginPageContextProvider = ({
  children,
}: PluginPageContextProviderProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  return (
    <PluginPageContext.Provider value={{
      containerRef,
    }}>
      {children}
    </PluginPageContext.Provider>
  )
}

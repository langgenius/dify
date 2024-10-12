'use client'

import type { ReactNode } from 'react'
import {
  useRef,
  useState,
} from 'react'
import {
  createContext,
  useContextSelector,
} from 'use-context-selector'

export type PluginPageContextValue = {
  containerRef: React.RefObject<HTMLDivElement>
  scrollDisabled: boolean
  setScrollDisabled: (scrollDisabled: boolean) => void
}

export const PluginPageContext = createContext<PluginPageContextValue>({
  containerRef: { current: null },
  scrollDisabled: false,
  setScrollDisabled: () => {},
})

type PluginPageContextProviderProps = {
  children: ReactNode
}

export function usePluginPageContext(selector: (value: PluginPageContextValue) => any) {
  return useContextSelector(PluginPageContext, selector)
}

export const PluginPageContextProvider = ({
  children,
}: PluginPageContextProviderProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollDisabled, setScrollDisabled] = useState(false)

  return (
    <PluginPageContext.Provider
      value={{
        containerRef,
        scrollDisabled,
        setScrollDisabled,
      }}
    >
      {children}
    </PluginPageContext.Provider>
  )
}

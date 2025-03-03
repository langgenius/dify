'use client'
import { useCallback, useEffect, useState } from 'react'
import { createContext, useContextSelector } from 'use-context-selector'
import type { FC, ReactNode } from 'react'
import { Theme } from '@/types/app'

export type SharePageContextValue = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const SharePageContext = createContext<SharePageContextValue>({
  theme: Theme.light,
  setTheme: () => { },
})

export function useSelector<T>(selector: (value: SharePageContextValue) => T): T {
  return useContextSelector(SharePageContext, selector)
}

export type SharePageContextProviderProps = {
  children: ReactNode
}

export const SharePageContextProvider: FC<SharePageContextProviderProps> = ({ children }) => {
  const [theme, setTheme] = useState<Theme>(Theme.light)
  const handleSetTheme = useCallback((theme: Theme) => {
    setTheme(theme)
    globalThis.document.documentElement.setAttribute('data-theme', theme)
  }, [])

  useEffect(() => {
    globalThis.document.documentElement.setAttribute('data-theme', theme)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <SharePageContext.Provider value={{
      theme,
      setTheme: handleSetTheme,
    }}>
      {children}
    </SharePageContext.Provider>
  )
}

export default SharePageContextProvider

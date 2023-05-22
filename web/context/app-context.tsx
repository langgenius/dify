'use client'

import { createContext, useContext, useContextSelector } from 'use-context-selector'
import type { App } from '@/types/app'
import type { UserProfileResponse } from '@/models/common'
import { createRef, FC, PropsWithChildren } from 'react'

export const useSelector = <T extends any>(selector: (value: AppContextValue) => T): T =>
  useContextSelector(AppContext, selector);

export type AppContextValue = {
  apps: App[]
  mutateApps: () => void
  userProfile: UserProfileResponse
  mutateUserProfile: () => void
  pageContainerRef: React.RefObject<HTMLDivElement>,
  useSelector: typeof useSelector,
}

const AppContext = createContext<AppContextValue>({
  apps: [],
  mutateApps: () => { },
  userProfile: {
    id: '',
    name: '',
    email: '',
  },
  mutateUserProfile: () => { },
  pageContainerRef: createRef(),
  useSelector,
})

export type AppContextProviderProps = PropsWithChildren<{
  value: Omit<AppContextValue, 'useSelector'>
}>

export const AppContextProvider: FC<AppContextProviderProps> = ({ value, children }) => (
  <AppContext.Provider value={{ ...value, useSelector }}>
    {children}
  </AppContext.Provider>
)

export const useAppContext = () => useContext(AppContext)

export default AppContext

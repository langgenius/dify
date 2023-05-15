'use client'

import { createContext, useContext } from 'use-context-selector'
import type { App } from '@/types/app'
import type { UserProfileResponse } from '@/models/common'

export type AppContextValue = {
  apps: App[]
  mutateApps: () => void
  userProfile: UserProfileResponse
  mutateUserProfile: () => void
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
})

export const useAppContext = () => useContext(AppContext)

export default AppContext

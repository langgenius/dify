'use client'

import { createRef, useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { createContext, useContext, useContextSelector } from 'use-context-selector'
import type { FC, ReactNode } from 'react'
import { fetchAppList } from '@/service/apps'
import Loading from '@/app/components/base/loading'
import { fetchLanggeniusVersion, fetchUserProfile } from '@/service/common'
import type { App } from '@/types/app'
import type { LangGeniusVersionResponse, UserProfileResponse } from '@/models/common'

export type AppContextValue = {
  apps: App[]
  mutateApps: () => void
  userProfile: UserProfileResponse
  mutateUserProfile: () => void
  pageContainerRef: React.RefObject<HTMLDivElement>
  langeniusVersionInfo: LangGeniusVersionResponse
  useSelector: typeof useSelector
}

const initialLangeniusVersionInfo = {
  current_env: '',
  current_version: '',
  latest_version: '',
  release_date: '',
  release_notes: '',
  version: '',
  can_auto_update: false,
}

const AppContext = createContext<AppContextValue>({
  apps: [],
  mutateApps: () => { },
  userProfile: {
    id: '',
    name: '',
    email: '',
    avatar: '',
    is_password_set: false,
  },
  mutateUserProfile: () => { },
  pageContainerRef: createRef(),
  langeniusVersionInfo: initialLangeniusVersionInfo,
  useSelector,
})

export function useSelector<T>(selector: (value: AppContextValue) => T): T {
  return useContextSelector(AppContext, selector)
}

export type AppContextProviderProps = {
  children: ReactNode
}

export const AppContextProvider: FC<AppContextProviderProps> = ({ children }) => {
  const pageContainerRef = useRef<HTMLDivElement>(null)

  const { data: appList, mutate: mutateApps } = useSWR({ url: '/apps', params: { page: 1 } }, fetchAppList)
  const { data: userProfileResponse, mutate: mutateUserProfile } = useSWR({ url: '/account/profile', params: {} }, fetchUserProfile)

  const [userProfile, setUserProfile] = useState<UserProfileResponse>()
  const [langeniusVersionInfo, setLangeniusVersionInfo] = useState<LangGeniusVersionResponse>(initialLangeniusVersionInfo)
  const updateUserProfileAndVersion = async () => {
    if (userProfileResponse && !userProfileResponse.bodyUsed) {
      const result = await userProfileResponse.json()
      setUserProfile(result)
      const current_version = userProfileResponse.headers.get('x-version')
      const current_env = userProfileResponse.headers.get('x-env')
      const versionData = await fetchLanggeniusVersion({ url: '/version', params: { current_version } })
      setLangeniusVersionInfo({ ...versionData, current_version, latest_version: versionData.version, current_env })
    }
  }
  useEffect(() => {
    updateUserProfileAndVersion()
  }, [userProfileResponse])

  if (!appList || !userProfile)
    return <Loading type='app' />

  return (
    <AppContext.Provider value={{ apps: appList.data, mutateApps, userProfile, mutateUserProfile, pageContainerRef, langeniusVersionInfo, useSelector }}>
      <div ref={pageContainerRef} className='relative flex flex-col h-full overflow-auto bg-gray-100'>
        {children}
      </div>
    </AppContext.Provider>
  )
}

export const useAppContext = () => useContext(AppContext)

export default AppContext

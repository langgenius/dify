'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { createContext, useContext, useContextSelector } from 'use-context-selector'
import type { FC, ReactNode } from 'react'
import { fetchCurrentWorkspace, fetchLangGeniusVersion, fetchUserProfile } from '@/service/common'
import type { ICurrentWorkspace, LangGeniusVersionResponse, UserProfileResponse } from '@/models/common'
import MaintenanceNotice from '@/app/components/header/maintenance-notice'
import { noop } from 'lodash-es'
import { setZendeskConversationFields } from '@/app/components/base/zendesk/utils'
import { ZENDESK_FIELD_IDS } from '@/config'

export type AppContextValue = {
  userProfile: UserProfileResponse
  mutateUserProfile: VoidFunction
  currentWorkspace: ICurrentWorkspace
  isCurrentWorkspaceManager: boolean
  isCurrentWorkspaceOwner: boolean
  isCurrentWorkspaceEditor: boolean
  isCurrentWorkspaceDatasetOperator: boolean
  mutateCurrentWorkspace: VoidFunction
  langGeniusVersionInfo: LangGeniusVersionResponse
  useSelector: typeof useSelector
  isLoadingCurrentWorkspace: boolean
}

const userProfilePlaceholder = {
  id: '',
  name: '',
  email: '',
  avatar: '',
  avatar_url: '',
  is_password_set: false,
}

const initialLangGeniusVersionInfo = {
  current_env: '',
  current_version: '',
  latest_version: '',
  release_date: '',
  release_notes: '',
  version: '',
  can_auto_update: false,
}

const initialWorkspaceInfo: ICurrentWorkspace = {
  id: '',
  name: '',
  plan: '',
  status: '',
  created_at: 0,
  role: 'normal',
  providers: [],
}

const AppContext = createContext<AppContextValue>({
  userProfile: userProfilePlaceholder,
  currentWorkspace: initialWorkspaceInfo,
  isCurrentWorkspaceManager: false,
  isCurrentWorkspaceOwner: false,
  isCurrentWorkspaceEditor: false,
  isCurrentWorkspaceDatasetOperator: false,
  mutateUserProfile: noop,
  mutateCurrentWorkspace: noop,
  langGeniusVersionInfo: initialLangGeniusVersionInfo,
  useSelector,
  isLoadingCurrentWorkspace: false,
})

export function useSelector<T>(selector: (value: AppContextValue) => T): T {
  return useContextSelector(AppContext, selector)
}

export type AppContextProviderProps = {
  children: ReactNode
}

export const AppContextProvider: FC<AppContextProviderProps> = ({ children }) => {
  const { data: userProfileResponse, mutate: mutateUserProfile, error: userProfileError } = useSWR({ url: '/account/profile', params: {} }, fetchUserProfile)
  const { data: currentWorkspaceResponse, mutate: mutateCurrentWorkspace, isLoading: isLoadingCurrentWorkspace } = useSWR({ url: '/workspaces/current', params: {} }, fetchCurrentWorkspace)

  const [userProfile, setUserProfile] = useState<UserProfileResponse>(userProfilePlaceholder)
  const [langGeniusVersionInfo, setLangGeniusVersionInfo] = useState<LangGeniusVersionResponse>(initialLangGeniusVersionInfo)
  const [currentWorkspace, setCurrentWorkspace] = useState<ICurrentWorkspace>(initialWorkspaceInfo)
  const isCurrentWorkspaceManager = useMemo(() => ['owner', 'admin'].includes(currentWorkspace.role), [currentWorkspace.role])
  const isCurrentWorkspaceOwner = useMemo(() => currentWorkspace.role === 'owner', [currentWorkspace.role])
  const isCurrentWorkspaceEditor = useMemo(() => ['owner', 'admin', 'editor'].includes(currentWorkspace.role), [currentWorkspace.role])
  const isCurrentWorkspaceDatasetOperator = useMemo(() => currentWorkspace.role === 'dataset_operator', [currentWorkspace.role])
  const updateUserProfileAndVersion = useCallback(async () => {
    if (userProfileResponse && !userProfileResponse.bodyUsed) {
      try {
        const result = await userProfileResponse.json()
        setUserProfile(result)
        const current_version = userProfileResponse.headers.get('x-version')
        const current_env = process.env.NODE_ENV === 'development' ? 'DEVELOPMENT' : userProfileResponse.headers.get('x-env')
        const versionData = await fetchLangGeniusVersion({ url: '/version', params: { current_version } })
        setLangGeniusVersionInfo({ ...versionData, current_version, latest_version: versionData.version, current_env })
      }
      catch (error) {
        console.error('Failed to update user profile:', error)
        if (userProfile.id === '')
          setUserProfile(userProfilePlaceholder)
      }
    }
    else if (userProfileError && userProfile.id === '') {
      setUserProfile(userProfilePlaceholder)
    }
  }, [userProfileResponse, userProfileError, userProfile.id])

  useEffect(() => {
    updateUserProfileAndVersion()
  }, [updateUserProfileAndVersion, userProfileResponse])

  useEffect(() => {
    if (currentWorkspaceResponse)
      setCurrentWorkspace(currentWorkspaceResponse)
  }, [currentWorkspaceResponse])

  // #region Zendesk conversation fields
  useEffect(() => {
    if (ZENDESK_FIELD_IDS.ENVIRONMENT && langGeniusVersionInfo?.current_env) {
      setZendeskConversationFields([{
        id: ZENDESK_FIELD_IDS.ENVIRONMENT,
        value: langGeniusVersionInfo.current_env.toLowerCase(),
      }])
    }
  }, [langGeniusVersionInfo?.current_env])

  useEffect(() => {
    if (ZENDESK_FIELD_IDS.VERSION && langGeniusVersionInfo?.version) {
      setZendeskConversationFields([{
        id: ZENDESK_FIELD_IDS.VERSION,
        value: langGeniusVersionInfo.version,
      }])
    }
  }, [langGeniusVersionInfo?.version])

  useEffect(() => {
    if (ZENDESK_FIELD_IDS.EMAIL && userProfile?.email) {
      setZendeskConversationFields([{
        id: ZENDESK_FIELD_IDS.EMAIL,
        value: userProfile.email,
      }])
    }
  }, [userProfile?.email])

  useEffect(() => {
    if (ZENDESK_FIELD_IDS.WORKSPACE_ID && currentWorkspace?.id) {
      setZendeskConversationFields([{
        id: ZENDESK_FIELD_IDS.WORKSPACE_ID,
        value: currentWorkspace.id,
      }])
    }
  }, [currentWorkspace?.id])
  // #endregion Zendesk conversation fields

  return (
    <AppContext.Provider value={{
      userProfile,
      mutateUserProfile,
      langGeniusVersionInfo,
      useSelector,
      currentWorkspace,
      isCurrentWorkspaceManager,
      isCurrentWorkspaceOwner,
      isCurrentWorkspaceEditor,
      isCurrentWorkspaceDatasetOperator,
      mutateCurrentWorkspace,
      isLoadingCurrentWorkspace,
    }}>
      <div className='flex h-full flex-col overflow-y-auto'>
        {globalThis.document?.body?.getAttribute('data-public-maintenance-notice') && <MaintenanceNotice />}
        <div className='relative flex grow flex-col overflow-y-auto overflow-x-hidden bg-background-body'>
          {children}
        </div>
      </div>
    </AppContext.Provider>
  )
}

export const useAppContext = () => useContext(AppContext)

export default AppContext

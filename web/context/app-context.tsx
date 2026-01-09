'use client'

import type { FC, ReactNode } from 'react'
import type { ICurrentWorkspace, LangGeniusVersionResponse, UserProfileResponse } from '@/models/common'
import { useQueryClient } from '@tanstack/react-query'
import { noop } from 'es-toolkit/function'
import { useCallback, useEffect, useMemo } from 'react'
import { createContext, useContext, useContextSelector } from 'use-context-selector'
import { setUserId, setUserProperties } from '@/app/components/base/amplitude'
import { setZendeskConversationFields } from '@/app/components/base/zendesk/utils'
import MaintenanceNotice from '@/app/components/header/maintenance-notice'
import { ZENDESK_FIELD_IDS } from '@/config'
import {
  useCurrentWorkspace,
  useLangGeniusVersion,
  useUserProfile,
} from '@/service/use-common'
import { useGlobalPublicStore } from './global-public-context'

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
  isValidatingCurrentWorkspace: boolean
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
  trial_credits: 200,
  trial_credits_used: 0,
  next_credit_reset_date: 0,
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
  isValidatingCurrentWorkspace: false,
})

export function useSelector<T>(selector: (value: AppContextValue) => T): T {
  return useContextSelector(AppContext, selector)
}

export type AppContextProviderProps = {
  children: ReactNode
}

export const AppContextProvider: FC<AppContextProviderProps> = ({ children }) => {
  const queryClient = useQueryClient()
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)
  const { data: userProfileResp } = useUserProfile()
  const { data: currentWorkspaceResp, isPending: isLoadingCurrentWorkspace, isFetching: isValidatingCurrentWorkspace } = useCurrentWorkspace()
  const langGeniusVersionQuery = useLangGeniusVersion(
    userProfileResp?.meta.currentVersion,
    !systemFeatures.branding.enabled,
  )

  const userProfile = useMemo<UserProfileResponse>(() => userProfileResp?.profile || userProfilePlaceholder, [userProfileResp?.profile])
  const currentWorkspace = useMemo<ICurrentWorkspace>(() => currentWorkspaceResp || initialWorkspaceInfo, [currentWorkspaceResp])
  const langGeniusVersionInfo = useMemo<LangGeniusVersionResponse>(() => {
    if (!userProfileResp?.meta?.currentVersion || !langGeniusVersionQuery.data)
      return initialLangGeniusVersionInfo

    const current_version = userProfileResp.meta.currentVersion
    const current_env = userProfileResp.meta.currentEnv || ''
    const versionData = langGeniusVersionQuery.data
    return {
      ...versionData,
      current_version,
      latest_version: versionData.version,
      current_env,
    }
  }, [langGeniusVersionQuery.data, userProfileResp?.meta])

  const isCurrentWorkspaceManager = useMemo(() => ['owner', 'admin'].includes(currentWorkspace.role), [currentWorkspace.role])
  const isCurrentWorkspaceOwner = useMemo(() => currentWorkspace.role === 'owner', [currentWorkspace.role])
  const isCurrentWorkspaceEditor = useMemo(() => ['owner', 'admin', 'editor'].includes(currentWorkspace.role), [currentWorkspace.role])
  const isCurrentWorkspaceDatasetOperator = useMemo(() => currentWorkspace.role === 'dataset_operator', [currentWorkspace.role])

  const mutateUserProfile = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['common', 'user-profile'] })
  }, [queryClient])

  const mutateCurrentWorkspace = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['common', 'current-workspace'] })
  }, [queryClient])

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

  useEffect(() => {
    // Report user and workspace info to Amplitude when loaded
    if (userProfile?.id) {
      setUserId(userProfile.email)
      const properties: Record<string, any> = {
        email: userProfile.email,
        name: userProfile.name,
        has_password: userProfile.is_password_set,
      }

      if (currentWorkspace?.id) {
        properties.workspace_id = currentWorkspace.id
        properties.workspace_name = currentWorkspace.name
        properties.workspace_plan = currentWorkspace.plan
        properties.workspace_status = currentWorkspace.status
        properties.workspace_role = currentWorkspace.role
      }

      setUserProperties(properties)
    }
  }, [userProfile, currentWorkspace])

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
      isValidatingCurrentWorkspace,
    }}
    >
      <div className="flex h-full flex-col overflow-y-auto">
        {globalThis.document?.body?.getAttribute('data-public-maintenance-notice') && <MaintenanceNotice />}
        <div className="relative flex grow flex-col overflow-y-auto overflow-x-hidden bg-background-body">
          {children}
        </div>
      </div>
    </AppContext.Provider>
  )
}

export const useAppContext = () => useContext(AppContext)

export default AppContext

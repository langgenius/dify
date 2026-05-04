'use client'

import type { FC, ReactNode } from 'react'
import type { ICurrentWorkspace, LangGeniusVersionResponse, UserProfileResponse } from '@/models/common'
import { useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo } from 'react'
import { setUserId, setUserProperties } from '@/app/components/base/amplitude'
import { setZendeskConversationFields } from '@/app/components/base/zendesk/utils'
import MaintenanceNotice from '@/app/components/header/maintenance-notice'
import { ZENDESK_FIELD_IDS } from '@/config'
import {
  AppContext,
  initialLangGeniusVersionInfo,
  initialWorkspaceInfo,
  userProfilePlaceholder,
  useSelector,
} from '@/context/app-context'
import { env } from '@/env'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import {
  useCurrentWorkspace,
  useLangGeniusVersion,
  userProfileQueryOptions,
} from '@/service/use-common'

type AppContextProviderProps = {
  children: ReactNode
}

export const AppContextProvider: FC<AppContextProviderProps> = ({ children }) => {
  const queryClient = useQueryClient()
  // Boot point for the (commonLayout) tree:
  // - useSuspenseQuery for systemFeatures triggers app/loading.tsx until cache is warm.
  // - useSuspenseQuery for userProfile triggers (commonLayout)/loading.tsx until cache is warm.
  // After this provider mounts, downstream components reading the same queryKeys hit cache
  // and never suspend again, so their useSuspenseQuery calls return data synchronously.
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: userProfileResp } = useSuspenseQuery(userProfileQueryOptions())
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
      const properties: Record<string, string | number | boolean> = {
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
      <div className="flex h-full flex-col overflow-hidden">
        {env.NEXT_PUBLIC_MAINTENANCE_NOTICE && <MaintenanceNotice />}
        <div className="relative flex h-0 min-h-0 grow flex-col overflow-hidden bg-background-body">
          {children}
        </div>
      </div>
    </AppContext.Provider>
  )
}

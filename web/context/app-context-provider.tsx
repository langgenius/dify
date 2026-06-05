'use client'

import type { GetAccountProfileResponse } from '@dify/contracts/api/console/account/types.gen'
import type { PostWorkspacesCurrentResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { FC, ReactNode } from 'react'
import type { ICurrentWorkspace, LangGeniusVersionResponse } from '@/models/common'
import { useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo } from 'react'
import { setUserId, setUserProperties } from '@/app/components/base/amplitude'
import { flushRegistrationSuccess } from '@/app/components/base/amplitude/registration-tracking'
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
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/client'
import {
  useLangGeniusVersion,
} from '@/service/use-common'

type AppContextProviderProps = {
  children: ReactNode
}

const workspaceRoles = new Set<ICurrentWorkspace['role']>(['owner', 'admin', 'editor', 'dataset_operator', 'normal'])

const resolveWorkspaceRole = (role: PostWorkspacesCurrentResponse['role']): ICurrentWorkspace['role'] => {
  if (role && workspaceRoles.has(role as ICurrentWorkspace['role']))
    return role as ICurrentWorkspace['role']

  return initialWorkspaceInfo.role
}

const normalizeCurrentWorkspace = (workspace?: PostWorkspacesCurrentResponse): ICurrentWorkspace => {
  if (!workspace)
    return initialWorkspaceInfo

  return {
    id: workspace.id,
    name: workspace.name ?? initialWorkspaceInfo.name,
    plan: workspace.plan ?? initialWorkspaceInfo.plan,
    status: workspace.status ?? initialWorkspaceInfo.status,
    created_at: workspace.created_at ?? initialWorkspaceInfo.created_at,
    role: resolveWorkspaceRole(workspace.role),
    providers: initialWorkspaceInfo.providers,
    trial_credits: workspace.trial_credits ?? initialWorkspaceInfo.trial_credits,
    trial_credits_used: workspace.trial_credits_used ?? initialWorkspaceInfo.trial_credits_used,
    next_credit_reset_date: workspace.next_credit_reset_date ?? initialWorkspaceInfo.next_credit_reset_date,
    trial_end_reason: workspace.trial_end_reason ?? undefined,
    custom_config: workspace.custom_config
      ? {
          remove_webapp_brand: workspace.custom_config.remove_webapp_brand ?? undefined,
          replace_webapp_logo: workspace.custom_config.replace_webapp_logo ?? undefined,
        }
      : undefined,
  }
}

export const AppContextProvider: FC<AppContextProviderProps> = ({ children }) => {
  const queryClient = useQueryClient()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: userProfileResp } = useSuspenseQuery(userProfileQueryOptions())
  const { data: currentWorkspaceResp, isPending: isLoadingCurrentWorkspace, isFetching: isValidatingCurrentWorkspace } = useQuery(consoleQuery.workspaces.current.post.queryOptions())
  const langGeniusVersionQuery = useLangGeniusVersion(
    userProfileResp?.meta.currentVersion,
    !systemFeatures.branding.enabled,
  )

  const userProfile = useMemo<GetAccountProfileResponse>(() => userProfileResp?.profile || userProfilePlaceholder, [userProfileResp?.profile])
  const currentWorkspace = useMemo<ICurrentWorkspace>(() => normalizeCurrentWorkspace(currentWorkspaceResp), [currentWorkspaceResp])
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
    queryClient.invalidateQueries({ queryKey: userProfileQueryOptions().queryKey })
  }, [queryClient])

  const mutateCurrentWorkspace = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: consoleQuery.workspaces.current.post.key() })
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

      // The user ID is now attached, so replay any registration success event captured
      // at signup time. This makes it land on the identified Amplitude profile instead
      // of an anonymous one (no-op when nothing was deferred).
      flushRegistrationSuccess()
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
        {env.NEXT_PUBLIC_MAINTENANCE_NOTICE && <MaintenanceNotice />}
        <div className="relative flex grow flex-col overflow-x-hidden overflow-y-auto bg-background-body">
          {children}
        </div>
      </div>
    </AppContext.Provider>
  )
}

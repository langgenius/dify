'use client'

import type { AccessPolicyMemberBindingRemoval } from '@/app/components/access-rules-editor'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AccessRulesEditor from '@/app/components/access-rules-editor'
import { useStore } from '@/app/components/app/store'
import { useLocale } from '@/context/i18n'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { getAccessControlTemplateLanguage } from '@/i18n-config/language'
import { RESOURCE_ACCESS_SETTINGS_PAGE_SIZE } from '@/service/access-control/constants'
import {
  useAppAccessRules,
  useAppResourceWhitelist,
  useAppResourceWhitelistConfig,
  useAppUserAccessSettings,
  useRemoveAppAccessPolicyMemberBindings,
  useUpdateAppAutomaticIncludeWorkspaceMembers,
  useUpdateAppUserAccessSettings,
} from '@/service/access-control/use-app-access-config'
import { getAppACLCapabilities } from '@/utils/permission'

type AppAccessConfigPageProps = {
  appId: string
}

type AppAccessConfigContentProps = {
  appId: string
  maintainerId?: string | null
}

const AppAccessConfigContent = ({ appId, maintainerId }: AppAccessConfigContentProps) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const language = useMemo(() => getAccessControlTemplateLanguage(locale), [locale])
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(RESOURCE_ACCESS_SETTINGS_PAGE_SIZE)
  const { data: appAccessRulesResponse, isLoading: isLoadingAppAccessRules } = useAppAccessRules(
    appId,
    language,
  )
  const {
    data: appUserAccessSettingsResponse,
    isLoading: isLoadingAppUserAccessSettings,
    isPlaceholderData: isChangingAppUserAccessSettingsPage,
  } = useAppUserAccessSettings(appId, language, currentPage, pageSize)
  const { data: appResourceWhitelist } = useAppResourceWhitelist(appId)
  const { data: appResourceWhitelistConfig } = useAppResourceWhitelistConfig(appId)
  const {
    mutate: updateAppAutomaticIncludeWorkspaceMembers,
    isPending: isUpdatingAppAutomaticIncludeWorkspaceMembers,
  } = useUpdateAppAutomaticIncludeWorkspaceMembers(appId)
  const { mutate: updateAppUserAccessSettings } = useUpdateAppUserAccessSettings(appId)
  const {
    mutate: removeAppAccessPolicyMemberBindings,
    mutateAsync: removeAppAccessPolicyMemberBindingsAsync,
  } = useRemoveAppAccessPolicyMemberBindings(appId)
  const [
    optimisticAutomaticIncludeWorkspaceMembers,
    setOptimisticAutomaticIncludeWorkspaceMembers,
  ] = useState<boolean | null>(null)
  const [updatingAccountId, setUpdatingAccountId] = useState<string | null>(null)

  const appAccessRules = appAccessRulesResponse?.items || []
  const appUserAccessSettings = appUserAccessSettingsResponse?.data ?? []
  const appUserAccessSettingsPagination = appUserAccessSettingsResponse?.pagination
  const isLoadingEmptyPage =
    appUserAccessSettings.length === 0 &&
    (isChangingAppUserAccessSettingsPage ||
      (currentPage > 1 &&
        appUserAccessSettingsPagination !== undefined &&
        currentPage > appUserAccessSettingsPagination.total_pages))
  const automaticIncludeWorkspaceMembers =
    optimisticAutomaticIncludeWorkspaceMembers ??
    appResourceWhitelistConfig?.automatic_include_workspace_members

  const handleAutomaticIncludeWorkspaceMembersChange = useCallback(
    (nextValue: boolean) => {
      if (nextValue === automaticIncludeWorkspaceMembers) return

      if (!nextValue) setCurrentPage(1)
      setOptimisticAutomaticIncludeWorkspaceMembers(nextValue)
      updateAppAutomaticIncludeWorkspaceMembers(nextValue, {
        onError: () => setOptimisticAutomaticIncludeWorkspaceMembers(null),
        onSuccess: () => setOptimisticAutomaticIncludeWorkspaceMembers(null),
      })
    },
    [automaticIncludeWorkspaceMembers, updateAppAutomaticIncludeWorkspaceMembers],
  )

  const handleUserAccessPoliciesChange = useCallback(
    (accountId: string, accessPolicyIds: string[]) => {
      setUpdatingAccountId(accountId)
      updateAppUserAccessSettings(
        { accountId, accessPolicyIds },
        { onSettled: () => setUpdatingAccountId(null) },
      )
    },
    [updateAppUserAccessSettings],
  )

  const handleAddAccessSubject = useCallback(
    (accountId: string, accessPolicyIds: string[]) => {
      if (automaticIncludeWorkspaceMembers) return

      const existingAccountCount =
        appUserAccessSettingsPagination?.total_count ??
        appResourceWhitelist?.account_ids?.length ??
        0
      const lastPageAfterAdd = Math.max(Math.ceil((existingAccountCount + 1) / pageSize), 1)

      setUpdatingAccountId(accountId)
      updateAppUserAccessSettings(
        { accountId, accessPolicyIds },
        {
          onSuccess: () => setCurrentPage(lastPageAfterAdd),
          onSettled: () => setUpdatingAccountId(null),
        },
      )
    },
    [
      appResourceWhitelist?.account_ids?.length,
      appUserAccessSettingsPagination?.total_count,
      automaticIncludeWorkspaceMembers,
      pageSize,
      updateAppUserAccessSettings,
    ],
  )

  const handlePageSizeChange = useCallback((nextPageSize: number) => {
    setCurrentPage(1)
    setPageSize(nextPageSize)
  }, [])

  const handleRemoveAccessPolicyMemberBinding = useCallback(
    (accountId: string, accessPolicyId: string) => {
      if (automaticIncludeWorkspaceMembers) return

      const shouldReturnToPreviousPage =
        currentPage > 1 &&
        currentPage === appUserAccessSettingsPagination?.total_pages &&
        appUserAccessSettings.length === 1

      setUpdatingAccountId(accountId)
      removeAppAccessPolicyMemberBindings([{ accessPolicyId, accountIds: [accountId] }], {
        onSuccess: () => {
          if (shouldReturnToPreviousPage) {
            setCurrentPage((page) => (page === currentPage ? page - 1 : page))
          }
        },
        onSettled: () => setUpdatingAccountId(null),
      })
    },
    [
      appUserAccessSettings.length,
      appUserAccessSettingsPagination?.total_pages,
      automaticIncludeWorkspaceMembers,
      currentPage,
      removeAppAccessPolicyMemberBindings,
    ],
  )

  const handleBatchRemoveAccessPolicyMemberBindings = useCallback(
    async (removals: AccessPolicyMemberBindingRemoval[]) => {
      if (automaticIncludeWorkspaceMembers) return

      const removedAccountCount = removals.reduce(
        (count, removal) => count + removal.accountIds.length,
        0,
      )
      const shouldReturnToPreviousPage =
        currentPage > 1 &&
        currentPage === appUserAccessSettingsPagination?.total_pages &&
        removedAccountCount >= appUserAccessSettings.length

      await removeAppAccessPolicyMemberBindingsAsync(removals)
      if (shouldReturnToPreviousPage) {
        setCurrentPage((page) => (page === currentPage ? page - 1 : page))
      }
    },
    [
      appUserAccessSettings.length,
      appUserAccessSettingsPagination?.total_pages,
      automaticIncludeWorkspaceMembers,
      currentPage,
      removeAppAccessPolicyMemberBindingsAsync,
    ],
  )

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background-default-subtle">
      <header className="flex min-h-15.5 shrink-0 flex-col justify-center px-6 py-3">
        <h1 className="system-xl-semibold text-text-primary">
          {t(($) => $['settings.resourceAccess'], { ns: 'common' })}
        </h1>
        <p className="mt-0.5 system-sm-regular text-text-tertiary">
          {t(($) => $['accessRule.appDescription'], { ns: 'permission' })}
        </p>
      </header>
      <main className="flex min-h-0 w-full max-w-240 flex-1 flex-col px-6 pt-8 pb-10 sm:pr-20 sm:pl-12.5">
        <AccessRulesEditor
          className="min-h-0 w-full flex-1"
          rules={appAccessRules}
          userAccessSettings={appUserAccessSettings}
          isLoadingRules={isLoadingAppAccessRules}
          isLoadingUserAccessSettings={isLoadingAppUserAccessSettings || isLoadingEmptyPage}
          automaticIncludeWorkspaceMembers={automaticIncludeWorkspaceMembers}
          isUpdatingAutomaticIncludeWorkspaceMembers={isUpdatingAppAutomaticIncludeWorkspaceMembers}
          existingAccountIds={appResourceWhitelist?.account_ids}
          currentPage={appUserAccessSettingsPagination?.current_page ?? currentPage}
          pageSize={pageSize}
          totalCount={appUserAccessSettingsPagination?.total_count}
          totalPages={appUserAccessSettingsPagination?.total_pages ?? 0}
          isChangingPage={isChangingAppUserAccessSettingsPage}
          updatingAccountId={updatingAccountId}
          maintainerId={maintainerId}
          onAutomaticIncludeWorkspaceMembersChange={handleAutomaticIncludeWorkspaceMembersChange}
          onPageChange={setCurrentPage}
          onPageSizeChange={handlePageSizeChange}
          onUserAccessPoliciesChange={handleUserAccessPoliciesChange}
          onRemoveAccessPolicyMemberBinding={handleRemoveAccessPolicyMemberBinding}
          onBatchRemoveAccessPolicyMemberBindings={handleBatchRemoveAccessPolicyMemberBindings}
          onAddAccessSubject={handleAddAccessSubject}
        />
      </main>
    </div>
  )
}

const AppAccessConfigPage = ({ appId }: AppAccessConfigPageProps) => {
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const isRbacEnabled = systemFeatures.rbac_enabled
  const appDetail = useStore((state) => state.appDetail)
  const appACLCapabilities = useMemo(
    () =>
      getAppACLCapabilities(appDetail?.permission_keys, {
        currentUserId,
        resourceMaintainer: appDetail?.maintainer,
        workspacePermissionKeys,
        isRbacEnabled,
      }),
    [
      appDetail?.maintainer,
      appDetail?.permission_keys,
      currentUserId,
      isRbacEnabled,
      workspacePermissionKeys,
    ],
  )

  if (!appDetail || appDetail.id !== appId || !appACLCapabilities.canAccessConfig) return null

  return <AppAccessConfigContent appId={appId} maintainerId={appDetail.maintainer} />
}

export default AppAccessConfigPage

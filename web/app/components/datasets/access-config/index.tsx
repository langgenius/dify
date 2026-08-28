'use client'

import type { AccessPolicyMemberBindingRemoval } from '@/app/components/access-rules-editor'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AccessRulesEditor from '@/app/components/access-rules-editor'
import Loading from '@/app/components/base/loading'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useLocale } from '@/context/i18n'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { userProfileQueryOptions } from '@/features/account-profile/client'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { getAccessControlTemplateLanguage } from '@/i18n-config/language'
import { RESOURCE_ACCESS_SETTINGS_PAGE_SIZE } from '@/service/access-control/constants'
import {
  useDatasetAccessRules,
  useDatasetResourceWhitelist,
  useDatasetResourceWhitelistConfig,
  useDatasetUserAccessSettings,
  useRemoveDatasetAccessPolicyMemberBindings,
  useUpdateDatasetAutomaticIncludeWorkspaceMembers,
  useUpdateDatasetUserAccessSettings,
} from '@/service/access-control/use-dataset-access-config'
import { getDatasetACLCapabilities } from '@/utils/permission'

type DatasetAccessConfigPageProps = {
  datasetId: string
}

const DatasetAccessConfigPage = ({ datasetId }: DatasetAccessConfigPageProps) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const language = useMemo(() => getAccessControlTemplateLanguage(locale), [locale])
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState<number>(RESOURCE_ACCESS_SETTINGS_PAGE_SIZE)
  const dataset = useDatasetDetailContextWithSelector((state) => state.dataset)
  const { data: currentUserId } = useSuspenseQuery({
    ...userProfileQueryOptions(),
    select: (data) => data.profile.id,
  })
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const { data: isRbacEnabled } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ rbac_enabled }) => rbac_enabled,
  })
  const canAccessConfig = getDatasetACLCapabilities(dataset?.permission_keys, {
    currentUserId,
    resourceMaintainer: dataset?.maintainer,
    workspacePermissionKeys,
    isRbacEnabled,
  }).canAccessConfig
  const { data: datasetAccessRulesResponse, isLoading: isLoadingDatasetAccessRules } =
    useDatasetAccessRules(datasetId, language, { enabled: canAccessConfig })
  const {
    data: datasetUserAccessSettingsResponse,
    isLoading: isLoadingDatasetUserAccessSettings,
    isPlaceholderData: isChangingDatasetUserAccessSettingsPage,
  } = useDatasetUserAccessSettings(datasetId, language, currentPage, pageSize, {
    enabled: canAccessConfig,
  })
  const { data: datasetResourceWhitelist } = useDatasetResourceWhitelist(datasetId, {
    enabled: canAccessConfig,
  })
  const { data: datasetResourceWhitelistConfig } = useDatasetResourceWhitelistConfig(datasetId, {
    enabled: canAccessConfig,
  })
  const {
    mutate: updateDatasetAutomaticIncludeWorkspaceMembers,
    isPending: isUpdatingDatasetAutomaticIncludeWorkspaceMembers,
  } = useUpdateDatasetAutomaticIncludeWorkspaceMembers(datasetId)
  const { mutate: updateDatasetUserAccessSettings } = useUpdateDatasetUserAccessSettings(datasetId)
  const {
    mutate: removeDatasetAccessPolicyMemberBindings,
    mutateAsync: removeDatasetAccessPolicyMemberBindingsAsync,
  } = useRemoveDatasetAccessPolicyMemberBindings(datasetId)
  const [
    optimisticAutomaticIncludeWorkspaceMembers,
    setOptimisticAutomaticIncludeWorkspaceMembers,
  ] = useState<boolean | null>(null)
  const [updatingAccountId, setUpdatingAccountId] = useState<string | null>(null)

  const datasetAccessRules = datasetAccessRulesResponse?.items || []
  const datasetUserAccessSettings = datasetUserAccessSettingsResponse?.data ?? []
  const datasetUserAccessSettingsPagination = datasetUserAccessSettingsResponse?.pagination
  const isLoadingEmptyPage =
    datasetUserAccessSettings.length === 0 &&
    (isChangingDatasetUserAccessSettingsPage ||
      (currentPage > 1 &&
        datasetUserAccessSettingsPagination !== undefined &&
        currentPage > datasetUserAccessSettingsPagination.total_pages))
  const automaticIncludeWorkspaceMembers =
    optimisticAutomaticIncludeWorkspaceMembers ??
    datasetResourceWhitelistConfig?.automatic_include_workspace_members

  const handleAutomaticIncludeWorkspaceMembersChange = useCallback(
    (nextValue: boolean) => {
      if (!canAccessConfig) return
      if (nextValue === automaticIncludeWorkspaceMembers) return

      if (!nextValue) setCurrentPage(1)
      setOptimisticAutomaticIncludeWorkspaceMembers(nextValue)
      updateDatasetAutomaticIncludeWorkspaceMembers(nextValue, {
        onError: () => setOptimisticAutomaticIncludeWorkspaceMembers(null),
        onSuccess: () => setOptimisticAutomaticIncludeWorkspaceMembers(null),
      })
    },
    [
      automaticIncludeWorkspaceMembers,
      canAccessConfig,
      updateDatasetAutomaticIncludeWorkspaceMembers,
    ],
  )

  const handleUserAccessPoliciesChange = useCallback(
    (accountId: string, accessPolicyIds: string[]) => {
      if (!canAccessConfig) return

      setUpdatingAccountId(accountId)
      updateDatasetUserAccessSettings(
        { accountId, accessPolicyIds },
        { onSettled: () => setUpdatingAccountId(null) },
      )
    },
    [canAccessConfig, updateDatasetUserAccessSettings],
  )

  const handleAddAccessSubject = useCallback(
    (accountId: string, accessPolicyIds: string[]) => {
      if (!canAccessConfig) return
      if (automaticIncludeWorkspaceMembers) return

      const existingAccountCount =
        datasetUserAccessSettingsPagination?.total_count ??
        datasetResourceWhitelist?.account_ids?.length ??
        0
      const lastPageAfterAdd = Math.max(Math.ceil((existingAccountCount + 1) / pageSize), 1)

      setUpdatingAccountId(accountId)
      updateDatasetUserAccessSettings(
        { accountId, accessPolicyIds },
        {
          onSuccess: () => setCurrentPage(lastPageAfterAdd),
          onSettled: () => setUpdatingAccountId(null),
        },
      )
    },
    [
      canAccessConfig,
      datasetResourceWhitelist?.account_ids?.length,
      datasetUserAccessSettingsPagination?.total_count,
      automaticIncludeWorkspaceMembers,
      pageSize,
      updateDatasetUserAccessSettings,
    ],
  )

  const handlePageSizeChange = useCallback((nextPageSize: number) => {
    setCurrentPage(1)
    setPageSize(nextPageSize)
  }, [])

  const handleRemoveAccessPolicyMemberBinding = useCallback(
    (accountId: string, accessPolicyId: string) => {
      if (!canAccessConfig) return
      if (automaticIncludeWorkspaceMembers) return

      const shouldReturnToPreviousPage =
        currentPage > 1 &&
        currentPage === datasetUserAccessSettingsPagination?.total_pages &&
        datasetUserAccessSettings.length === 1

      setUpdatingAccountId(accountId)
      removeDatasetAccessPolicyMemberBindings([{ accessPolicyId, accountIds: [accountId] }], {
        onSuccess: () => {
          if (shouldReturnToPreviousPage) {
            setCurrentPage((page) => (page === currentPage ? page - 1 : page))
          }
        },
        onSettled: () => setUpdatingAccountId(null),
      })
    },
    [
      automaticIncludeWorkspaceMembers,
      canAccessConfig,
      currentPage,
      datasetUserAccessSettings.length,
      datasetUserAccessSettingsPagination?.total_pages,
      removeDatasetAccessPolicyMemberBindings,
    ],
  )

  const handleBatchRemoveAccessPolicyMemberBindings = useCallback(
    async (removals: AccessPolicyMemberBindingRemoval[]) => {
      if (!canAccessConfig || automaticIncludeWorkspaceMembers) return

      const removedAccountCount = removals.reduce(
        (count, removal) => count + removal.accountIds.length,
        0,
      )
      const shouldReturnToPreviousPage =
        currentPage > 1 &&
        currentPage === datasetUserAccessSettingsPagination?.total_pages &&
        removedAccountCount >= datasetUserAccessSettings.length

      await removeDatasetAccessPolicyMemberBindingsAsync(removals)
      if (shouldReturnToPreviousPage) {
        setCurrentPage((page) => (page === currentPage ? page - 1 : page))
      }
    },
    [
      automaticIncludeWorkspaceMembers,
      canAccessConfig,
      currentPage,
      datasetUserAccessSettings.length,
      datasetUserAccessSettingsPagination?.total_pages,
      removeDatasetAccessPolicyMemberBindingsAsync,
    ],
  )

  if (!canAccessConfig) return <Loading type="app" />

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background-default-subtle">
      <header className="flex min-h-15.5 shrink-0 flex-col justify-center px-6 py-3">
        <h1 className="system-xl-semibold text-text-primary">
          {t(($) => $['settings.resourceAccess'], { ns: 'common' })}
        </h1>
        <p className="mt-0.5 system-sm-regular text-text-tertiary">
          {t(($) => $['accessRule.datasetDescription'], { ns: 'permission' })}
        </p>
      </header>
      <main className="flex min-h-0 w-full max-w-240 flex-1 flex-col px-6 pt-8 pb-10 sm:pr-20 sm:pl-12.5">
        <AccessRulesEditor
          className="min-h-0 w-full flex-1"
          rules={datasetAccessRules}
          userAccessSettings={datasetUserAccessSettings}
          isLoadingRules={isLoadingDatasetAccessRules}
          isLoadingUserAccessSettings={isLoadingDatasetUserAccessSettings || isLoadingEmptyPage}
          automaticIncludeWorkspaceMembers={automaticIncludeWorkspaceMembers}
          isUpdatingAutomaticIncludeWorkspaceMembers={
            isUpdatingDatasetAutomaticIncludeWorkspaceMembers
          }
          existingAccountIds={datasetResourceWhitelist?.account_ids}
          currentPage={datasetUserAccessSettingsPagination?.current_page ?? currentPage}
          pageSize={pageSize}
          totalCount={datasetUserAccessSettingsPagination?.total_count}
          totalPages={datasetUserAccessSettingsPagination?.total_pages ?? 0}
          isChangingPage={isChangingDatasetUserAccessSettingsPage}
          updatingAccountId={updatingAccountId}
          maintainerId={dataset?.maintainer}
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

export default DatasetAccessConfigPage

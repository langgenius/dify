'use client'

import type { ResourceOpenScope } from '@/models/access-control'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useAtomValue } from 'jotai'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AccessRulesEditor from '@/app/components/access-rules-editor'
import Loading from '@/app/components/base/loading'
import {
  datasetRbacEnabledAtom,
  userProfileIdAtom,
  workspacePermissionKeysAtom,
} from '@/context/app-context-state'
import { useDatasetDetailContextWithSelector } from '@/context/dataset-detail'
import { useLocale } from '@/context/i18n'
import { getAccessControlTemplateLanguage } from '@/i18n-config/language'
import {
  useDatasetAccessRules,
  useDatasetUserAccessSettings,
  useRemoveDatasetAccessPolicyMemberBindings,
  useUpdateDatasetOpenScope,
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
  const dataset = useDatasetDetailContextWithSelector(state => state.dataset)
  const currentUserId = useAtomValue(userProfileIdAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const isRbacEnabled = useAtomValue(datasetRbacEnabledAtom)
  const canAccessConfig = getDatasetACLCapabilities(dataset?.permission_keys, {
    currentUserId,
    resourceMaintainer: dataset?.maintainer,
    workspacePermissionKeys,
    isRbacEnabled,
  }).canAccessConfig
  const { data: datasetAccessRulesResponse, isLoading: isLoadingDatasetAccessRules } = useDatasetAccessRules(datasetId, language, { enabled: canAccessConfig })
  const { data: datasetUserAccessSettingsResponse, isLoading: isLoadingDatasetUserAccessSettings } = useDatasetUserAccessSettings(datasetId, language, { enabled: canAccessConfig })
  const { mutate: updateDatasetOpenScope, isPending: isUpdatingDatasetOpenScope } = useUpdateDatasetOpenScope(datasetId)
  const { mutate: updateDatasetUserAccessSettings } = useUpdateDatasetUserAccessSettings(datasetId)
  const { mutate: removeDatasetAccessPolicyMemberBindings } = useRemoveDatasetAccessPolicyMemberBindings(datasetId)
  const [optimisticOpenScope, setOptimisticOpenScope] = useState<ResourceOpenScope | null>(null)
  const [updatingAccountId, setUpdatingAccountId] = useState<string | null>(null)

  const datasetAccessRules = datasetAccessRulesResponse?.items || []
  const datasetUserAccessSettings = datasetUserAccessSettingsResponse?.data || []
  const openScope = optimisticOpenScope || datasetUserAccessSettingsResponse?.scope

  const handleOpenScopeChange = useCallback((nextOpenScope: ResourceOpenScope) => {
    if (!canAccessConfig)
      return
    if (nextOpenScope === openScope)
      return

    const previousOptimisticOpenScope = optimisticOpenScope
    setOptimisticOpenScope(nextOpenScope)
    updateDatasetOpenScope(nextOpenScope, {
      onError: () => setOptimisticOpenScope(previousOptimisticOpenScope),
    })
  }, [canAccessConfig, openScope, optimisticOpenScope, updateDatasetOpenScope])

  const handleUserAccessPoliciesChange = useCallback((accountId: string, accessPolicyIds: string[]) => {
    if (!canAccessConfig)
      return

    setUpdatingAccountId(accountId)
    updateDatasetUserAccessSettings(
      { accountId, accessPolicyIds },
      { onSettled: () => setUpdatingAccountId(null) },
    )
  }, [canAccessConfig, updateDatasetUserAccessSettings])

  const handleRemoveAccessPolicyMemberBinding = useCallback((accountId: string, accessPolicyId: string) => {
    if (!canAccessConfig)
      return

    setUpdatingAccountId(accountId)
    removeDatasetAccessPolicyMemberBindings(
      { accessPolicyId, accountIds: [accountId] },
      { onSettled: () => setUpdatingAccountId(null) },
    )
  }, [canAccessConfig, removeDatasetAccessPolicyMemberBindings])

  if (!canAccessConfig)
    return <Loading type="app" />

  return (
    <ScrollArea
      className="h-full bg-background-default-subtle"
      slotClassNames={{ viewport: 'overscroll-contain' }}
    >
      <header className="flex min-h-15.5 flex-col justify-center px-6 py-3">
        <h1 className="system-sm-semibold text-text-primary">{t('settings.resourceAccess', { ns: 'common' })}</h1>
        <p className="mt-0.5 system-xs-regular text-text-tertiary">
          {t('accessRule.datasetDescription', { ns: 'permission' })}
        </p>
      </header>
      <main className="w-full px-6 pt-8 pb-10">
        <AccessRulesEditor
          className="w-full max-w-200"
          rules={datasetAccessRules}
          userAccessSettings={datasetUserAccessSettings}
          isLoadingRules={isLoadingDatasetAccessRules}
          isLoadingUserAccessSettings={isLoadingDatasetUserAccessSettings}
          openScope={openScope}
          isUpdatingOpenScope={isLoadingDatasetUserAccessSettings || isUpdatingDatasetOpenScope}
          updatingAccountId={updatingAccountId}
          maintainerId={dataset?.maintainer}
          onOpenScopeChange={handleOpenScopeChange}
          onUserAccessPoliciesChange={handleUserAccessPoliciesChange}
          onRemoveAccessPolicyMemberBinding={handleRemoveAccessPolicyMemberBinding}
          onAddAccessSubject={handleUserAccessPoliciesChange}
        />
      </main>
    </ScrollArea>
  )
}

export default DatasetAccessConfigPage

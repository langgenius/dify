'use client'

import type { ResourceOpenScope } from '@/models/access-control'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AccessRulesEditor from '@/app/components/access-rules-editor'
import { useStore } from '@/app/components/app/store'
import { userProfileIdAtom, workspacePermissionKeysAtom } from '@/context/app-context-state'
import { useLocale } from '@/context/i18n'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { getAccessControlTemplateLanguage } from '@/i18n-config/language'
import {
  useAppAccessRules,
  useAppUserAccessSettings,
  useRemoveAppAccessPolicyMemberBindings,
  useUpdateAppOpenScope,
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
  const { data: appAccessRulesResponse, isLoading: isLoadingAppAccessRules } = useAppAccessRules(appId, language)
  const { data: appUserAccessSettingsResponse, isLoading: isLoadingAppUserAccessSettings } = useAppUserAccessSettings(appId, language)
  const { mutate: updateAppOpenScope, isPending: isUpdatingAppOpenScope } = useUpdateAppOpenScope(appId)
  const { mutate: updateAppUserAccessSettings } = useUpdateAppUserAccessSettings(appId)
  const { mutate: removeAppAccessPolicyMemberBindings } = useRemoveAppAccessPolicyMemberBindings(appId)
  const [optimisticOpenScope, setOptimisticOpenScope] = useState<ResourceOpenScope | null>(null)
  const [updatingAccountId, setUpdatingAccountId] = useState<string | null>(null)

  const appAccessRules = appAccessRulesResponse?.items || []
  const appUserAccessSettings = appUserAccessSettingsResponse?.data || []
  const openScope = optimisticOpenScope || appUserAccessSettingsResponse?.scope

  const handleOpenScopeChange = useCallback((nextOpenScope: ResourceOpenScope) => {
    if (nextOpenScope === openScope)
      return

    const previousOptimisticOpenScope = optimisticOpenScope
    setOptimisticOpenScope(nextOpenScope)
    updateAppOpenScope(nextOpenScope, {
      onError: () => setOptimisticOpenScope(previousOptimisticOpenScope),
    })
  }, [openScope, optimisticOpenScope, updateAppOpenScope])

  const handleUserAccessPoliciesChange = useCallback((accountId: string, accessPolicyIds: string[]) => {
    setUpdatingAccountId(accountId)
    updateAppUserAccessSettings(
      { accountId, accessPolicyIds },
      { onSettled: () => setUpdatingAccountId(null) },
    )
  }, [updateAppUserAccessSettings])

  const handleRemoveAccessPolicyMemberBinding = useCallback((accountId: string, accessPolicyId: string) => {
    setUpdatingAccountId(accountId)
    removeAppAccessPolicyMemberBindings(
      { accessPolicyId, accountIds: [accountId] },
      { onSettled: () => setUpdatingAccountId(null) },
    )
  }, [removeAppAccessPolicyMemberBindings])

  return (
    <ScrollArea
      className="h-full bg-background-default-subtle"
      slotClassNames={{ viewport: 'overscroll-contain' }}
    >
      <header className="flex min-h-15.5 flex-col justify-center px-6 py-3">
        <h1 className="system-xl-semibold text-text-primary">{t('settings.resourceAccess', { ns: 'common' })}</h1>
        <p className="mt-0.5 system-sm-regular text-text-tertiary">
          {t('accessRule.appDescription', { ns: 'permission' })}
        </p>
      </header>
      <main className="w-full px-6 pt-8 pb-10">
        <AccessRulesEditor
          className="w-full max-w-200"
          rules={appAccessRules}
          userAccessSettings={appUserAccessSettings}
          isLoadingRules={isLoadingAppAccessRules}
          isLoadingUserAccessSettings={isLoadingAppUserAccessSettings}
          openScope={openScope}
          isUpdatingOpenScope={isLoadingAppUserAccessSettings || isUpdatingAppOpenScope}
          updatingAccountId={updatingAccountId}
          maintainerId={maintainerId}
          onOpenScopeChange={handleOpenScopeChange}
          onUserAccessPoliciesChange={handleUserAccessPoliciesChange}
          onRemoveAccessPolicyMemberBinding={handleRemoveAccessPolicyMemberBinding}
          onAddAccessSubject={handleUserAccessPoliciesChange}
        />
      </main>
    </ScrollArea>
  )
}

const AppAccessConfigPage = ({ appId }: AppAccessConfigPageProps) => {
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const currentUserId = useAtomValue(userProfileIdAtom)
  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const isRbacEnabled = systemFeatures.rbac_enabled
  const appDetail = useStore(state => state.appDetail)
  const appACLCapabilities = useMemo(() => getAppACLCapabilities(appDetail?.permission_keys, {
    currentUserId,
    resourceMaintainer: appDetail?.maintainer,
    workspacePermissionKeys,
    isRbacEnabled,
  }), [appDetail?.maintainer, appDetail?.permission_keys, currentUserId, isRbacEnabled, workspacePermissionKeys])

  if (!appDetail || appDetail.id !== appId || !appACLCapabilities.canAccessConfig)
    return null

  return <AppAccessConfigContent appId={appId} maintainerId={appDetail.maintainer} />
}

export default AppAccessConfigPage

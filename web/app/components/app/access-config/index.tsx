'use client'

import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import AccessRulesEditor from '@/app/components/access-rules-editor'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useLocale } from '@/context/i18n'
import { getAccessControlTemplateLanguage } from '@/i18n-config/language'
import { useAppAccessRules } from '@/service/access-control/use-app-access-config'
import { getAppACLCapabilities } from '@/utils/permission'

type AppAccessConfigPageProps = {
  appId: string
}

const AppAccessConfigPage = ({ appId }: AppAccessConfigPageProps) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const language = useMemo(() => getAccessControlTemplateLanguage(locale), [locale])
  const { data: appAccessRulesResponse, isLoading: isLoadingAppAccessRules } = useAppAccessRules(appId, language)
  const appDetail = useAppStore(state => state.appDetail)
  const currentUserId = useAppContextWithSelector(state => state.userProfile?.id)
  const workspacePermissionKeys = useAppContextWithSelector(state => state.workspacePermissionKeys)
  const appACLCapabilities = useMemo(
    () => getAppACLCapabilities(appDetail?.permission_keys, {
      currentUserId,
      resourceCreatedBy: appDetail?.created_by || appDetail?.workflow?.created_by,
      workspacePermissionKeys,
    }),
    [appDetail?.created_by, appDetail?.permission_keys, appDetail?.workflow?.created_by, currentUserId, workspacePermissionKeys],
  )

  const appAccessRules = appAccessRulesResponse?.items || []

  return (
    <ScrollArea
      className="h-full bg-background-body"
      slotClassNames={{ viewport: 'overscroll-contain' }}
    >
      <div className="w-full max-w-304 px-8 py-6">
        <h1 className="system-sm-semibold text-text-primary">{t('settings.appAccessPermissions', { ns: 'common' })}</h1>
        <div className="mt-4">
          <AccessRulesEditor
            resourceId={appId}
            rules={appAccessRules}
            canManage={appACLCapabilities.canAccessConfig}
            isLoadingRules={isLoadingAppAccessRules}
            title={t('accessRule.appTitle', { ns: 'permission' })}
          />
        </div>
      </div>
    </ScrollArea>
  )
}

export default AppAccessConfigPage

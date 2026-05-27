'use client'

import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import AccessRulesEditor from '@/app/components/access-rules-editor'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useAppAccessRules } from '@/service/access-control/use-app-access-config'
import { getAppACLCapabilities } from '@/utils/permission'

type AppAccessConfigPageProps = {
  appId: string
}

const AppAccessConfigPage = ({ appId }: AppAccessConfigPageProps) => {
  const { t } = useTranslation()
  const { data: appAccessRulesResponse } = useAppAccessRules(appId)
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
      className="h-full bg-components-panel-bg"
      slotClassNames={{ viewport: 'overscroll-contain' }}
    >
      <div className="w-full px-16 py-8">
        <h1 className="title-2xl-semi-bold text-text-primary">{t('settings.appAccessPermissions', { ns: 'common' })}</h1>
        <div className="mt-6">
          <AccessRulesEditor resourceId={appId} rules={appAccessRules} canManage={appACLCapabilities.canAccessConfig} />
        </div>
      </div>
    </ScrollArea>
  )
}

export default AppAccessConfigPage

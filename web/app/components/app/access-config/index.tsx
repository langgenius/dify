'use client'

import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import AccessRulesEditor from '@/app/components/access-rules-editor'
import { useStore as useAppStore } from '@/app/components/app/store'
import { useAppAccessRules } from '@/service/access-control/use-app-access-config'
import { getAppACLCapabilities } from '@/utils/permission'

type AppAccessConfigPageProps = {
  appId: string
}

const AppAccessConfigPage = ({ appId }: AppAccessConfigPageProps) => {
  const { t } = useTranslation()
  const { data: appAccessRulesResponse } = useAppAccessRules(appId)
  const appPermissionKeys = useAppStore(state => state.appDetail?.permission_keys)
  const appACLCapabilities = useMemo(
    () => getAppACLCapabilities(appPermissionKeys),
    [appPermissionKeys],
  )

  const appAccessRules = appAccessRulesResponse?.items || []

  return (
    <ScrollArea
      className="h-full bg-components-panel-bg"
      slotClassNames={{ viewport: 'overscroll-contain' }}
    >
      <div className="w-full px-16 py-8">
        <h1 className="title-2xl-semi-bold text-text-primary">{t('settings.accessConfig', { ns: 'common' })}</h1>
        <div className="mt-6">
          <AccessRulesEditor resourceId={appId} rules={appAccessRules} canManage={appACLCapabilities.canAccessConfig} />
        </div>
      </div>
    </ScrollArea>
  )
}

export default AppAccessConfigPage

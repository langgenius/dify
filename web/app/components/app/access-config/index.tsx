'use client'

import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import AccessRulesEditor from '@/app/components/access-rules-editor'
import { useLocale } from '@/context/i18n'
import { getAccessControlTemplateLanguage } from '@/i18n-config/language'
import { useAppAccessRules } from '@/service/access-control/use-app-access-config'

type AppAccessConfigPageProps = {
  appId: string
}

const AppAccessConfigPage = ({ appId }: AppAccessConfigPageProps) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const language = useMemo(() => getAccessControlTemplateLanguage(locale), [locale])
  const { data: appAccessRulesResponse, isLoading: isLoadingAppAccessRules } = useAppAccessRules(appId, language)

  const appAccessRules = appAccessRulesResponse?.items || []

  return (
    <ScrollArea
      className="h-full bg-background-body"
      slotClassNames={{ viewport: 'overscroll-contain' }}
    >
      <div className="w-full max-w-304 px-8 py-6">
        <h1 className="system-sm-semibold text-text-primary">{t('settings.resourceAccess', { ns: 'common' })}</h1>
        <div className="mt-4">
          <AccessRulesEditor
            rules={appAccessRules}
            isLoadingRules={isLoadingAppAccessRules}
            title={t('accessRule.appTitle', { ns: 'permission' })}
          />
        </div>
      </div>
    </ScrollArea>
  )
}

export default AppAccessConfigPage

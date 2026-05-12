'use client'

import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import AccessRulesEditor from '@/app/components/access-rules-editor'
import { useAppAccessRules } from '@/service/access-control/use-app-access-config'

type AppAccessConfigPageProps = {
  appId: string
}

const AppAccessConfigPage = ({ appId }: AppAccessConfigPageProps) => {
  const { data: appAccessRulesResponse } = useAppAccessRules(appId)

  const appAccessRules = appAccessRulesResponse?.items || []

  return (
    <ScrollArea
      className="h-full bg-components-panel-bg"
      slotClassNames={{ viewport: 'overscroll-contain' }}
    >
      <div className="w-full px-16 py-8">
        <h1 className="title-2xl-semi-bold text-text-primary">Access Config</h1>
        <div className="mt-6">
          <AccessRulesEditor rules={appAccessRules} />
        </div>
      </div>
    </ScrollArea>
  )
}

export default AppAccessConfigPage

'use client'

import type { AccessRule } from '@/app/components/header/account-setting/access-rules-page/access-rule-row'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import AccessRulesEditor from '@/app/components/access-rules-editor'

// TODO: replace with the per-app access rules fetched from the access-rules
// API once available. Mirrors the workspace-level App access rules catalog.
const DEFAULT_APP_ACCESS_RULES: AccessRule[] = [
  {
    id: 'app-full-access',
    name: 'Full access',
    description: 'Highest level. Can edit, publish, delete apps, and manage access for this app.',
    assignedRoles: [
      { id: 'owner', name: 'Owner' },
      { id: 'admin', name: 'Admin' },
      { id: 'app-admin', name: 'App Admin' },
      { id: 'executive', name: 'Executive' },
    ],
    permissions: [],
  },
  {
    id: 'app-can-edit',
    name: 'Can edit',
    description: 'Modify Prompts, adjust workflows, change variables. Test and publish updates.',
    assignedRoles: [
      { id: 'app-editor', name: 'App Editor' },
      { id: 'it-staff', name: 'IT Staff' },
    ],
    permissions: [],
  },
  {
    id: 'app-can-view-and-use',
    name: 'Can view & use',
    description: 'View and use the app. Access Prompt and workflow logs. Cannot modify.',
    assignedRoles: [
      { id: 'tester', name: 'Tester' },
      { id: 'ops-staff', name: 'Ops Staff' },
      { id: 'member', name: 'Member' },
    ],
    permissions: [],
  },
  {
    id: 'app-can-preview',
    name: 'Can preview',
    description: 'View the app in the list only. Cannot open the editor or use the app.',
    assignedRoles: [
      { id: 'partner', name: 'Partner' },
    ],
    permissions: [],
  },
]

type AppAccessConfigPageProps = {
  appId: string
}

const AppAccessConfigPage = ({ appId: _appId }: AppAccessConfigPageProps) => {
  return (
    <ScrollArea
      className="h-full bg-components-panel-bg"
      slotClassNames={{ viewport: 'overscroll-contain' }}
    >
      <div className="w-full px-16 py-8">
        <h1 className="title-2xl-semi-bold text-text-primary">Access Config</h1>
        <div className="mt-6">
          <AccessRulesEditor rules={DEFAULT_APP_ACCESS_RULES} />
        </div>
      </div>
    </ScrollArea>
  )
}

export default AppAccessConfigPage

'use client'

import type { AccessRule } from './access-rule-row'
import { useCallback } from 'react'
import AccessRuleSection from './access-rule-section'

// todo: replace with API data when backend is ready
const APP_ACCESS_RULES: AccessRule[] = [
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
  },
  {
    id: 'app-can-edit',
    name: 'Can edit',
    description: 'Modify Prompts, adjust workflows, change variables. Test and publish updates.',
    assignedRoles: [
      { id: 'app-editor', name: 'App Editor' },
      { id: 'it-staff', name: 'IT Staff' },
    ],
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
  },
  {
    id: 'app-can-preview',
    name: 'Can preview',
    description: 'View the app in the list only. Cannot open the editor or use the app.',
    assignedRoles: [
      { id: 'partner', name: 'Partner' },
    ],
  },
]

// todo: replace with API data when backend is ready
const KNOWLEDGE_BASE_ACCESS_RULES: AccessRule[] = [
  {
    id: 'kb-full-access',
    name: 'Full access',
    description: 'Highest level. Can edit, publish, delete apps, and manage access for this knowledge base.',
    assignedRoles: [
      { id: 'owner', name: 'Owner' },
      { id: 'admin', name: 'Admin' },
      { id: 'kb-admin', name: 'KB Admin' },
      { id: 'executive', name: 'Executive' },
    ],
  },
  {
    id: 'kb-can-edit',
    name: 'Can edit',
    description: 'Edit knowledge base content, modify settings, and run tests.',
    assignedRoles: [
      { id: 'kb-editor', name: 'KB Editor' },
      { id: 'ops-staff', name: 'Ops Staff' },
      { id: 'it-staff', name: 'IT Staff' },
    ],
  },
  {
    id: 'kb-can-view',
    name: 'Can view',
    description: 'View knowledge base sources and logs. Cannot modify content.',
    assignedRoles: [
      { id: 'member', name: 'Member' },
    ],
  },
  {
    id: 'kb-can-preview',
    name: 'Can preview',
    description: 'View in the list only. Cannot access the detail page.',
    assignedRoles: [
      { id: 'partner', name: 'Partner' },
    ],
  },
  {
    id: 'kb-can-test',
    name: 'Can test',
    description: 'Test knowledge base retrieval efficiency in sandbox.',
    assignedRoles: [
      { id: 'tester', name: 'Tester' },
    ],
  },
]

const AccessRulesPage = () => {
  const noop = useCallback(() => {
    // TODO: wire up to API when backend is ready
  }, [])

  return (
    <div className="flex flex-col gap-6">
      <AccessRuleSection
        title="App Access Rules"
        rules={APP_ACCESS_RULES}
        createButtonLabel="Create App permission set"
        onCreate={noop}
        onEditRule={noop}
        onCopyRule={noop}
        onDeleteRule={noop}
        onAddRole={noop}
        onRemoveRole={noop}
      />
      <AccessRuleSection
        title="Knowledge Base Access Rules"
        rules={KNOWLEDGE_BASE_ACCESS_RULES}
        createButtonLabel="Create KB permission set"
        onCreate={noop}
        onEditRule={noop}
        onCopyRule={noop}
        onDeleteRule={noop}
        onAddRole={noop}
        onRemoveRole={noop}
      />
    </div>
  )
}

export default AccessRulesPage

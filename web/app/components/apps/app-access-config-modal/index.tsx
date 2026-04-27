'use client'

import type { AccessRule } from '@/app/components/header/account-setting/access-rules-page/access-rule-row'
import type { App } from '@/types/app'
import AccessConfigModal from '@/app/components/access-config-modal'

// TODO: replace with the per-app access rules fetched from the access-rules API
// once available. The catalog mirrors the workspace-level App access rules and
// adds app-specific rules that can only be assigned per-app.
const DEFAULT_APP_ACCESS_RULES: AccessRule[] = [
  {
    id: 'app-full-access',
    name: 'Full access',
    description: 'Highest level. Can edit, publish, delete apps, and manage access for this app.',
    assignedRoles: [
      { id: 'owner', name: 'Owner' },
      { id: 'admin', name: 'Admin' },
      { id: 'marketing-lead', name: 'Marketing Lead' },
      { id: 'kb-admin', name: 'KB Admin' },
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
      { id: 'owner', name: 'Owner' },
      { id: 'admin', name: 'Admin' },
      { id: 'marketing-lead', name: 'Marketing Lead' },
      { id: 'kb-admin', name: 'KB Admin' },
      { id: 'app-admin', name: 'App Admin' },
      { id: 'executive', name: 'Executive' },
    ],
    permissions: [],
  },
  {
    id: 'app-can-view-and-use',
    name: 'Can view & use',
    description: 'View and use the app. Access Prompt and workflow logs. Cannot modify.',
    assignedRoles: [
      { id: 'owner', name: 'Owner' },
      { id: 'admin', name: 'Admin' },
      { id: 'marketing-lead', name: 'Marketing Lead' },
      { id: 'kb-admin', name: 'KB Admin' },
      { id: 'app-admin', name: 'App Admin' },
      { id: 'executive', name: 'Executive' },
    ],
    permissions: [],
  },
  {
    id: 'app-can-preview',
    name: 'Can preview',
    description: 'View the app in the list only. Cannot open the editor or use the app.',
    assignedRoles: [
      { id: 'owner', name: 'Owner' },
      { id: 'admin', name: 'Admin' },
      { id: 'marketing-lead', name: 'Marketing Lead' },
      { id: 'kb-admin', name: 'KB Admin' },
      { id: 'app-admin', name: 'App Admin' },
      { id: 'executive', name: 'Executive' },
    ],
    permissions: [],
  },
  {
    id: 'app-can-optimize-prompt',
    name: 'Can optimize prompt',
    description: 'Dedicated prompt optimization access.',
    assignedRoles: [
      { id: 'owner', name: 'Owner' },
      { id: 'admin', name: 'Admin' },
      { id: 'marketing-lead', name: 'Marketing Lead' },
      { id: 'kb-admin', name: 'KB Admin' },
      { id: 'app-admin', name: 'App Admin' },
      { id: 'executive', name: 'Executive' },
    ],
    permissions: [],
  },
]

export type AppAccessConfigModalProps = {
  open: boolean
  app: Pick<App, 'id' | 'name'>
  onClose: () => void
  onSave?: (rules: AccessRule[]) => void
}

const AppAccessConfigModal = ({
  open,
  app: _app,
  onClose,
  onSave,
}: AppAccessConfigModalProps) => {
  return (
    <AccessConfigModal
      open={open}
      title="App Access Config"
      description="Configure access levels for this specific app."
      initialRules={DEFAULT_APP_ACCESS_RULES}
      onClose={onClose}
      onSave={onSave}
    />
  )
}

export default AppAccessConfigModal

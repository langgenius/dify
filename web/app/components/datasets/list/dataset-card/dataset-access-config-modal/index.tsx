'use client'

import type { AccessRule } from '@/app/components/header/account-setting/access-rules-page/access-rule-row'
import type { DataSet } from '@/models/datasets'
import AccessConfigModal from '@/app/components/access-config-modal'

// TODO: replace with the per-knowledge-base access rules fetched from the
// access-rules API once available. The catalog mirrors the workspace-level
// Knowledge Base access rules.
const DEFAULT_KB_ACCESS_RULES: AccessRule[] = [
  {
    id: 'kb-full-access',
    name: 'Full access',
    description: 'Highest level. Can edit, publish, delete, and manage access for this knowledge base.',
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
    id: 'kb-can-edit',
    name: 'Can edit',
    description: 'Edit knowledge base content, modify settings, and run tests.',
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
    id: 'kb-can-view-and-use',
    name: 'Can view & use',
    description: 'View knowledge base sources, configs, and logs. Cannot modify content.',
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
    id: 'kb-can-preview',
    name: 'Can preview',
    description: 'View in the list only. Cannot access the detail page.',
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
    id: 'kb-can-test',
    name: 'Can test',
    description: 'Test knowledge base retrieval efficiency in sandbox.',
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

export type DatasetAccessConfigModalProps = {
  open: boolean
  dataset: Pick<DataSet, 'id' | 'name'>
  onClose: () => void
  onSave?: (rules: AccessRule[]) => void
}

const DatasetAccessConfigModal = ({
  open,
  dataset: _dataset,
  onClose,
  onSave,
}: DatasetAccessConfigModalProps) => {
  return (
    <AccessConfigModal
      open={open}
      title="Knowledge Base Access Config"
      description="Configure access levels for this specific knowledge base."
      initialRules={DEFAULT_KB_ACCESS_RULES}
      onClose={onClose}
      onSave={onSave}
    />
  )
}

export default DatasetAccessConfigModal

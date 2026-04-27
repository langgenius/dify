'use client'

import type { AccessRule } from '@/app/components/header/account-setting/access-rules-page/access-rule-row'
import { ScrollArea } from '@langgenius/dify-ui/scroll-area'
import AccessRulesEditor from '@/app/components/access-rules-editor'

// TODO: replace with the per-knowledge-base access rules fetched from the
// access-rules API once available. Mirrors the workspace-level Knowledge Base
// access rules catalog.
const DEFAULT_KB_ACCESS_RULES: AccessRule[] = [
  {
    id: 'kb-full-access',
    name: 'Full access',
    description: 'Highest level. Can edit, publish, delete, and manage access for this knowledge base.',
    assignedRoles: [
      { id: 'owner', name: 'Owner' },
      { id: 'admin', name: 'Admin' },
      { id: 'kb-admin', name: 'KB Admin' },
      { id: 'executive', name: 'Executive' },
    ],
    permissions: [],
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
    permissions: [],
  },
  {
    id: 'kb-can-view-and-use',
    name: 'Can view & use',
    description: 'View knowledge base sources, configs, and logs. Cannot modify content.',
    assignedRoles: [
      { id: 'member', name: 'Member' },
    ],
    permissions: [],
  },
  {
    id: 'kb-can-preview',
    name: 'Can preview',
    description: 'View in the list only. Cannot access the detail page.',
    assignedRoles: [
      { id: 'partner', name: 'Partner' },
    ],
    permissions: [],
  },
  {
    id: 'kb-can-test',
    name: 'Can test',
    description: 'Test knowledge base retrieval efficiency in sandbox.',
    assignedRoles: [
      { id: 'tester', name: 'Tester' },
    ],
    permissions: [],
  },
]

type DatasetAccessConfigPageProps = {
  datasetId: string
}

const DatasetAccessConfigPage = ({ datasetId: _datasetId }: DatasetAccessConfigPageProps) => {
  return (
    <ScrollArea
      className="h-full bg-components-panel-bg"
      slotClassNames={{ viewport: 'overscroll-contain' }}
    >
      <div className="px-12 py-8">
        <h1 className="title-2xl-semi-bold text-text-primary">Access Config</h1>
        <div className="mt-6">
          <AccessRulesEditor rules={DEFAULT_KB_ACCESS_RULES} />
        </div>
      </div>
    </ScrollArea>
  )
}

export default DatasetAccessConfigPage

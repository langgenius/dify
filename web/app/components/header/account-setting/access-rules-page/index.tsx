'use client'

import type { AccessRule } from './access-rule-row'
import type { PermissionSetFormValues, PermissionSetModalMode } from './permission-set-modal'
import type { ResourceType } from './permission-set-modal/permissions-data'
import { useCallback, useState } from 'react'
import AccessRuleSection from './access-rule-section'
import AddRuleTargetsModal from './add-rule-targets-modal'
import PermissionSetModal from './permission-set-modal'

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
    permissions: [
      'app.editing_and_layout',
      'app.test_and_debug',
      'app.delete',
      'app.import_export_dsl',
      'app.release_version_management',
      'app.annotation_management',
      'app.api_management.toggle',
      'app.api_management.create_key',
      'app.api_management.delete_key',
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
    permissions: [
      'app.editing_and_layout',
      'app.test_and_debug',
      'app.release_version_management',
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
    permissions: [
      'app.test_and_debug',
    ],
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
    permissions: [
      'kb.view',
      'kb.edit_configuration',
      'kb.manage_documents.add',
      'kb.manage_documents.delete',
      'kb.manage_documents.download',
      'kb.import_export_pipeline',
      'kb.pipeline_publishing_versioning',
      'kb.delete',
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
    permissions: [
      'kb.edit_configuration',
      'kb.manage_documents.add',
      'kb.manage_documents.delete',
      'kb.manage_documents.download',
    ],
  },
  {
    id: 'kb-can-view',
    name: 'Can view',
    description: 'View knowledge base sources and logs. Cannot modify content.',
    assignedRoles: [
      { id: 'member', name: 'Member' },
    ],
    permissions: ['kb.view'],
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
    permissions: ['kb.view'],
  },
]

type PermissionSetModalState = {
  mode: PermissionSetModalMode
  resourceType: ResourceType
  initialValues?: PermissionSetFormValues
}

const AccessRulesPage = () => {
  const [addingRule, setAddingRule] = useState<AccessRule | null>(null)
  const [permissionSetModalState, setPermissionSetModalState]
    = useState<PermissionSetModalState | null>(null)

  const closeAddModal = useCallback(() => {
    setAddingRule(null)
  }, [])

  const closePermissionSetModal = useCallback(() => {
    setPermissionSetModalState(null)
  }, [])

  const handleAddRole = useCallback((rule: AccessRule) => {
    setAddingRule(rule)
  }, [])

  const handleAddSubmit = useCallback(
    (_selection: { roleIds: string[], memberIds: string[] }) => {
      // TODO: wire up to API when backend is ready.
    },
    [],
  )

  const handleCreate = useCallback((resourceType: ResourceType) => {
    setPermissionSetModalState({ mode: 'create', resourceType })
  }, [])

  const handleEdit = useCallback(
    (resourceType: ResourceType, rule: AccessRule) => {
      setPermissionSetModalState({
        mode: 'edit',
        resourceType,
        initialValues: {
          name: rule.name,
          description: rule.description,
          permissions: rule.permissions,
        },
      })
    },
    [],
  )

  const handlePermissionSetSubmit = useCallback(
    (_values: PermissionSetFormValues) => {
      // TODO: wire up to API when backend is ready.
    },
    [],
  )

  const noop = useCallback(() => {
    // TODO: wire up to API when backend is ready.
  }, [])

  const createApp = useCallback(() => handleCreate('app'), [handleCreate])
  const createKb = useCallback(() => handleCreate('knowledge_base'), [handleCreate])
  const editApp = useCallback(
    (rule: AccessRule) => handleEdit('app', rule),
    [handleEdit],
  )
  const editKb = useCallback(
    (rule: AccessRule) => handleEdit('knowledge_base', rule),
    [handleEdit],
  )

  return (
    <>
      <div className="flex flex-col gap-6">
        <AccessRuleSection
          title="App Access Rules"
          rules={APP_ACCESS_RULES}
          createButtonLabel="Create App permission set"
          onCreate={createApp}
          onEditRule={editApp}
          onCopyRule={noop}
          onDeleteRule={noop}
          onAddRole={handleAddRole}
          onRemoveRole={noop}
        />
        <AccessRuleSection
          title="Knowledge Base Access Rules"
          rules={KNOWLEDGE_BASE_ACCESS_RULES}
          createButtonLabel="Create KB permission set"
          onCreate={createKb}
          onEditRule={editKb}
          onCopyRule={noop}
          onDeleteRule={noop}
          onAddRole={handleAddRole}
          onRemoveRole={noop}
        />
      </div>
      {addingRule && (
        <AddRuleTargetsModal
          open
          ruleName={addingRule.name}
          initialRoleIds={addingRule.assignedRoles.map(role => role.id)}
          initialMemberIds={[]}
          onClose={closeAddModal}
          onSubmit={handleAddSubmit}
        />
      )}
      {permissionSetModalState && (
        <PermissionSetModal
          open
          mode={permissionSetModalState.mode}
          resourceType={permissionSetModalState.resourceType}
          initialValues={permissionSetModalState.initialValues}
          onClose={closePermissionSetModal}
          onSubmit={handlePermissionSetSubmit}
        />
      )}
    </>
  )
}

export default AccessRulesPage

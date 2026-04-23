'use client'

import type { Role, RoleListGroup } from './role-list'
import type { RoleModalMode } from './role-modal'
import { Button } from '@langgenius/dify-ui/button'
import { useCallback, useState } from 'react'
import RoleList from './role-list'
import RoleModal from './role-modal'

const MOCK_ROLE_GROUPS: RoleListGroup[] = [
  {
    id: 'system',
    type: 'system',
    title: 'System roles',
    items: [
      {
        id: 'owner',
        name: 'Owner',
        description: 'Full access to all workspace features and settings.',
        permissions: [
          'manage_model_providers',
          'manage_members',
          'manage_roles_permissions',
          'manage_billing',
          'manage_data_sources',
          'manage_api_extensions',
          'create_apps',
          'view_all_apps',
          'delete_any_app',
          'create_knowledge_bases',
          'view_all_knowledge_bases',
          'delete_any_knowledge_base',
          'view_all_app_logs',
          'cross_app_log_access',
          'view_sensitive_fields',
          'install_plugins',
          'uninstall_plugins',
        ],
      },
      {
        id: 'admin',
        name: 'Admin',
        description: 'Manage apps, update settings, manage members and permissions.',
        permissions: [
          'manage_members',
          'manage_roles_permissions',
          'manage_data_sources',
          'create_apps',
          'view_all_apps',
          'create_knowledge_bases',
          'view_all_knowledge_bases',
        ],
      },
      {
        id: 'editor',
        name: 'Editor',
        description: 'Create and edit resources (knowledge bases, apps, plugins) without workspace settings access.',
        permissions: [
          'create_apps',
          'view_all_apps',
          'create_knowledge_bases',
          'view_all_knowledge_bases',
          'install_plugins',
        ],
      },
      {
        id: 'member',
        name: 'Member',
        description: 'Limited permissions within the workspace.',
        permissions: ['view_all_apps', 'view_all_knowledge_bases'],
      },
      {
        id: 'none',
        name: 'No Permission',
        description: 'Default role with no permissions assigned.',
        permissions: [],
      },
    ],
  },
  {
    id: 'custom',
    type: 'custom',
    title: 'Custom roles',
    items: [
      {
        id: 'executive',
        name: 'Executive',
        description: 'Unrestricted access to all workspace operations.',
        permissions: [
          'manage_model_providers',
          'manage_members',
          'manage_roles_permissions',
          'manage_billing',
          'create_apps',
          'view_all_apps',
          'create_knowledge_bases',
          'view_all_knowledge_bases',
        ],
      },
      {
        id: 'employee',
        name: 'Employee',
        description: 'Access to payroll bot and internal project knowledge bases.',
        permissions: ['view_all_apps', 'view_all_knowledge_bases'],
      },
      {
        id: 'partner',
        name: 'Partner',
        description: 'View external-facing apps: product info, feedback forms, and visitor registration.',
        permissions: ['view_all_apps'],
      },
    ],
  },
]

type ModalState = {
  mode: RoleModalMode
  role?: Role
} | null

const PermissionsPage = () => {
  const [modalState, setModalState] = useState<ModalState>(null)

  const openCreate = useCallback(() => {
    setModalState({ mode: 'create' })
  }, [])

  const handleView = useCallback((role: Role) => {
    setModalState({ mode: 'view', role })
  }, [])

  const handleEdit = useCallback((role: Role) => {
    setModalState({ mode: 'edit', role })
  }, [])

  const closeModal = useCallback(() => setModalState(null), [])

  const handleSubmit = useCallback(
    (_data: { name: string, description: string, permissions: string[] }) => {
      // TODO: wire up to API when backend is ready
    },
    [],
  )

  return (
    <>
      <div className="flex flex-col">
        <div className="mb-4 flex items-center gap-3 rounded-xl border-t-[0.5px] border-l-[0.5px] border-divider-subtle bg-linear-to-bl from-background-gradient-bg-fill-chat-bg-2 to-background-gradient-bg-fill-chat-bg-1 p-3 pr-5">
          <div className="flex grow flex-col gap-y-1">
            <div className="system-md-semibold text-text-primary">
              Default Global
            </div>
            <div className="system-sm-regular text-text-tertiary">
              A default global permission scheme applied to the workspace
            </div>
          </div>
          <div className="flex items-center">
            <Button
              variant="primary"
              size="small"
              onClick={openCreate}
            >
              + Add Role
            </Button>
          </div>
        </div>
        <RoleList
          groups={MOCK_ROLE_GROUPS}
          onView={handleView}
          onEdit={handleEdit}
        />
      </div>
      {modalState && (
        <RoleModal
          mode={modalState?.mode ?? 'create'}
          open
          role={modalState?.role}
          onClose={closeModal}
          onSubmit={handleSubmit}
        />
      )}
    </>
  )
}

export default PermissionsPage

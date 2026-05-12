'use client'

import type { RoleModalMode, submitRoleData } from './role-modal'
import type { Role } from '@/models/access-control'
import { Button } from '@langgenius/dify-ui/button'
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback, useState } from 'react'
import { useCreateWorkspaceRole, useUpdateWorkspaceRole } from '@/service/access-control/use-workspace-roles'
import { useRoleGroups } from './hooks'
import RoleList from './role-list'
import RoleModal from './role-modal'

type ModalState = {
  mode: RoleModalMode
  role?: Role
} | null

const PermissionsPage = () => {
  const [modalState, setModalState] = useState<ModalState>(null)

  const { roleGroups } = useRoleGroups({
    page: 1,
    limit: 20,
    include_owner: 1,
  })

  const { mutateAsync: createWorkspaceRole } = useCreateWorkspaceRole()
  const { mutateAsync: updateWorkspaceRole } = useUpdateWorkspaceRole()

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
    (data: submitRoleData) => {
      const { name, description, permissionKeys } = data
      const mode = modalState?.mode ?? ''
      const roleId = modalState?.role?.id ?? ''
      if (mode === 'create') {
        createWorkspaceRole({ name, description, permission_keys: permissionKeys }, {
          onSuccess: () => {
            toast.success('Role created successfully')
            closeModal()
          },
        })
      }
      else if (mode === 'edit') {
        updateWorkspaceRole({ id: roleId, name, description, permission_keys: permissionKeys }, {
          onSuccess: () => {
            toast.success('Role updated successfully')
            closeModal()
          },
        })
      }
    },
    [createWorkspaceRole, updateWorkspaceRole, closeModal, modalState],
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
          groups={roleGroups}
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

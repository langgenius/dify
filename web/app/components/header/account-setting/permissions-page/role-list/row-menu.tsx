'use client'
import type { Role, RoleCategory } from '@/models/access-control'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useMutation } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { consoleQuery } from '@/service/console'
import { hasPermission } from '@/utils/permission'
import { CopyMembersConfirmDialog } from './copy-members-confirm-dialog'

type RowMenuProps = {
  roleCategory: RoleCategory
  role: Role
  onView?: (role: Role) => void
  onEdit?: (role: Role) => void
}

const RowMenu = ({ roleCategory, role, onView, onEdit }: RowMenuProps) => {
  const { t } = useTranslation(['common', 'permission'])
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showCopyMembersConfirm, setShowCopyMembersConfirm] = useState(false)

  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canManageRoles = hasPermission(workspacePermissionKeys, 'workspace.role.manage')

  const handleView = useCallback(() => onView?.(role), [onView, role])

  const handleEdit = useCallback(() => {
    if (!canManageRoles) return

    onEdit?.(role)
  }, [canManageRoles, onEdit, role])

  const { mutate: copyRole, isPending: isCopyingRole } = useMutation(
    consoleQuery.workspaces.current.rbac.roles.byRoleId.copy.post.mutationOptions(),
  )

  const openCopyMembersConfirm = useCallback(() => {
    if (!canManageRoles) return

    setShowCopyMembersConfirm(true)
  }, [canManageRoles])

  const handleDuplicate = useCallback(
    (copyMember: boolean) => {
      if (!canManageRoles) return

      copyRole(
        { params: { role_id: role.id }, body: { copy_member: copyMember } },
        {
          onSuccess: () => {
            setShowCopyMembersConfirm(false)
          },
        },
      )
    },
    [canManageRoles, copyRole, role.id],
  )

  const { mutateAsync: deleteRole, isPending: isDeletingRole } = useMutation(
    consoleQuery.workspaces.current.rbac.roles.byRoleId.delete.mutationOptions(),
  )

  const openDeleteConfirm = useCallback(() => {
    if (!canManageRoles) return

    setShowDeleteConfirm(true)
  }, [canManageRoles])

  const handleDelete = useCallback(() => {
    if (!canManageRoles) return

    deleteRole(
      { params: { role_id: role.id } },
      {
        onSuccess: () => {
          setShowDeleteConfirm(false)
        },
      },
    )
  }, [canManageRoles, deleteRole, role.id])

  const hasViewAction = roleCategory === 'global_system_default'
  const hasEditAction = roleCategory === 'global_custom'
  const hasDeleteAction = roleCategory === 'global_custom'

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <IconButton
              size="md"
              className="shrink-0 data-popup-open:bg-state-base-hover"
              aria-label={t(($) => $['operation.moreActions'], { ns: 'common' })}
            >
              <span aria-hidden className="i-ri-more-fill h-4 w-4 text-text-tertiary" />
            </IconButton>
          }
        />
        <DropdownMenuContent side="bottom" align="end" sideOffset={4} className="min-w-40">
          {hasViewAction && (
            <DropdownMenuItem
              className="system-sm-semibold text-text-secondary"
              onClick={handleView}
            >
              {t(($) => $['operation.view'], { ns: 'common' })}
            </DropdownMenuItem>
          )}
          {hasEditAction && (
            <DropdownMenuItem
              disabled={!canManageRoles}
              className="system-sm-semibold text-text-secondary"
              onClick={handleEdit}
            >
              {t(($) => $['operation.edit'], { ns: 'common' })}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            disabled={!canManageRoles}
            className="system-sm-semibold text-text-secondary"
            onClick={openCopyMembersConfirm}
          >
            {t(($) => $['common.duplicateAction'], { ns: 'permission' })}
          </DropdownMenuItem>
          {hasDeleteAction && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={!canManageRoles}
                variant="destructive"
                className="system-sm-semibold"
                onClick={openDeleteConfirm}
              >
                {t(($) => $['operation.delete'], { ns: 'common' })}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog
        open={showDeleteConfirm}
        onOpenChange={(open) => !open && setShowDeleteConfirm(false)}
      >
        <AlertDialogContent backdropProps={{ forceRender: true }}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $['role.deleteTitle'], { ns: 'permission', name: role.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $['role.deleteDescription'], { ns: 'permission' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton disabled={isDeletingRole} onClick={handleDelete}>
              {t(($) => $['operation.delete'], { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {showCopyMembersConfirm && (
        <CopyMembersConfirmDialog
          role={role}
          isCopyingRole={isCopyingRole}
          onOpenChange={setShowCopyMembersConfirm}
          onDuplicate={handleDuplicate}
        />
      )}
    </>
  )
}

export default RowMenu

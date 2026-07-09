'use client'
import type { Role, RoleCategory } from '@/models/access-control'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import { useAtomValue } from 'jotai'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { workspacePermissionKeysAtom } from '@/context/permission-state'
import { useCopyWorkspaceRole, useDeleteWorkspaceRole } from '@/service/access-control/use-workspace-roles'
import { hasPermission } from '@/utils/permission'
import { CopyMembersConfirmDialog } from './copy-members-confirm-dialog'

type RowMenuProps = {
  roleCategory: RoleCategory
  role: Role
  onView?: (role: Role) => void
  onEdit?: (role: Role) => void
}

const RowMenu = ({
  roleCategory,
  role,
  onView,
  onEdit,
}: RowMenuProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showCopyMembersConfirm, setShowCopyMembersConfirm] = useState(false)

  const workspacePermissionKeys = useAtomValue(workspacePermissionKeysAtom)
  const canManageRoles = hasPermission(workspacePermissionKeys, 'workspace.role.manage')

  const handleView = useCallback(() => onView?.(role), [onView, role])

  const handleEdit = useCallback(() => {
    if (!canManageRoles)
      return

    onEdit?.(role)
  }, [canManageRoles, onEdit, role])

  const { mutate: copyRole, isPending: isCopyingRole } = useCopyWorkspaceRole()

  const openCopyMembersConfirm = useCallback(() => {
    if (!canManageRoles)
      return

    setShowCopyMembersConfirm(true)
    setOpen(false)
  }, [canManageRoles])

  const handleDuplicate = useCallback((copyMember: boolean) => {
    if (!canManageRoles)
      return

    copyRole({
      roleId: role.id,
      copy_member: copyMember,
    }, {
      onSuccess: () => {
        toast.success(t('role.duplicated', { ns: 'permission' }))
        setShowCopyMembersConfirm(false)
      },
    })
  }, [canManageRoles, copyRole, role.id, t])

  const { mutateAsync: deleteRole, isPending: isDeletingRole } = useDeleteWorkspaceRole()

  const openDeleteConfirm = useCallback(() => {
    if (!canManageRoles)
      return

    setShowDeleteConfirm(true)
    setOpen(false)
  }, [canManageRoles])

  const handleDelete = useCallback(() => {
    if (!canManageRoles)
      return

    deleteRole(role.id, {
      onSuccess: () => {
        toast.success(t('role.deleted', { ns: 'permission' }))
        setShowDeleteConfirm(false)
      },
    })
  }, [canManageRoles, deleteRole, role.id, t])

  const hasViewAction = roleCategory === 'global_system_default'
  const hasEditAction = roleCategory === 'global_custom'
  const hasDeleteAction = roleCategory === 'global_custom'

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger render={<ActionButton size="m" className={cn('shrink-0', open && 'bg-state-base-hover')} aria-label={t('operation.moreActions', { ns: 'common' })} />}>
          <span aria-hidden className="i-ri-more-fill h-4 w-4 text-text-tertiary" />
        </DropdownMenuTrigger>
        <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="min-w-[160px]">
          {
            hasViewAction && (
              <DropdownMenuItem className="system-sm-semibold text-text-secondary" onClick={handleView}>
                {t('operation.view', { ns: 'common' })}
              </DropdownMenuItem>
            )
          }
          {
            hasEditAction && (
              <DropdownMenuItem
                disabled={!canManageRoles}
                className="system-sm-semibold text-text-secondary"
                onClick={handleEdit}
              >
                {t('operation.edit', { ns: 'common' })}
              </DropdownMenuItem>
            )
          }
          <DropdownMenuItem
            disabled={!canManageRoles}
            className="system-sm-semibold text-text-secondary"
            onClick={openCopyMembersConfirm}
          >
            {t('common.duplicateAction', { ns: 'permission' })}
          </DropdownMenuItem>
          {
            hasDeleteAction && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!canManageRoles}
                  variant="destructive"
                  className="system-sm-semibold"
                  onClick={openDeleteConfirm}
                >
                  {t('operation.delete', { ns: 'common' })}
                </DropdownMenuItem>
              </>
            )
          }
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={showDeleteConfirm} onOpenChange={open => !open && setShowDeleteConfirm(false)}>
        <AlertDialogContent backdropProps={{ forceRender: true }}>
          <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
            <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
              {t('role.deleteTitle', { ns: 'permission', name: role.name })}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              {t('role.deleteDescription', { ns: 'permission' })}
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>{t('operation.cancel', { ns: 'common' })}</AlertDialogCancelButton>
            <AlertDialogConfirmButton
              disabled={isDeletingRole}
              onClick={handleDelete}
            >
              {t('operation.delete', { ns: 'common' })}
            </AlertDialogConfirmButton>
          </AlertDialogActions>
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

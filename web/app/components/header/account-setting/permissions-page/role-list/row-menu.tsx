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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useCopyWorkspaceRole, useDeleteWorkspaceRole } from '@/service/access-control/use-workspace-roles'
import { hasPermission } from '@/utils/permission'

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

  const workspacePermissionKeys = useAppContextWithSelector(s => s.workspacePermissionKeys)

  const handleView = useCallback(() => onView?.(role), [onView, role])

  const handleEdit = useCallback(() => onEdit?.(role), [onEdit, role])

  const { mutateAsync: copyRole } = useCopyWorkspaceRole()

  const handleDuplicate = useCallback(() => {
    copyRole(role.id, {
      onSuccess: () => {
        toast.success(t('role.duplicated', { ns: 'permission' }))
        setOpen(false)
      },
    })
  }, [copyRole, role.id, t])

  const { mutateAsync: deleteRole, isPending: isDeletingRole } = useDeleteWorkspaceRole()

  const openDeleteConfirm = useCallback(() => {
    setShowDeleteConfirm(true)
    setOpen(false)
  }, [])

  const handleDelete = useCallback(() => {
    deleteRole(role.id, {
      onSuccess: () => {
        toast.success(t('role.deleted', { ns: 'permission' }))
        setShowDeleteConfirm(false)
      },
    })
  }, [deleteRole, role.id, t])

  const canManageRoles = hasPermission(workspacePermissionKeys, 'workspace.role.manage')

  const hasEditAction = (roleCategory === 'global_custom' || (roleCategory === 'global_system_default' && role.role_tag !== 'owner')) && canManageRoles
  const hasDuplicateAction = roleCategory === 'global_custom' && canManageRoles
  const hasDeleteAction = roleCategory === 'global_custom' && canManageRoles

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger render={<ActionButton size="l" className={open ? 'bg-state-base-hover' : ''} aria-label={t('operation.moreActions', { ns: 'common' })} />}>
          <span aria-hidden className="i-ri-more-fill h-4 w-4 text-text-tertiary" />
        </DropdownMenuTrigger>
        <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="min-w-[160px]">
          <DropdownMenuItem className="system-sm-semibold text-text-secondary" onClick={handleView}>
            {t('operation.view', { ns: 'common' })}
          </DropdownMenuItem>
          {
            hasEditAction && (
              <DropdownMenuItem className="system-sm-semibold text-text-secondary" onClick={handleEdit}>
                {t('operation.edit', { ns: 'common' })}
              </DropdownMenuItem>
            )
          }
          {
            hasDuplicateAction && (
              <DropdownMenuItem className="system-sm-semibold text-text-secondary" onClick={handleDuplicate}>
                {t('operation.duplicate', { ns: 'common' })}
              </DropdownMenuItem>
            )
          }
          {
            hasDeleteAction && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" className="system-sm-semibold" onClick={openDeleteConfirm}>
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
    </>
  )
}

export default RowMenu

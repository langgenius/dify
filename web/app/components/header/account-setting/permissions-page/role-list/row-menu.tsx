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
  const [open, setOpen] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const workspacePermissionKeys = useAppContextWithSelector(s => s.workspacePermissionKeys)

  const handleView = useCallback(() => onView?.(role), [onView, role])

  const handleEdit = useCallback(() => onEdit?.(role), [onEdit, role])

  const { mutateAsync: copyRole } = useCopyWorkspaceRole()

  const handleDuplicate = useCallback(() => {
    copyRole(role.id, {
      onSuccess: () => {
        toast.success('Role duplicated successfully')
        setOpen(false)
      },
    })
  }, [copyRole, role.id])

  const { mutateAsync: deleteRole, isPending: isDeletingRole } = useDeleteWorkspaceRole()

  const openDeleteConfirm = useCallback(() => {
    setShowDeleteConfirm(true)
    setOpen(false)
  }, [])

  const handleDelete = useCallback(() => {
    deleteRole(role.id, {
      onSuccess: () => {
        toast.success('Role deleted successfully')
        setShowDeleteConfirm(false)
      },
    })
  }, [deleteRole, role.id])

  const canManageRoles = hasPermission(workspacePermissionKeys, 'workspace.role.manage')

  const hasEditAction = (roleCategory === 'global_custom' || (roleCategory === 'global_system_default' && role.role_tag !== 'owner')) && canManageRoles
  const hasDuplicateAction = roleCategory === 'global_custom' && canManageRoles
  const hasDeleteAction = roleCategory === 'global_custom' && canManageRoles

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger render={<ActionButton size="l" className={open ? 'bg-state-base-hover' : ''} aria-label="More actions" />}>
          <span aria-hidden className="i-ri-more-fill h-4 w-4 text-text-tertiary" />
        </DropdownMenuTrigger>
        <DropdownMenuContent placement="bottom-end" sideOffset={4} popupClassName="min-w-[160px]">
          <DropdownMenuItem className="system-sm-semibold text-text-secondary" onClick={handleView}>
            View
          </DropdownMenuItem>
          {
            hasEditAction && (
              <DropdownMenuItem className="system-sm-semibold text-text-secondary" onClick={handleEdit}>
                Edit
              </DropdownMenuItem>
            )
          }
          {
            hasDuplicateAction && (
              <DropdownMenuItem className="system-sm-semibold text-text-secondary" onClick={handleDuplicate}>
                Duplicate
              </DropdownMenuItem>
            )
          }
          {
            hasDeleteAction && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" className="system-sm-semibold" onClick={openDeleteConfirm}>
                  Delete
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
              {`Delete "${role.name}"?`}
            </AlertDialogTitle>
            <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
              This role will be permanently deleted and removed from any members or access rules that use it.
            </AlertDialogDescription>
          </div>
          <AlertDialogActions>
            <AlertDialogCancelButton>Cancel</AlertDialogCancelButton>
            <AlertDialogConfirmButton
              disabled={isDeletingRole}
              onClick={handleDelete}
            >
              Delete
            </AlertDialogConfirmButton>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default RowMenu

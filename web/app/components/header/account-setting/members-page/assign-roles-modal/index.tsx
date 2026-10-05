'use client'
import type { Role } from '@/models/access-control'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import WorkspaceRoleCheckboxList from '../../workspace-role-checkbox-list'

type AssignRolesModalProps = {
  selectedRoles: Role[]
  allowMultipleRoles?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (roles: Role[]) => void
}

type AssignRolesModalBodyProps = Omit<AssignRolesModalProps, 'open'>

const AssignRolesModalBody = ({
  selectedRoles,
  allowMultipleRoles = true,
  onOpenChange,
  onSubmit,
}: AssignRolesModalBodyProps) => {
  const { t } = useTranslation(['common', 'workspaceMembers'])
  const [selected, setSelected] = useState(selectedRoles)
  const selectedRoleIds = selected.map((role) => role.id)
  const isConfirmDisabled = selected.length === 0
  const title = allowMultipleRoles
    ? t(($) => $['members.assignRolesModal.title'], {
        ns: 'workspaceMembers',
        defaultValue: 'Assign Roles',
      })
    : t(($) => $['members.editRole'], { ns: 'workspaceMembers', defaultValue: 'Edit Role' })
  const description = allowMultipleRoles
    ? t(($) => $['members.assignRolesModal.description'], {
        ns: 'workspaceMembers',
        defaultValue:
          'Select roles to assign to this member. All permissions from selected roles will be combined.',
      })
    : t(($) => $['members.assignRolesModal.singleDescription'], {
        ns: 'workspaceMembers',
        defaultValue: 'Select one role to assign to this member.',
      })

  const handleConfirm = () => {
    if (isConfirmDisabled) return

    onSubmit(selected)
    onOpenChange(false)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative shrink-0 px-6 pt-6 pb-4">
        <DialogClose
          render={
            <IconButton
              aria-label={t(($) => $['operation.close'], { ns: 'common' })}
              size="lg"
              className="absolute inset-e-6 top-6"
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          }
        />
        <div className="pr-8">
          <DialogTitle className="system-xl-semibold text-text-primary">{title}</DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {description}
          </DialogDescription>
        </div>
      </div>

      <WorkspaceRoleCheckboxList
        selectedRoleIds={selectedRoleIds}
        selectedRoles={selected}
        allowMultipleRoles={allowMultipleRoles}
        onSelectedRolesChange={setSelected}
      />

      <div className="flex shrink-0 items-center gap-3 border-t border-divider-subtle px-6 py-4">
        {allowMultipleRoles && (
          <div className="system-xs-regular text-text-tertiary">
            {t(($) => $['members.assignRolesModal.selectedCount'], {
              ns: 'workspaceMembers',
              count: selected.length,
            })}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <DialogClose render={<Button variant="secondary" />}>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </DialogClose>
          <Button variant="primary" disabled={isConfirmDisabled} onClick={handleConfirm}>
            {t(($) => $['operation.confirm'], { ns: 'common' })}
          </Button>
        </div>
      </div>
    </div>
  )
}

export function AssignRolesModal({ open, onOpenChange, ...props }: AssignRolesModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-121 w-120 flex-col overflow-hidden p-0"
        backdropProps={{ forceRender: true }}
      >
        <AssignRolesModalBody {...props} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  )
}

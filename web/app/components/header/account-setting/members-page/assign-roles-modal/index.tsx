'use client'
import type { Role } from '@/models/access-control'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import WorkspaceRoleCheckboxList from '../../workspace-role-checkbox-list'

type AssignRolesModalProps = {
  selectedRoles: Role[]
  allowMultipleRoles?: boolean
  onClose: () => void
  onSubmit: (roles: Role[]) => void
}

const AssignRolesModalBody = ({
  selectedRoles,
  allowMultipleRoles = true,
  onClose,
  onSubmit,
}: AssignRolesModalProps) => {
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
    onClose()
  }

  return (
    <DialogContent className="flex h-121 flex-col" backdropProps={{ forceRender: true }}>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <DialogCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
      </DialogHeader>

      <WorkspaceRoleCheckboxList
        selectedRoleIds={selectedRoleIds}
        selectedRoles={selected}
        allowMultipleRoles={allowMultipleRoles}
        onSelectedRolesChange={setSelected}
      />

      <DialogFooter className="border-t border-divider-subtle">
        {allowMultipleRoles && (
          <div className="me-auto system-xs-regular text-text-tertiary">
            {t(($) => $['members.assignRolesModal.selectedCount'], {
              ns: 'workspaceMembers',
              count: selected.length,
            })}
          </div>
        )}
        <Button variant="secondary" onClick={onClose}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </Button>
        <Button variant="primary" disabled={isConfirmDisabled} onClick={handleConfirm}>
          {t(($) => $['operation.confirm'], { ns: 'common' })}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

const AssignRolesModal = ({
  selectedRoles,
  allowMultipleRoles = true,
  onClose,
  onSubmit,
}: AssignRolesModalProps) => {
  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <AssignRolesModalBody
        selectedRoles={selectedRoles}
        allowMultipleRoles={allowMultipleRoles}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </Dialog>
  )
}

export default AssignRolesModal

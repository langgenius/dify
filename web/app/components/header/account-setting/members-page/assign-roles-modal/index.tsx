'use client'

import type { Role } from '@/models/access-control'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useState } from 'react'
import { useTranslation } from '#i18n'
import WorkspaceRoleCheckboxList from '../../workspace-role-checkbox-list'

type AssignRolesModalProps = {
  selectedRoles: Role[]
  allowMultipleRoles?: boolean
  onClose: () => void
  onSubmit: (roles: Role[]) => void
}

type AssignRolesModalBodyProps = AssignRolesModalProps

const AssignRolesModalBody = ({
  selectedRoles,
  allowMultipleRoles = true,
  onClose,
  onSubmit,
}: AssignRolesModalBodyProps) => {
  const { t } = useTranslation()
  const [selected, setSelected] = useState(selectedRoles)
  const selectedRoleIds = selected.map(role => role.id)
  const isConfirmDisabled = selected.length === 0
  const title = allowMultipleRoles
    ? t('members.assignRolesModal.title', { ns: 'common', defaultValue: 'Assign Roles' })
    : t('members.editRole', { ns: 'common', defaultValue: 'Edit Role' })
  const description = allowMultipleRoles
    ? t('members.assignRolesModal.description', {
        ns: 'common',
        defaultValue:
          'Select roles to assign to this member. All permissions from selected roles will be combined.',
      })
    : t('members.assignRolesModal.singleDescription', {
        ns: 'common',
        defaultValue: 'Select one role to assign to this member.',
      })

  const handleConfirm = () => {
    if (isConfirmDisabled)
      return

    onSubmit(selected)
    onClose()
  }

  return (
    <DialogContent
      className="flex h-121 w-120 flex-col overflow-hidden p-0"
      backdropProps={{ forceRender: true }}
    >
      <div className="relative shrink-0 px-6 pt-6 pb-4">
        <DialogCloseButton />
        <div className="pr-8">
          <DialogTitle className="system-xl-semibold text-text-primary">
            {title}
          </DialogTitle>
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
            {t('members.assignRolesModal.selectedCount', {
              ns: 'common',
              count: selected.length,
            })}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('operation.cancel', { ns: 'common' })}
          </Button>
          <Button variant="primary" disabled={isConfirmDisabled} onClick={handleConfirm}>
            {t('operation.confirm', { ns: 'common' })}
          </Button>
        </div>
      </div>
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
        if (!nextOpen)
          onClose()
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

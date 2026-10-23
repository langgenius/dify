'use client'
import type { Ref } from 'react'
import type { Role } from '@/models/access-control'
import { Button } from '@langgenius/dify-ui/button'
import {
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import WorkspaceRoleCheckboxList from '../../workspace-role-checkbox-list'

type AssignRolesContentProps = {
  selectedRoles: Role[]
  allowMultipleRoles?: boolean
  searchInputRef: Ref<HTMLInputElement>
  onSubmit: (roles: Role[]) => void
}

const AssignRolesContent = ({
  selectedRoles,
  allowMultipleRoles = true,
  searchInputRef,
  onSubmit,
}: AssignRolesContentProps) => {
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
  }

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault()
        handleConfirm()
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
      </DialogHeader>

      <WorkspaceRoleCheckboxList
        searchInputRef={searchInputRef}
        selectedRoleIds={selectedRoleIds}
        selectedRoles={selected}
        allowMultipleRoles={allowMultipleRoles}
        onSelectedRolesChange={setSelected}
      />

      <DialogFooter>
        {allowMultipleRoles && (
          <div className="me-auto system-xs-regular text-text-tertiary">
            {t(($) => $['members.assignRolesModal.selectedCount'], {
              ns: 'workspaceMembers',
              count: selected.length,
            })}
          </div>
        )}
        <DialogClose render={<Button variant="secondary" />}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </DialogClose>
        <Button variant="primary" disabled={isConfirmDisabled} type="submit">
          {t(($) => $['operation.confirm'], { ns: 'common' })}
        </Button>
      </DialogFooter>
    </form>
  )
}

export default AssignRolesContent

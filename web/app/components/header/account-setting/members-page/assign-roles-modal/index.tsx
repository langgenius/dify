'use client'

import type { Member } from '@/models/common'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import WorkspaceRoleCheckboxList from '../../workspace-role-checkbox-list'

export type AssignRolesModalProps = {
  member: Member
  onClose: () => void
  onSubmit: (roleIds: string[]) => void
}

type AssignRolesModalBodyProps = AssignRolesModalProps

const AssignRolesModalBody = ({
  member,
  onClose,
  onSubmit,
}: AssignRolesModalBodyProps) => {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<string[]>(() => {
    return member.roles?.map(role => role.id) || []
  })

  const handleConfirm = () => {
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
            {t('members.assignRolesModal.title', { ns: 'common', defaultValue: 'Assign Roles' })}
          </DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {t('members.assignRolesModal.description', {
              ns: 'common',
              defaultValue:
                'Select roles to assign to this member. All permissions from selected roles will be combined.',
            })}
          </DialogDescription>
        </div>
      </div>

      <WorkspaceRoleCheckboxList
        selectedRoleIds={selected}
        onSelectedRoleIdsChange={setSelected}
      />

      <div className="flex shrink-0 items-center justify-between gap-3 border-t border-divider-subtle px-6 py-4">
        <div className="system-xs-regular text-text-tertiary">
          {t('members.assignRolesModal.selectedCount', {
            ns: 'common',
            count: selected.length,
          })}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('operation.cancel', { ns: 'common' })}
          </Button>
          <Button variant="primary" onClick={handleConfirm}>
            {t('operation.confirm', { ns: 'common' })}
          </Button>
        </div>
      </div>
    </DialogContent>
  )
}

const AssignRolesModal = ({
  member,
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
        member={member}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    </Dialog>
  )
}

export default AssignRolesModal

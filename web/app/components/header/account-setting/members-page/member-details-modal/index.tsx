'use client'

import type { Member } from '@/models/common'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AssignRolesModal from '../assign-roles-modal'
import PermissionRoleChip from './permission-role-chip'

export type MemberDetailsModalProps = {
  open: boolean
  member: Member
  roleLabel: string
  canAssignRoles?: boolean
  onClose: () => void
  onAssignSubmit?: (roleIds: string[]) => void
}

const MemberDetailsModal = ({
  open,
  member,
  roleLabel,
  canAssignRoles = false,
  onClose,
  onAssignSubmit,
}: MemberDetailsModalProps) => {
  const { t } = useTranslation()
  const [assignOpen, setAssignOpen] = useState(false)

  const assignedRoles = [{ key: member.role, label: roleLabel }]

  const handleAssignSubmit = (ids: string[]) => {
    onAssignSubmit?.(ids)
    setAssignOpen(false)
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next)
            onClose()
        }}
      >
        <DialogContent className="w-[440px] overflow-visible p-0" backdropProps={{ forceRender: true }}>
          <div className="relative px-6 pt-6 pb-5">
            <DialogCloseButton />
            <DialogTitle className="pr-8 system-xl-semibold text-text-primary">
              {t('members.memberDetails.title', {
                ns: 'common',
                defaultValue: 'Member Details',
              })}
            </DialogTitle>

            <div className="mt-5 flex items-center gap-3">
              <Avatar
                avatar={member.avatar_url}
                name={member.name}
                size="2xl"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate system-md-semibold text-text-primary">
                  {member.name}
                </div>
                <div className="truncate system-xs-regular text-text-tertiary">
                  {member.email}
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-divider-subtle px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 system-sm-semibold text-text-secondary">
                <span>
                  {t('members.memberDetails.assignedRoles', {
                    ns: 'common',
                    defaultValue: 'Assigned Roles',
                  })}
                </span>
                <span className="system-xs-medium text-text-tertiary">
                  {assignedRoles.length}
                </span>
              </div>
              {canAssignRoles && (
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => setAssignOpen(true)}
                >
                  <span
                    aria-hidden
                    className="mr-0.5 i-ri-add-line h-3.5 w-3.5"
                  />
                  {t('members.memberDetails.assign', {
                    ns: 'common',
                    defaultValue: 'Assign',
                  })}
                </Button>
              )}
            </div>

            <div className="mt-4">
              <div className="mb-2 system-2xs-medium-uppercase text-text-tertiary">
                {t('members.memberDetails.generalGroup', {
                  ns: 'common',
                  defaultValue: 'GENERAL',
                })}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {assignedRoles.map(role => (
                  <PermissionRoleChip
                    key={role.key}
                    roleKey={role.key}
                    label={role.label}
                    highlighted
                  />
                ))}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {assignOpen && (
        <AssignRolesModal
          open={assignOpen}
          member={member}
          onClose={() => setAssignOpen(false)}
          onSubmit={handleAssignSubmit}
        />
      )}
    </>
  )
}

export default memo(MemberDetailsModal)

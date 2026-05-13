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
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useRolesOfMember } from '@/service/access-control/use-member-roles'
import AssignRolesModal from '../assign-roles-modal'
import PermissionRoleChip from './permission-role-chip'

export type MemberDetailsModalProps = {
  member: Member
  canAssignRoles?: boolean
  onClose: () => void
  onAssignSubmit?: (roleIds: string[]) => void
}

const MemberDetailsModal = ({
  member,
  canAssignRoles = false,
  onClose,
  onAssignSubmit,
}: MemberDetailsModalProps) => {
  const { t } = useTranslation()
  const [assignOpen, setAssignOpen] = useState(false)

  const { data: rolesOfMember } = useRolesOfMember(member.id)

  const roles = rolesOfMember?.roles || []

  const builtinRoles = roles.filter(role => role.is_builtin)
  const customRoles = roles.filter(role => !role.is_builtin)

  const handleClose = useCallback(() => {
    setAssignOpen(false)
  }, [])

  const handleAssignSubmit = useCallback((ids: string[]) => {
    onAssignSubmit?.(ids)
    setAssignOpen(false)
  }, [onAssignSubmit])

  const handleRemove = useCallback((id: string) => {
    const roleIds = member.roles.map(role => role.id).filter(roleId => roleId !== id)
    onAssignSubmit?.(roleIds)
  }, [member.roles, onAssignSubmit])

  return (
    <>
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next)
            onClose()
        }}
      >
        <DialogContent className="w-110 overflow-visible p-0" backdropProps={{ forceRender: true }}>
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
                  {roles.length}
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

            {builtinRoles.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 system-2xs-medium-uppercase text-text-tertiary">
                  {t('members.memberDetails.generalGroup', {
                    ns: 'common',
                  })}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {builtinRoles.map(role => (
                    <PermissionRoleChip
                      key={role.id}
                      roleId={role.id}
                      label={role.name}
                      isOwner={role.role_tag === 'owner'}
                      permissionKeys={role.permission_keys}
                      onRemove={handleRemove}
                    />
                  ))}
                </div>
              </div>
            )}
            {customRoles.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 system-2xs-medium-uppercase text-text-tertiary">
                  {t('members.memberDetails.customGroup', {
                    ns: 'common',
                  })}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {customRoles.map(role => (
                    <PermissionRoleChip
                      key={role.id}
                      roleId={role.id}
                      label={role.name}
                      isOwner={role.role_tag === 'owner'}
                      permissionKeys={role.permission_keys}
                      onRemove={handleRemove}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {assignOpen && (
        <AssignRolesModal
          member={member}
          onClose={handleClose}
          onSubmit={handleAssignSubmit}
        />
      )}
    </>
  )
}

export default memo(MemberDetailsModal)

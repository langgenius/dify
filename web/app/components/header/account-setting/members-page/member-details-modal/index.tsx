'use client'

import type { Role } from '@/models/access-control'
import type { Member } from '@/models/common'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from '#i18n'
import Loading from '@/app/components/base/loading'
import { useLocale } from '@/context/i18n'
import { getAccessControlTemplateLanguage } from '@/i18n-config/language'
import { useRolesOfMember } from '@/service/access-control/use-member-roles'
import AssignRolesModal from '../assign-roles-modal'
import PermissionRoleChip from './permission-role-chip'

type MemberDetailsModalProps = {
  member: Member
  canAssignRoles?: boolean
  allowMultipleRoles?: boolean
  onClose: () => void
  onAssignSubmit?: (roles: Role[]) => void
}

const MemberDetailsModal = ({
  member,
  canAssignRoles = false,
  allowMultipleRoles = true,
  onClose,
  onAssignSubmit,
}: MemberDetailsModalProps) => {
  const { t } = useTranslation()
  const locale = useLocale()
  const [assignOpen, setAssignOpen] = useState(false)
  const language = useMemo(() => getAccessControlTemplateLanguage(locale), [locale])

  const { data: rolesOfMember, isLoading: isLoadingRolesOfMember } = useRolesOfMember(member.id, language)
  const [pendingRoles, setPendingRoles] = useState<Role[]>()

  const roles = useMemo(() => rolesOfMember?.roles ?? [], [rolesOfMember?.roles])
  const selectedRoles = pendingRoles ?? roles
  const selectedRoleIds = useMemo(() => selectedRoles.map(role => role.id), [selectedRoles])
  const canRemoveRoles = canAssignRoles && allowMultipleRoles
  const assignedRolesLabel = selectedRoleIds.length === 1
    ? t('members.memberDetails.assignedRole', {
        ns: 'common',
        defaultValue: 'Assigned Role',
      })
    : t('members.memberDetails.assignedRoles', {
        ns: 'common',
        defaultValue: 'Assigned Roles',
      })
  const assignActionIconClassName = allowMultipleRoles
    ? 'mr-0.5 i-ri-add-line h-3.5 w-3.5'
    : 'mr-0.5 i-ri-edit-line h-3.5 w-3.5'
  const assignActionLabel = allowMultipleRoles
    ? t('members.memberDetails.assign', {
        ns: 'common',
        defaultValue: 'Assign',
      })
    : t('operation.edit', { ns: 'common' })

  const builtinRoles = useMemo(() => selectedRoles.filter(role => role.is_builtin), [selectedRoles])
  const customRoles = useMemo(() => selectedRoles.filter(role => !role.is_builtin), [selectedRoles])

  const handleClose = useCallback(() => {
    setAssignOpen(false)
  }, [])

  const handleAssignSubmit = useCallback((roles: Role[]) => {
    setPendingRoles(allowMultipleRoles ? roles : roles.slice(0, 1))
    setAssignOpen(false)
  }, [allowMultipleRoles])

  const handleRemove = useCallback((roleId: string) => {
    if (!allowMultipleRoles && selectedRoles.length <= 1)
      return

    setPendingRoles(selectedRoles.filter(selectedRole => selectedRole.id !== roleId))
  }, [allowMultipleRoles, selectedRoles])

  const handleSave = useCallback(() => {
    onAssignSubmit?.(allowMultipleRoles ? selectedRoles : selectedRoles.slice(0, 1))
    onClose()
  }, [allowMultipleRoles, onAssignSubmit, onClose, selectedRoles])

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
                  {assignedRolesLabel}
                </span>
                {!isLoadingRolesOfMember && (
                  <span className="system-xs-medium text-text-tertiary">
                    {selectedRoleIds.length}
                  </span>
                )}
              </div>
              {canAssignRoles && (
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => setAssignOpen(true)}
                >
                  <span
                    aria-hidden
                    className={assignActionIconClassName}
                  />
                  {assignActionLabel}
                </Button>
              )}
            </div>

            {isLoadingRolesOfMember
              ? (
                  <div className="mt-4">
                    <Loading />
                  </div>
                )
              : (
                  <>
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
                              onRemove={canRemoveRoles ? handleRemove : undefined}
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
                              onRemove={canRemoveRoles ? handleRemove : undefined}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
          </div>

          {canAssignRoles && (
            <div className="flex items-center justify-end gap-2 px-6 pt-2 pb-4">
              <Button variant="secondary" onClick={onClose}>
                {t('operation.cancel', { ns: 'common' })}
              </Button>
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={!onAssignSubmit}
              >
                {t('operation.save', { ns: 'common' })}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {assignOpen && (
        <AssignRolesModal
          selectedRoles={selectedRoles}
          allowMultipleRoles={allowMultipleRoles}
          onClose={handleClose}
          onSubmit={handleAssignSubmit}
        />
      )}
    </>
  )
}

export default memo(MemberDetailsModal)

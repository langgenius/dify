'use client'
import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { Role } from '@/models/access-control'
import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { useQuery } from '@tanstack/react-query'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { getAccessControlTemplateLanguage } from '@/i18n/language'
import { consoleQuery } from '@/service/console'
import { getAvatarInitial } from '@/utils/avatar'
import { toRole } from '../../workspace-role-list-query'
import AssignRolesModal from '../assign-roles-modal'
import PermissionRoleChip from './permission-role-chip'

type MemberDetailsModalProps = {
  member: AccountWithRoleResponse
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
  const { t } = useTranslation(['common', 'workspaceMembers'])
  const locale = useLocale()
  const [assignOpen, setAssignOpen] = useState(false)
  const language = useMemo(() => getAccessControlTemplateLanguage(locale), [locale])

  const { data: rolesOfMember, isLoading: isLoadingRolesOfMember } = useQuery(
    consoleQuery.workspaces.current.rbac.members.byMemberId.rbacRoles.get.queryOptions({
      input: { params: { member_id: member.id }, query: { language } },
      select: (data) => ({ ...data, roles: (data.roles ?? []).map(toRole) }),
    }),
  )
  const [pendingRoles, setPendingRoles] = useState<Role[]>()

  const roles = useMemo(() => rolesOfMember?.roles ?? [], [rolesOfMember?.roles])
  const selectedRoles = pendingRoles ?? roles
  const selectedRoleIds = useMemo(() => selectedRoles.map((role) => role.id), [selectedRoles])
  const canRemoveRoles = canAssignRoles && allowMultipleRoles
  const assignedRolesLabel =
    selectedRoleIds.length === 1
      ? t(($) => $['members.memberDetails.assignedRole'], {
          ns: 'workspaceMembers',
          defaultValue: 'Assigned Role',
        })
      : t(($) => $['members.memberDetails.assignedRoles'], {
          ns: 'workspaceMembers',
          defaultValue: 'Assigned Roles',
        })
  const assignActionIconClassName = allowMultipleRoles
    ? 'i-ri-add-line h-3.5 w-3.5'
    : 'i-ri-edit-line h-3.5 w-3.5'
  const assignActionLabel = allowMultipleRoles
    ? t(($) => $['members.memberDetails.assign'], {
        ns: 'workspaceMembers',
        defaultValue: 'Assign',
      })
    : t(($) => $['operation.edit'], { ns: 'common' })

  const builtinRoles = useMemo(
    () => selectedRoles.filter((role) => role.is_builtin),
    [selectedRoles],
  )
  const customRoles = useMemo(
    () => selectedRoles.filter((role) => !role.is_builtin),
    [selectedRoles],
  )

  const handleClose = useCallback(() => {
    setAssignOpen(false)
  }, [])

  const handleAssignSubmit = useCallback(
    (roles: Role[]) => {
      setPendingRoles(allowMultipleRoles ? roles : roles.slice(0, 1))
      setAssignOpen(false)
    },
    [allowMultipleRoles],
  )

  const handleRemove = useCallback(
    (roleId: string) => {
      if (!allowMultipleRoles && selectedRoles.length <= 1) return

      setPendingRoles(selectedRoles.filter((selectedRole) => selectedRole.id !== roleId))
    },
    [allowMultipleRoles, selectedRoles],
  )

  const handleSave = useCallback(() => {
    onAssignSubmit?.(allowMultipleRoles ? selectedRoles : selectedRoles.slice(0, 1))
    onClose()
  }, [allowMultipleRoles, onAssignSubmit, onClose, selectedRoles])

  return (
    <>
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) onClose()
        }}
      >
        <DialogContent className="w-110" backdropProps={{ forceRender: true }}>
          <DialogHeader>
            <DialogTitle>
              {t(($) => $['members.memberDetails.title'], {
                ns: 'workspaceMembers',
                defaultValue: 'Member Details',
              })}
            </DialogTitle>
            <DialogCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
          </DialogHeader>

          <DialogBody className="flex items-center gap-3">
            <Avatar size="2xl" aria-hidden="true">
              <AvatarFallback>{getAvatarInitial(member.name)}</AvatarFallback>
              <AvatarImage src={member.avatar_url || undefined} alt="" />
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="truncate system-md-semibold text-text-primary">{member.name}</div>
              <div className="truncate system-xs-regular text-text-tertiary">{member.email}</div>
            </div>

            <div className="-mx-6 my-3 border-t border-divider-subtle" />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 system-sm-semibold text-text-secondary">
                <span>{assignedRolesLabel}</span>
                {!isLoadingRolesOfMember && (
                  <span className="system-xs-medium text-text-tertiary">
                    {selectedRoleIds.length}
                  </span>
                )}
              </div>
              {canAssignRoles && (
                <Button variant="ghost" size="small" onClick={() => setAssignOpen(true)}>
                  <span aria-hidden className={assignActionIconClassName} />
                  {assignActionLabel}
                </Button>
              )}
            </div>

            {isLoadingRolesOfMember ? (
              <div className="mt-4">
                <LoadingPlaceholder />
              </div>
            ) : (
              <>
                {builtinRoles.length > 0 && (
                  <div className="mt-4">
                    <div className="mb-2 system-2xs-medium-uppercase text-text-tertiary">
                      {t(($) => $['members.memberDetails.generalGroup'], {
                        ns: 'workspaceMembers',
                      })}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {builtinRoles.map((role) => (
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
                      {t(($) => $['members.memberDetails.customGroup'], {
                        ns: 'workspaceMembers',
                      })}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {customRoles.map((role) => (
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
          </DialogBody>

          {canAssignRoles && (
            <DialogFooter>
              <Button variant="secondary" onClick={onClose}>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </Button>
              <Button variant="primary" onClick={handleSave} disabled={!onAssignSubmit}>
                {t(($) => $['operation.save'], { ns: 'common' })}
              </Button>
            </DialogFooter>
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

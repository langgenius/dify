'use client'
import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { Role } from '@/models/access-control'
import { Alert, AlertActions, AlertTitle } from '@langgenius/dify-ui/alert'
import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { useQuery } from '@tanstack/react-query'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { LoadingPlaceholder } from '@/app/components/base/loading-placeholder'
import { getAccessControlTemplateLanguage } from '@/i18n/language'
import { consoleQuery } from '@/service/console'
import { useOwnedQueryError } from '@/service/use-owned-query-error'
import { useRequestErrorMessage } from '@/service/use-request-error-message'
import { getAvatarInitial } from '@/utils/avatar'
import { toRole } from '../../workspace-role-list-query'
import { AssignRolesContent } from '../assign-roles-content'
import { PermissionRoleChip } from './permission-role-chip'

type MemberDetailsContentProps = {
  member: AccountWithRoleResponse
  saving?: boolean
  canAssignRoles?: boolean
  allowMultipleRoles?: boolean
}

export const MemberDetailsContent = memo(
  ({
    member,
    canAssignRoles = false,
    saving = false,
    allowMultipleRoles = true,
  }: MemberDetailsContentProps) => {
    const { t } = useTranslation(['common', 'workspaceMembers'])
    const locale = useLocale()
    const searchInputRef = useRef<HTMLInputElement>(null)
    const [assignOpen, setAssignOpen] = useState(false)
    const language = useMemo(() => getAccessControlTemplateLanguage(locale), [locale])

    const rolesOfMemberQuery = useQuery(
      consoleQuery.workspaces.current.rbac.members.byMemberId.rbacRoles.get.queryOptions({
        input: { params: { member_id: member.id }, query: { language } },
        select: (data) => ({ ...data, roles: (data.roles ?? []).map(toRole) }),
      }),
    )
    const { data: rolesOfMember, isLoading: isLoadingRolesOfMember } = rolesOfMemberQuery
    const rolesLoad = useOwnedQueryError(rolesOfMemberQuery)
    const rolesLoadErrorMessage = useRequestErrorMessage(
      rolesLoad?.error,
      t(($) => $['api.actionFailed'], { ns: 'common' }),
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

    return (
      <>
        {(allowMultipleRoles ? selectedRoleIds : selectedRoleIds.slice(0, 1)).map((id) => (
          <input key={id} type="hidden" name="roleId" value={id} />
        ))}
        <DialogHeader>
          <DialogTitle>
            {t(($) => $['members.memberDetails.title'], {
              ns: 'workspaceMembers',
              defaultValue: 'Member Details',
            })}
          </DialogTitle>
          <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
        </DialogHeader>

        <DialogBody>
          <div className="flex items-center gap-3">
            <Avatar size="2xl" aria-hidden="true">
              <AvatarFallback>{getAvatarInitial(member.name)}</AvatarFallback>
              <AvatarImage src={member.avatar_url || undefined} alt="" />
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="system-md-semibold wrap-break-word text-text-primary">
                {member.name}
              </div>
              <div className="system-xs-regular wrap-break-word text-text-tertiary">
                <span dir="ltr">{member.email}</span>
              </div>
            </div>
          </div>

          <div className="-mx-6 my-3 border-t border-divider-subtle" />

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 system-sm-semibold text-text-secondary">
              <span>{assignedRolesLabel}</span>
              {!isLoadingRolesOfMember && !rolesLoad && (
                <span className="system-xs-medium text-text-tertiary">
                  {selectedRoleIds.length}
                </span>
              )}
            </div>
            {canAssignRoles && (
              <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
                <DialogTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="small"
                      className="ms-auto shrink-0"
                      disabled={!rolesOfMember}
                    />
                  }
                >
                  <span aria-hidden className={assignActionIconClassName} />
                  {assignActionLabel}
                </DialogTrigger>
                <DialogContent className="h-121" initialFocus={searchInputRef}>
                  <AssignRolesContent
                    searchInputRef={searchInputRef}
                    selectedRoles={selectedRoles}
                    allowMultipleRoles={allowMultipleRoles}
                    onSubmit={handleAssignSubmit}
                  />
                </DialogContent>
              </Dialog>
            )}
          </div>

          {isLoadingRolesOfMember ? (
            <div className="mt-4">
              <LoadingPlaceholder />
            </div>
          ) : rolesLoad ? (
            <Alert type="error" className="mt-4">
              <AlertTitle>{rolesLoadErrorMessage}</AlertTitle>
              <AlertActions>
                <Button size="small" loading={rolesLoad.retrying} onClick={rolesLoad.retry}>
                  {t(($) => $['operation.retry'], { ns: 'common' })}
                </Button>
              </AlertActions>
            </Alert>
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
            <DialogClose render={<Button variant="secondary" />}>
              {t(($) => $['operation.cancel'], { ns: 'common' })}
            </DialogClose>
            <Button type="submit" variant="primary" disabled={!rolesOfMember} loading={saving}>
              {t(($) => $['operation.save'], { ns: 'common' })}
            </Button>
          </DialogFooter>
        )}
      </>
    )
  },
)

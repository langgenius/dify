'use client'
import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { Role } from '@/models/access-control'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { memo, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { currentWorkspaceAtom } from '@/context/workspace-state'
import { useOptionalContactsManagement } from '@/features/contacts/management/composition-context'
import { isContactsManagementEnabled } from '@/features/contacts/management/feature-flag'
import { MemberRemovalContactImpactDialog } from '@/features/contacts/management/member-removal-dialog'
import { consoleClient, consoleQuery, invalidateHumanInputContactQueries } from '@/service/console'
import { createSelectedRolePlaceholder } from '../workspace-role-list-query'
import AssignRolesModal from './assign-roles-modal'

type MemberMenuProps = {
  member: AccountWithRoleResponse
  isCurrentUser: boolean
  canTransferOwnership?: boolean
  allowMultipleRoles?: boolean
  onTransferOwnership?: () => void
}

type MembersCache = {
  accounts: AccountWithRoleResponse[] | null
}

const MemberMenu = ({
  member,
  isCurrentUser,
  canTransferOwnership = false,
  allowMultipleRoles = true,
  onTransferOwnership,
}: MemberMenuProps) => {
  const { t } = useTranslation(['common', 'workspaceMembers', 'contacts'])
  const queryClient = useQueryClient()
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const [assignModalOpen, setAssignModalOpen] = useState(false)
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const contactsManagement = useOptionalContactsManagement()

  const isOwner = member.role === 'owner'
  const canAssignRoles = !isOwner && !isCurrentUser
  const canRemove = !isOwner && !isCurrentUser
  const showTransferOwnership = isOwner && canTransferOwnership
  const showContactsRemovalDesign = isContactsManagementEnabled() && member.status !== 'pending'
  const useContactsAwareRemoval = Boolean(
    showContactsRemovalDesign &&
    contactsManagement.context &&
    contactsManagement.repository &&
    contactsManagement.repository.supportsMemberManagement !== false,
  )

  const selectedRoles = useMemo(
    () => (member.roles ?? []).map(createSelectedRolePlaceholder),
    [member.roles],
  )
  const memberName = member.name || member.email
  const assignRolesLabel = allowMultipleRoles
    ? t(($) => $['members.assignRoles'], { ns: 'workspaceMembers', defaultValue: 'Assign Roles' })
    : t(($) => $['members.editRole'], { ns: 'workspaceMembers', defaultValue: 'Edit Role' })

  const handleOpenAssignRoles = useCallback(() => {
    setAssignModalOpen(true)
  }, [])

  const { mutateAsync: updateRolesOfMember } = useMutation(
    consoleQuery.workspaces.current.rbac.members.byMemberId.rbacRoles.put.mutationOptions(),
  )

  const handleAssignRolesSubmit = useCallback(
    (roles: Role[]) => {
      const roleIds = allowMultipleRoles
        ? roles.map((role) => role.id)
        : roles.slice(0, 1).map((role) => role.id)

      updateRolesOfMember(
        { params: { member_id: member.id }, body: { role_ids: roleIds } },
        {
          onSuccess: () => {
            toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
          },
        },
      )
    },
    [allowMultipleRoles, member.id, t, updateRolesOfMember],
  )

  const handleOpenRemoveConfirm = useCallback(() => {
    setRemoveConfirmOpen(true)
  }, [])

  const handleRemove = useCallback(async () => {
    setRemoving(true)
    try {
      await consoleClient.workspaces.current.members.byMemberId.delete({
        params: { member_id: member.id },
      })
      void queryClient.invalidateQueries({
        queryKey: consoleQuery.workspaces.current.members.get.key(),
      })
      void invalidateHumanInputContactQueries(queryClient, contactsManagement.context?.workspaceId)
      setRemoveConfirmOpen(false)
    } catch {
    } finally {
      setRemoving(false)
    }
  }, [contactsManagement.context?.workspaceId, member.id, queryClient, t])

  const handleContactsRemovalSuccess = useCallback(() => {
    queryClient.setQueriesData<MembersCache>(
      { queryKey: consoleQuery.workspaces.current.members.get.key() },
      (cachedMembers) => {
        if (!cachedMembers?.accounts) return cachedMembers
        return {
          ...cachedMembers,
          accounts: cachedMembers.accounts.filter((account) => account.id !== member.id),
        }
      },
    )
    toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
  }, [member.id, queryClient, t])

  const handleTransferOwnership = useCallback(() => {
    onTransferOwnership?.()
  }, [onTransferOwnership])

  if (!canAssignRoles && !canRemove && !showTransferOwnership) return null

  return (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <IconButton
              size="lg"
              aria-label={t(($) => $['members.memberActions'], {
                ns: 'workspaceMembers',
                defaultValue: 'Member actions',
              })}
              className="data-popup-open:bg-state-base-hover"
            >
              <span aria-hidden className="i-ri-more-fill h-4 w-4 text-text-tertiary" />
            </IconButton>
          }
        />
        <DropdownMenuContent className="min-w-45 rounded-xl">
          {canAssignRoles && (
            <DropdownMenuItem
              className="system-sm-medium text-text-secondary"
              onClick={handleOpenAssignRoles}
            >
              {assignRolesLabel}
            </DropdownMenuItem>
          )}
          {showTransferOwnership && (
            <DropdownMenuItem
              className="system-sm-medium text-text-secondary"
              onClick={handleTransferOwnership}
            >
              {t(($) => $['members.transferOwnership'], { ns: 'workspaceMembers' })}
            </DropdownMenuItem>
          )}
          {(canAssignRoles || showTransferOwnership) && canRemove && <DropdownMenuSeparator />}
          {canRemove && (
            <DropdownMenuItem
              variant="destructive"
              className="system-sm-medium"
              onClick={handleOpenRemoveConfirm}
            >
              {t(($) => $['members.removeFromTeam'], { ns: 'workspaceMembers' })}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {useContactsAwareRemoval ? (
        <MemberRemovalContactImpactDialog
          member={member}
          open={removeConfirmOpen}
          onOpenChange={setRemoveConfirmOpen}
          onRemoved={handleContactsRemovalSuccess}
        />
      ) : (
        <AlertDialog
          open={removeConfirmOpen}
          onOpenChange={(open) => !open && !removing && setRemoveConfirmOpen(false)}
        >
          <AlertDialogContent
            backdropProps={{ forceRender: true }}
            className={showContactsRemovalDesign ? 'w-110' : undefined}
          >
            {showContactsRemovalDesign ? (
              <div className="flex flex-col gap-3 px-6 pt-6 pb-4">
                <AlertDialogTitle>
                  {currentWorkspace.name
                    ? t(($) => $['memberRemoval.workspaceTitle'], {
                        ns: 'contacts',
                        memberName,
                        workspaceName: currentWorkspace.name,
                      })
                    : t(($) => $['memberRemoval.title'], { ns: 'contacts', memberName })}
                </AlertDialogTitle>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2.5 rounded-xl bg-background-section-burn py-2 ps-3 pe-2">
                    <Avatar size="md">
                      <AvatarImage
                        src={(member.avatar_url || null) ?? undefined}
                        alt={memberName}
                      />
                      <AvatarFallback>{memberName?.[0]?.toLocaleUpperCase()}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 py-0.5">
                      <div className="system-md-medium wrap-break-word text-text-secondary">
                        {memberName}
                      </div>
                      <div className="system-xs-regular wrap-anywhere text-text-tertiary">
                        {member.email}
                      </div>
                    </div>
                  </div>
                  <AlertDialogDescription render={<div />}>
                    <p>
                      {t(($) => $['memberRemoval.accessImpact'], { ns: 'contacts', memberName })}
                    </p>
                    <p>{t(($) => $['memberRemoval.contentImpact'], { ns: 'contacts' })}</p>
                  </AlertDialogDescription>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
                <AlertDialogTitle>
                  {t(($) => $['members.removeFromTeamConfirmTitle'], {
                    ns: 'workspaceMembers',
                    memberName,
                  })}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t(($) => $['members.removeFromTeamConfirmDescription'], {
                    ns: 'workspaceMembers',
                  })}
                </AlertDialogDescription>
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancelButton
                disabled={removing}
                className={showContactsRemovalDesign ? 'min-w-20' : undefined}
              >
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </AlertDialogCancelButton>
              <AlertDialogConfirmButton
                disabled={removing}
                onClick={handleRemove}
                className={showContactsRemovalDesign ? 'min-w-20' : undefined}
              >
                {showContactsRemovalDesign
                  ? t(($) => $[removing ? 'memberRemoval.removing' : 'memberRemoval.remove'], {
                      ns: 'contacts',
                    })
                  : t(($) => $['operation.confirm'], { ns: 'common' })}
              </AlertDialogConfirmButton>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {assignModalOpen && (
        <AssignRolesModal
          selectedRoles={selectedRoles}
          allowMultipleRoles={allowMultipleRoles}
          onClose={() => setAssignModalOpen(false)}
          onSubmit={handleAssignRolesSubmit}
        />
      )}
    </div>
  )
}

export default memo(MemberMenu)

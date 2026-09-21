'use client'
import type { Role } from '@/models/access-control'
import type { Member } from '@/models/common'
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Avatar } from '@langgenius/dify-ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { toast } from '@langgenius/dify-ui/toast'
import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { currentWorkspaceAtom } from '@/context/workspace-state'
import { useOptionalContactsManagement } from '@/features/contacts/management/composition-context'
import { isContactsManagementEnabled } from '@/features/contacts/management/feature-flag'
import { MemberRemovalContactImpactDialog } from '@/features/contacts/management/member-removal-dialog'
import { useUpdateRolesOfMember } from '@/service/access-control/use-member-roles'
import { invalidateHumanInputContactQueries } from '@/service/client'
import { deleteMemberOrCancelInvitation } from '@/service/common'
import { commonQueryKeys } from '@/service/use-common'
import AssignRolesModal from './assign-roles-modal'

type MemberMenuProps = {
  member: Member
  isCurrentUser: boolean
  canTransferOwnership?: boolean
  allowMultipleRoles?: boolean
  onTransferOwnership?: () => void
}

type MembersCache = {
  accounts: Member[] | null
}

const MemberMenu = ({
  member,
  isCurrentUser,
  canTransferOwnership = false,
  allowMultipleRoles = true,
  onTransferOwnership,
}: MemberMenuProps) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const currentWorkspace = useAtomValue(currentWorkspaceAtom)
  const [open, setOpen] = useState(false)
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

  const selectedRoles = member.roles || []
  const memberName = member.name || member.email
  const assignRolesLabel = allowMultipleRoles
    ? t(($) => $['members.assignRoles'], { ns: 'common', defaultValue: 'Assign Roles' })
    : t(($) => $['members.editRole'], { ns: 'common', defaultValue: 'Edit Role' })

  const handleOpenAssignRoles = useCallback(() => {
    setOpen(false)
    setAssignModalOpen(true)
  }, [])

  const { mutateAsync: updateRolesOfMember } = useUpdateRolesOfMember()

  const handleAssignRolesSubmit = useCallback(
    (roles: Role[]) => {
      const roleIds = allowMultipleRoles
        ? roles.map((role) => role.id)
        : roles.slice(0, 1).map((role) => role.id)

      updateRolesOfMember(
        {
          memberId: member.id,
          roleIds,
        },
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
    setOpen(false)
    setRemoveConfirmOpen(true)
  }, [])

  const handleRemove = useCallback(async () => {
    setRemoving(true)
    try {
      await deleteMemberOrCancelInvitation({ url: `/workspaces/current/members/${member.id}` })
      void queryClient.invalidateQueries({ queryKey: commonQueryKeys.members })
      void invalidateHumanInputContactQueries(queryClient, contactsManagement.context?.workspaceId)
      toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
      setRemoveConfirmOpen(false)
    } catch {
    } finally {
      setRemoving(false)
    }
  }, [contactsManagement.context?.workspaceId, member.id, queryClient, t])

  const handleContactsRemovalSuccess = useCallback(() => {
    queryClient.setQueriesData<MembersCache>(
      { queryKey: commonQueryKeys.members },
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
    setOpen(false)
    onTransferOwnership?.()
  }, [onTransferOwnership])

  if (!canAssignRoles && !canRemove && !showTransferOwnership) return null

  return (
    <div role="presentation">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <IconButton
              size="lg"
              aria-label={t(($) => $['members.memberActions'], {
                ns: 'common',
                defaultValue: 'Member actions',
              })}
              className="data-popup-open:bg-state-base-hover"
            >
              <span aria-hidden className="i-ri-more-fill h-4 w-4 text-text-tertiary" />
            </IconButton>
          }
        />
        <DropdownMenuContent placement="bottom-end" sideOffset={4} className="min-w-45 rounded-xl">
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
              {t(($) => $['members.transferOwnership'], { ns: 'common' })}
            </DropdownMenuItem>
          )}
          {(canAssignRoles || showTransferOwnership) && canRemove && <DropdownMenuSeparator />}
          {canRemove && (
            <DropdownMenuItem
              variant="destructive"
              className="system-sm-medium"
              onClick={handleOpenRemoveConfirm}
            >
              {t(($) => $['members.removeFromTeam'], { ns: 'common' })}
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
                <AlertDialogTitle className="w-full title-2xl-semi-bold wrap-break-word text-text-primary">
                  {currentWorkspace.name
                    ? t(($) => $['memberRemoval.workspaceTitle'], {
                        ns: 'contacts',
                        memberName,
                        workspaceName: currentWorkspace.name,
                      })
                    : t(($) => $['memberRemoval.title'], { ns: 'contacts', memberName })}
                </AlertDialogTitle>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2.5 rounded-xl bg-background-section-burn py-2 pr-2 pl-3">
                    <Avatar avatar={member.avatar_url || null} name={memberName} size="md" />
                    <div className="min-w-0 py-0.5">
                      <div className="system-md-medium wrap-break-word text-text-secondary">
                        {memberName}
                      </div>
                      <div className="system-xs-regular wrap-anywhere text-text-tertiary">
                        {member.email}
                      </div>
                    </div>
                  </div>
                  <AlertDialogDescription
                    render={<div />}
                    className="system-md-regular wrap-break-word text-text-secondary"
                  >
                    <p>
                      {t(($) => $['memberRemoval.accessImpact'], { ns: 'contacts', memberName })}
                    </p>
                    <p>{t(($) => $['memberRemoval.contentImpact'], { ns: 'contacts' })}</p>
                  </AlertDialogDescription>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
                <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
                  {t(($) => $['members.removeFromTeamConfirmTitle'], { ns: 'common', memberName })}
                </AlertDialogTitle>
                <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
                  {t(($) => $['members.removeFromTeamConfirmDescription'], { ns: 'common' })}
                </AlertDialogDescription>
              </div>
            )}
            <AlertDialogActions>
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
            </AlertDialogActions>
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

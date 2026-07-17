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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import { useQueryClient } from '@tanstack/react-query'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { useOptionalContactsManagement } from '@/features/contacts/management/composition-context'
import { isContactsManagementEnabled } from '@/features/contacts/management/feature-flag'
import { MemberRemovalContactImpactDialog } from '@/features/contacts/management/member-removal-dialog'
import { useUpdateRolesOfMember } from '@/service/access-control/use-member-roles'
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
  const [open, setOpen] = useState(false)
  const [assignModalOpen, setAssignModalOpen] = useState(false)
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false)
  const [removing, setRemoving] = useState(false)
  const contactsManagement = useOptionalContactsManagement()

  const isOwner = member.role === 'owner'
  const canAssignRoles = !isOwner && !isCurrentUser
  const canRemove = !isOwner && !isCurrentUser
  const showTransferOwnership = isOwner && canTransferOwnership
  const useContactsAwareRemoval = Boolean(
    isContactsManagementEnabled() &&
    member.status !== 'pending' &&
    contactsManagement.context &&
    contactsManagement.repository,
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
      toast.success(t(($) => $['actionMsg.modifiedSuccessfully'], { ns: 'common' }))
      setRemoveConfirmOpen(false)
    } catch {
    } finally {
      setRemoving(false)
    }
  }, [member.id, queryClient, t])

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
            <ActionButton
              size="l"
              className="focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-base-hover"
              aria-label={t(($) => $['members.memberActions'], {
                ns: 'common',
                defaultValue: 'Member actions',
              })}
            />
          }
        >
          <span aria-hidden className="i-ri-more-fill h-4 w-4 text-text-tertiary" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="bottom-end"
          sideOffset={4}
          popupClassName="min-w-[180px] rounded-xl"
        >
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
          onOpenChange={(open) => !open && setRemoveConfirmOpen(false)}
        >
          <AlertDialogContent backdropProps={{ forceRender: true }}>
            <div className="flex flex-col gap-2 px-6 pt-6 pb-4">
              <AlertDialogTitle className="w-full truncate title-2xl-semi-bold text-text-primary">
                {t(($) => $['members.removeFromTeamConfirmTitle'], { ns: 'common', memberName })}
              </AlertDialogTitle>
              <AlertDialogDescription className="w-full system-md-regular wrap-break-word whitespace-pre-wrap text-text-tertiary">
                {t(($) => $['members.removeFromTeamConfirmDescription'], { ns: 'common' })}
              </AlertDialogDescription>
            </div>
            <AlertDialogActions>
              <AlertDialogCancelButton>
                {t(($) => $['operation.cancel'], { ns: 'common' })}
              </AlertDialogCancelButton>
              <AlertDialogConfirmButton disabled={removing} onClick={handleRemove}>
                {t(($) => $['operation.confirm'], { ns: 'common' })}
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

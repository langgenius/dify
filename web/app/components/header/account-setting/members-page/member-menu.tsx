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
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { toast } from '@langgenius/dify-ui/toast'
import { useQueryClient } from '@tanstack/react-query'
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUpdateRolesOfMember } from '@/service/access-control/use-member-roles'
import { deleteMemberOrCancelInvitation } from '@/service/common'
import { commonQueryKeys } from '@/service/use-common'
import AssignRolesModal from './assign-roles-modal'

type MemberMenuProps = {
  member: Member
  isCurrentUser: boolean
  canAssignRoles: boolean
  canRemove: boolean
  canTransferOwnership?: boolean
  allowMultipleRoles?: boolean
  onTransferOwnership?: () => void
}

const MemberMenu = ({
  member,
  isCurrentUser,
  canAssignRoles,
  canRemove,
  canTransferOwnership = false,
  allowMultipleRoles = true,
  onTransferOwnership,
}: MemberMenuProps) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isOwner = member.role === 'owner'
  const showAssignRoles =
    canAssignRoles && member.status !== 'pending' && !isOwner && !isCurrentUser
  const showRemove = canRemove && !isOwner && !isCurrentUser
  const showTransferOwnership = isOwner && canTransferOwnership
  const hasActions = showAssignRoles || showRemove || showTransferOwnership
  const [assignModalOpen, setAssignModalOpen] = useState(false)
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false)
  const [removing, setRemoving] = useState(false)

  const selectedRoles = member.roles || []
  const memberName = member.name || member.email
  const assignRolesLabel = allowMultipleRoles
    ? t(($) => $['members.assignRoles'], { ns: 'common', defaultValue: 'Assign Roles' })
    : t(($) => $['members.editRole'], { ns: 'common', defaultValue: 'Edit Role' })

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

  if (!showAssignRoles && assignModalOpen) setAssignModalOpen(false)
  if (!showRemove && removeConfirmOpen) setRemoveConfirmOpen(false)

  if (!hasActions) return null

  return (
    <div role="presentation">
      <DropdownMenu>
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
        <DropdownMenuContent
          placement="bottom-end"
          sideOffset={4}
          popupClassName="min-w-[180px] rounded-xl"
        >
          {showAssignRoles && (
            <DropdownMenuItem
              className="system-sm-medium text-text-secondary"
              onClick={() => setAssignModalOpen(true)}
            >
              {assignRolesLabel}
            </DropdownMenuItem>
          )}
          {showTransferOwnership && (
            <DropdownMenuItem
              className="system-sm-medium text-text-secondary"
              onClick={onTransferOwnership}
            >
              {t(($) => $['members.transferOwnership'], { ns: 'common' })}
            </DropdownMenuItem>
          )}
          {(showAssignRoles || showTransferOwnership) && showRemove && <DropdownMenuSeparator />}
          {showRemove && (
            <DropdownMenuItem
              variant="destructive"
              className="system-sm-medium"
              onClick={() => setRemoveConfirmOpen(true)}
            >
              {t(($) => $['members.removeFromTeam'], { ns: 'common' })}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog
        open={showRemove && removeConfirmOpen}
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
      {showAssignRoles && assignModalOpen && (
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

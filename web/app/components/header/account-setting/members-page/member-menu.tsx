'use client'
import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { AlertDialogHandle } from '@langgenius/dify-ui/alert-dialog'
import type { RefObject } from 'react'
import type { RemoveMemberPayload } from './remove-member-content'
import type { Role } from '@/models/access-control'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { memo, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createSelectedRolePlaceholder } from '../workspace-role-list-query'
import AssignRolesContent from './assign-roles-content'
import TransferOwnershipContent from './transfer-ownership-content'
import { useUpdateMemberRoles } from './use-update-member-roles'

type MemberMenuProps = {
  removeReturnFocusRef: RefObject<HTMLButtonElement | null>
  removeDialogHandle: AlertDialogHandle<RemoveMemberPayload>
  member: AccountWithRoleResponse
  isCurrentUser: boolean
  canTransferOwnership?: boolean
  allowMultipleRoles?: boolean
}

const MemberMenu = ({
  member,
  removeDialogHandle,
  removeReturnFocusRef,
  isCurrentUser,
  canTransferOwnership = false,
  allowMultipleRoles = true,
}: MemberMenuProps) => {
  const { t } = useTranslation(['common', 'workspaceMembers'])
  const menuTriggerRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [transferOpen, setTransferOpen] = useState(false)
  const [assignModalOpen, setAssignModalOpen] = useState(false)

  const isOwner = member.role === 'owner'
  const canAssignRoles = !isOwner && !isCurrentUser
  const canRemove = !isOwner && !isCurrentUser
  const showTransferOwnership = isOwner && canTransferOwnership

  const selectedRoles = useMemo(
    () => (member.roles ?? []).map(createSelectedRolePlaceholder),
    [member.roles],
  )
  const memberName = member.name || member.email
  const assignRolesLabel = allowMultipleRoles
    ? t(($) => $['members.assignRoles'], { ns: 'workspaceMembers', defaultValue: 'Assign Roles' })
    : t(($) => $['members.editRole'], { ns: 'workspaceMembers', defaultValue: 'Edit Role' })

  const {
    submit: updateRolesOfMember,
    isPending: isSavingRoles,
    isError: roleSaveFailed,
    reset: resetRoleSave,
  } = useUpdateMemberRoles(allowMultipleRoles, () => setAssignModalOpen(false))

  const handleOpenAssignRoles = () => {
    resetRoleSave()
    setAssignModalOpen(true)
  }

  const handleAssignRolesSubmit = (roles: Role[]) => {
    if (isSavingRoles) return
    // Mutation state renders failures both in the dialog and on the closed row.
    updateRolesOfMember(member.id, roles)
  }

  if (!canAssignRoles && !canRemove && !showTransferOwnership) return null

  return (
    <div>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <IconButton
              ref={menuTriggerRef}
              type="button"
              size="lg"
              aria-label={`${t(($) => $['members.memberActions'], { ns: 'workspaceMembers' })}: ${memberName}`}
              className="data-popup-open:bg-state-base-hover"
            >
              <span aria-hidden className="i-ri-more-fill size-4 text-text-tertiary" />
            </IconButton>
          }
        />
        <DropdownMenuContent className="min-w-45 rounded-xl">
          {canAssignRoles && (
            <DropdownMenuItem
              className="system-sm-medium text-text-secondary"
              disabled={isSavingRoles}
              onClick={handleOpenAssignRoles}
            >
              {assignRolesLabel}
            </DropdownMenuItem>
          )}
          {showTransferOwnership && (
            <DropdownMenuItem
              className="system-sm-medium text-text-secondary"
              onClick={() => setTransferOpen(true)}
            >
              {t(($) => $['members.transferOwnership'], { ns: 'workspaceMembers' })}
            </DropdownMenuItem>
          )}
          {(canAssignRoles || showTransferOwnership) && canRemove && <DropdownMenuSeparator />}
          {canRemove && (
            <DropdownMenuItem
              variant="destructive"
              className="system-sm-medium"
              onClick={() => {
                removeReturnFocusRef.current = menuTriggerRef.current
                removeDialogHandle.openWithPayload({
                  id: member.id,
                  name: member.name,
                  email: member.email,
                })
              }}
            >
              {t(($) => $['members.removeFromTeam'], { ns: 'workspaceMembers' })}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {roleSaveFailed && !assignModalOpen && (
        <p role="alert" className="mt-1 system-xs-regular text-text-destructive">
          {t(($) => $['api.actionFailed'], { ns: 'common' })}
        </p>
      )}
      <Dialog open={assignModalOpen} onOpenChange={setAssignModalOpen}>
        <DialogContent
          className="h-121"
          initialFocus={searchInputRef}
          backdropProps={{ forceRender: true }}
        >
          <AssignRolesContent
            searchInputRef={searchInputRef}
            selectedRoles={selectedRoles}
            allowMultipleRoles={allowMultipleRoles}
            isSubmitting={isSavingRoles}
            hasSubmitError={roleSaveFailed}
            onSubmit={handleAssignRolesSubmit}
          />
        </DialogContent>
      </Dialog>
      <Dialog open={transferOpen} onOpenChange={setTransferOpen} disablePointerDismissal>
        <DialogContent className="w-105" backdropProps={{ forceRender: true }}>
          <TransferOwnershipContent />
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default memo(MemberMenu)

'use client'
import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { Role } from '@/models/access-control'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@langgenius/dify-ui/menu'
import { useMutation } from '@tanstack/react-query'
import { memo, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { createSelectedRolePlaceholder } from '../workspace-role-list-query'
import AssignRolesContent from './assign-roles-content'
import TransferOwnershipContent from './transfer-ownership-content'

type MemberMenuProps = {
  member: AccountWithRoleResponse
  onRemove: () => void
  isCurrentUser: boolean
  canTransferOwnership?: boolean
  allowMultipleRoles?: boolean
}

const MemberMenu = ({
  member,
  onRemove,
  isCurrentUser,
  canTransferOwnership = false,
  allowMultipleRoles = true,
}: MemberMenuProps) => {
  const { t } = useTranslation(['common', 'workspaceMembers'])
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
    mutate: updateRolesOfMember,
    isPending: isSavingRoles,
    isError: roleSaveFailed,
    reset: resetRoleSave,
  } = useMutation(
    consoleQuery.workspaces.current.rbac.members.byMemberId.rbacRoles.put.mutationOptions({
      context: { silent: true },
    }),
  )

  const handleOpenAssignRoles = () => {
    resetRoleSave()
    setAssignModalOpen(true)
  }

  const handleAssignRolesSubmit = (roles: Role[]) => {
    if (isSavingRoles) return
    const roleIds = allowMultipleRoles
      ? roles.map((role) => role.id)
      : roles.slice(0, 1).map((role) => role.id)

    updateRolesOfMember(
      { params: { member_id: member.id }, body: { role_ids: roleIds } },
      { onSuccess: () => setAssignModalOpen(false) },
    )
  }

  if (!canAssignRoles && !canRemove && !showTransferOwnership) return null

  return (
    <div>
      <Menu>
        <MenuTrigger
          render={
            <IconButton
              size="lg"
              aria-label={`${t(($) => $['members.memberActions'], { ns: 'workspaceMembers' })}: ${memberName}`}
              className="data-popup-open:bg-state-base-hover"
            >
              <span aria-hidden className="i-ri-more-fill size-4 text-text-tertiary" />
            </IconButton>
          }
        />
        <MenuContent align="end" className="min-w-45 rounded-xl">
          {canAssignRoles && (
            <MenuItem
              className="system-sm-medium text-text-secondary"
              disabled={isSavingRoles}
              onClick={handleOpenAssignRoles}
            >
              {assignRolesLabel}
            </MenuItem>
          )}
          {showTransferOwnership && (
            <MenuItem
              className="system-sm-medium text-text-secondary"
              onClick={() => setTransferOpen(true)}
            >
              {t(($) => $['members.transferOwnership'], { ns: 'workspaceMembers' })}
            </MenuItem>
          )}
          {(canAssignRoles || showTransferOwnership) && canRemove && <MenuSeparator />}
          {canRemove && (
            <MenuItem variant="destructive" className="system-sm-medium" onClick={onRemove}>
              {t(($) => $['members.removeFromTeam'], { ns: 'workspaceMembers' })}
            </MenuItem>
          )}
        </MenuContent>
      </Menu>
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

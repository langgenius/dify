'use client'
import type { Member } from '@/models/common'
import { cn } from '@langgenius/dify-ui/cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@langgenius/dify-ui/dropdown-menu'
import { toast } from '@langgenius/dify-ui/toast'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionButton from '@/app/components/base/action-button'
import { deleteMemberOrCancelInvitation } from '@/service/common'
import AssignRolesModal from './assign-roles-modal'

type MemberMenuProps = {
  member: Member
  operatorRole: string
  canTransferOwnership?: boolean
  onOperate: () => void
  onTransferOwnership?: () => void
}

const MemberMenu = ({
  member,
  operatorRole,
  canTransferOwnership = false,
  onOperate,
  onTransferOwnership,
}: MemberMenuProps) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [assignModalOpen, setAssignModalOpen] = useState(false)

  const isOwner = member.role === 'owner'
  const canAssignRoles
    = !isOwner && (operatorRole === 'owner' || operatorRole === 'admin')
  const canRemove = !isOwner
  const showTransferOwnership = isOwner && canTransferOwnership

  if (!canAssignRoles && !canRemove && !showTransferOwnership)
    return null

  const handleOpenAssignRoles = () => {
    setOpen(false)
    setAssignModalOpen(true)
  }

  const handleAssignRolesSubmit = (_roleIds: string[]) => {
    // TODO: wire to backend once multi-role member endpoint is ready.
    toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
    onOperate()
  }

  const handleRemove = async () => {
    setOpen(false)
    try {
      await deleteMemberOrCancelInvitation({ url: `/workspaces/current/members/${member.id}` })
      onOperate()
      toast.success(t('actionMsg.modifiedSuccessfully', { ns: 'common' }))
    }
    catch {
    }
  }

  const handleTransferOwnership = () => {
    setOpen(false)
    onTransferOwnership?.()
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={(
            <ActionButton
              size="l"
              className={cn(open && 'bg-state-base-hover')}
              aria-label={t('members.memberActions', { ns: 'common', defaultValue: 'Member actions' })}
            />
          )}
        >
          <span aria-hidden className="i-ri-more-fill h-4 w-4 text-text-tertiary" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          placement="bottom-end"
          sideOffset={4}
          popupClassName="min-w-[180px] rounded-xl p-1"
        >
          {canAssignRoles && (
            <DropdownMenuItem
              className="system-sm-medium text-text-secondary"
              onClick={handleOpenAssignRoles}
            >
              {t('members.assignRoles', { ns: 'common', defaultValue: 'Assign Roles' })}
            </DropdownMenuItem>
          )}
          {showTransferOwnership && (
            <DropdownMenuItem
              className="system-sm-medium text-text-secondary"
              onClick={handleTransferOwnership}
            >
              {t('members.transferOwnership', { ns: 'common' })}
            </DropdownMenuItem>
          )}
          {(canAssignRoles || showTransferOwnership) && canRemove && (
            <DropdownMenuSeparator />
          )}
          {canRemove && (
            <DropdownMenuItem
              variant="destructive"
              className="system-sm-medium"
              onClick={handleRemove}
            >
              {t('members.removeFromTeam', { ns: 'common' })}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {assignModalOpen && (
        <AssignRolesModal
          open={assignModalOpen}
          member={member}
          onClose={() => setAssignModalOpen(false)}
          onSubmit={handleAssignRolesSubmit}
        />
      )}
    </>
  )
}

export default memo(MemberMenu)

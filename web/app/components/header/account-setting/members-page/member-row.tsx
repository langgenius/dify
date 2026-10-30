'use client'
import type { AccountWithRoleResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { MouseEvent } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@langgenius/dify-ui/avatar'
import { DialogTrigger } from '@langgenius/dify-ui/dialog'
import { memo, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import { getAvatarInitial } from '@/utils/avatar'
import MemberMenu from './member-menu'
import RoleBadges from './role-badges'

type MemberRowProps = {
  member: AccountWithRoleResponse
  onRemove: (row: HTMLTableRowElement | null) => void
  roles: Array<{
    id: string
    name: string
  }>
  isCurrentUser: boolean
  canManage: boolean
  canTransferOwnership: boolean
  allowMultipleRoles: boolean
}

const MemberRow = ({
  member,
  onRemove,
  roles,
  isCurrentUser,
  canManage,
  canTransferOwnership,
  allowMultipleRoles,
}: MemberRowProps) => {
  const { t } = useTranslation(['workspaceMembers'])
  const rowRef = useRef<HTMLTableRowElement>(null)
  const detailsTriggerRef = useRef<HTMLButtonElement>(null)
  const { formatTimeFromNow } = useFormatTimeFromNow()

  const roleNames = roles.map((role) => role.name)

  const handleRowClick = useCallback((event: MouseEvent<HTMLTableRowElement>) => {
    const target = event.target
    if (
      !(target instanceof Element) ||
      !event.currentTarget.contains(target) ||
      target.closest('button, a')
    )
      return
    const selection = event.currentTarget.ownerDocument.getSelection()
    if (selection && !selection.isCollapsed && selection.containsNode(event.currentTarget, true))
      return
    detailsTriggerRef.current?.click()
  }, [])

  return (
    <tr
      ref={rowRef}
      data-testid={`member-row-${member.id}`}
      className="cursor-pointer border-b border-divider-subtle hover:bg-state-base-hover has-[[aria-haspopup=dialog]:focus-visible]:bg-state-base-hover has-[[aria-haspopup=dialog]:focus-visible]:inset-ring-2 has-[[aria-haspopup=dialog]:focus-visible]:inset-ring-state-accent-solid has-[[aria-haspopup=dialog]:focus-visible]:outline-hidden has-[[aria-haspopup=menu]:hover]:bg-transparent"
      onClick={handleRowClick}
    >
      <td className="px-3 py-2">
        <div className="flex min-w-0 items-center">
          <Avatar size="sm" className="me-2" aria-hidden="true">
            <AvatarFallback>{getAvatarInitial(member.name)}</AvatarFallback>
            <AvatarImage src={member.avatar_url || undefined} alt="" />
          </Avatar>
          <div className="min-w-0">
            <div className="system-sm-medium text-text-secondary">
              <DialogTrigger
                ref={detailsTriggerRef}
                payload={member}
                className="max-w-full cursor-pointer text-start wrap-break-word focus-visible:ring-0"
              >
                {member.name}
              </DialogTrigger>
              {member.status === 'pending' && (
                <span className="ms-1 system-xs-medium text-text-warning">
                  {t(($) => $['members.pending'], { ns: 'workspaceMembers' })}
                </span>
              )}
              {isCurrentUser && (
                <span className="system-xs-regular text-text-tertiary">
                  {t(($) => $['members.you'], { ns: 'workspaceMembers' })}
                </span>
              )}
            </div>
            <div className="system-xs-regular wrap-break-word text-text-tertiary">
              <span dir="ltr">{member.email}</span>
            </div>
          </div>
        </div>
      </td>
      <td className="py-2 system-sm-regular text-text-secondary">
        {formatTimeFromNow(Number(member.last_active_at || member.created_at) * 1000)}
      </td>
      <td className="px-3 py-2">
        <RoleBadges roleNames={roleNames} />
      </td>
      {canManage && (
        <td className="px-3 py-2">
          <MemberMenu
            member={member}
            onRemove={() => onRemove(rowRef.current)}
            isCurrentUser={isCurrentUser}
            canTransferOwnership={canTransferOwnership}
            allowMultipleRoles={allowMultipleRoles}
          />
        </td>
      )}
    </tr>
  )
}

export default memo(MemberRow)

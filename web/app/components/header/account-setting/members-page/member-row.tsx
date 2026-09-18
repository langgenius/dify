'use client'
import type { MouseEvent } from 'react'
import type { Member } from '@/models/common'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useFormatTimeFromNow } from '@/hooks/use-format-time-from-now'
import MemberMenu from './member-menu'
import RoleBadges from './role-badges'

type MemberRowProps = {
  member: Member
  roles: Array<{
    id: string
    name: string
  }>
  isCurrentUser: boolean
  canManage: boolean
  canTransferOwnership: boolean
  allowMultipleRoles: boolean
  onOpenDetails: (member: Member) => void
  onTransferOwnership: () => void
}

const MemberRow = ({
  member,
  roles,
  isCurrentUser,
  canManage,
  canTransferOwnership,
  allowMultipleRoles,
  onOpenDetails,
  onTransferOwnership,
}: MemberRowProps) => {
  const { t } = useTranslation()
  const { formatTimeFromNow } = useFormatTimeFromNow()

  const roleNames = roles.map((role) => role.name)

  const openDetails = useCallback(() => {
    onOpenDetails(member)
  }, [member, onOpenDetails])

  const handleRowClick = useCallback(
    (event: MouseEvent<HTMLTableRowElement>) => {
      const target = event.target
      if (
        !(target instanceof Element) ||
        !event.currentTarget.contains(target) ||
        target.closest('button, a')
      )
        return
      openDetails()
    },
    [openDetails],
  )

  return (
    <tr
      data-testid={`member-row-${member.id}`}
      className="cursor-pointer border-b border-divider-subtle hover:bg-state-base-hover"
      onClick={handleRowClick}
    >
      <td className="px-3 py-2">
        <div className="flex min-w-0 items-center">
          <Avatar avatar={member.avatar_url} size="sm" className="mr-2" name={member.name} />
          <div className="min-w-0">
            <div className="system-sm-medium text-text-secondary">
              <button
                type="button"
                className="max-w-full cursor-pointer rounded-sm text-left wrap-break-word hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-components-input-border-active focus-visible:outline-hidden"
                onClick={openDetails}
              >
                {member.name}
              </button>
              {member.status === 'pending' && (
                <span className="ml-1 system-xs-medium text-text-warning">
                  {t(($) => $['members.pending'], { ns: 'common' })}
                </span>
              )}
              {isCurrentUser && (
                <span className="system-xs-regular text-text-tertiary">
                  {t(($) => $['members.you'], { ns: 'common' })}
                </span>
              )}
            </div>
            <div className="system-xs-regular wrap-break-word text-text-tertiary">
              {member.email}
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
            isCurrentUser={isCurrentUser}
            canTransferOwnership={canTransferOwnership}
            allowMultipleRoles={allowMultipleRoles}
            onTransferOwnership={onTransferOwnership}
          />
        </td>
      )}
    </tr>
  )
}

export default memo(MemberRow)

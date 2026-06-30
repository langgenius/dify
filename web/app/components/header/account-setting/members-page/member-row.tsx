'use client'
import type { Member } from '@/models/common'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { cn } from '@langgenius/dify-ui/cn'
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
  const isInvited = member.membership_status === 'invited'

  const roleNames = roles.map(role => role.name)

  const openDetails = useCallback(() => {
    if (isInvited)
      return
    onOpenDetails(member)
  }, [isInvited, member, onOpenDetails])

  return (
    <div
      data-testid={`member-row-${member.id}`}
      className="relative border-b border-divider-subtle"
    >
      <button
        type="button"
        aria-disabled={isInvited}
        tabIndex={isInvited ? -1 : 0}
        aria-label={isInvited
          ? undefined
          : t('members.memberDetails.openAria', {
              ns: 'common',
              name: member.name,
              defaultValue: 'Open member details for {{name}}',
            })}
        className={cn(
          'flex w-full min-w-0 bg-transparent text-left focus-visible:outline-hidden',
          isInvited
            ? 'cursor-default bg-background-section'
            : 'cursor-pointer hover:bg-state-base-hover focus-visible:bg-state-base-hover',
          canManage && !isInvited && 'pr-12',
        )}
        onClick={openDetails}
      >
        <span className="flex w-65 shrink-0 items-center px-3 py-2">
          <Avatar avatar={member.avatar_url} size="sm" className="mr-2" name={member.name} />
          <span className="min-w-0">
            <span className="block system-sm-medium text-text-secondary">
              {member.name}
              {isInvited && (
                <span className="ml-1 system-xs-medium text-text-warning">
                  {t('members.pending', { ns: 'common' })}
                </span>
              )}
              {!isInvited && member.status === 'pending' && (
                <span className="ml-1 system-xs-medium text-text-warning">
                  {t('members.pending', { ns: 'common' })}
                </span>
              )}
              {isCurrentUser && (
                <span className="system-xs-regular text-text-tertiary">
                  {t('members.you', { ns: 'common' })}
                </span>
              )}
            </span>
            <span className="block system-xs-regular text-text-tertiary">{member.email}</span>
          </span>
        </span>
        <span className="flex w-30 shrink-0 items-center py-2 system-sm-regular text-text-secondary">
          {isInvited ? '-' : formatTimeFromNow(Number((member.last_active_at || member.created_at)) * 1000)}
        </span>
        <span
          className="flex min-w-0 grow items-center gap-2 px-3"
          role="presentation"
        >
          <RoleBadges
            className="grow"
            roleNames={roleNames}
          />
        </span>
      </button>
      <div
        className="absolute inset-y-0 right-0 flex items-center px-3"
        role="presentation"
      >
        {canManage && !isInvited && (
          <MemberMenu
            member={member}
            isCurrentUser={isCurrentUser}
            canTransferOwnership={canTransferOwnership}
            allowMultipleRoles={allowMultipleRoles}
            onTransferOwnership={onTransferOwnership}
          />
        )}
      </div>
    </div>
  )
}

export default memo(MemberRow)

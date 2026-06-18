'use client'
import type { KeyboardEvent } from 'react'
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

  const roleNames = roles.map(role => role.name)

  const openDetails = useCallback(() => {
    onOpenDetails(member)
  }, [member, onOpenDetails])

  const handleRowKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openDetails()
    }
  }, [openDetails])

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`member-row-${member.id}`}
      aria-label={t('members.memberDetails.openAria', {
        ns: 'common',
        name: member.name,
        defaultValue: 'Open member details for {{name}}',
      })}
      className="flex cursor-pointer border-b border-divider-subtle hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:outline-hidden"
      onClick={openDetails}
      onKeyDown={handleRowKeyDown}
    >
      <div className="flex w-65 shrink-0 items-center px-3 py-2">
        <Avatar avatar={member.avatar_url} size="sm" className="mr-2" name={member.name} />
        <div className="">
          <div className="system-sm-medium text-text-secondary">
            {member.name}
            {member.status === 'pending' && (
              <span className="ml-1 system-xs-medium text-text-warning">
                {t('members.pending', { ns: 'common' })}
              </span>
            )}
            {isCurrentUser && (
              <span className="system-xs-regular text-text-tertiary">
                {t('members.you', { ns: 'common' })}
              </span>
            )}
          </div>
          <div className="system-xs-regular text-text-tertiary">{member.email}</div>
        </div>
      </div>
      <div className="flex w-30 shrink-0 items-center py-2 system-sm-regular text-text-secondary">
        {formatTimeFromNow(Number((member.last_active_at || member.created_at)) * 1000)}
      </div>
      <div
        className="flex min-w-0 grow items-center gap-2 px-3"
        role="presentation"
      >
        <RoleBadges
          className="grow"
          roleNames={roleNames}
        />
        {canManage && (
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

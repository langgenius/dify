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
  roleLabel: string
  isCurrentUser: boolean
  canManage: boolean
  operatorRole: string
  canTransferOwnership: boolean
  onOpenDetails: (member: Member) => void
  onOperate: () => void
  onTransferOwnership: () => void
}

const MemberRow = ({
  member,
  roleLabel,
  isCurrentUser,
  canManage,
  operatorRole,
  canTransferOwnership,
  onOpenDetails,
  onOperate,
  onTransferOwnership,
}: MemberRowProps) => {
  const { t } = useTranslation()
  const { formatTimeFromNow } = useFormatTimeFromNow()

  const openDetails = useCallback(() => {
    onOpenDetails(member)
  }, [member, onOpenDetails])

  const handleRowKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openDetails()
    }
  }, [openDetails])

  const stopPropagationOnClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
  }, [])

  const stopPropagationOnKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ')
      e.stopPropagation()
  }, [])

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
      <div className="flex grow items-center px-3 py-2">
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
      <div className="flex w-[120px] shrink-0 items-center py-2 system-sm-regular text-text-secondary">
        {formatTimeFromNow(Number((member.last_active_at || member.created_at)) * 1000)}
      </div>
      <div
        className="flex w-[215px] shrink-0 items-center gap-2 px-3"
        onClick={stopPropagationOnClick}
        onKeyDown={stopPropagationOnKeyDown}
        role="presentation"
      >
        <RoleBadges
          className="grow"
          roles={[roleLabel]}
        />
        {canManage && (
          <MemberMenu
            member={member}
            operatorRole={operatorRole}
            canTransferOwnership={canTransferOwnership}
            onOperate={onOperate}
            onTransferOwnership={onTransferOwnership}
          />
        )}
      </div>
    </div>
  )
}

export default memo(MemberRow)

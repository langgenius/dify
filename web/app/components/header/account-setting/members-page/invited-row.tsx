'use client'
import type { PendingWorkspaceInvitationResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { Ref } from 'react'
import { Avatar, AvatarFallback } from '@langgenius/dify-ui/avatar'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { getAvatarInitial } from '@/utils/avatar'
import { RoleBadges } from './role-badges'

export const InvitedStatus = ({ expiresAt }: { expiresAt?: string }) => {
  const { t } = useTranslation(['workspaceMembers'])
  const locale = useLocale()

  return (
    <div className="min-w-0">
      <div className="system-sm-regular text-text-tertiary">
        {t(($) => $['members.invited'], { ns: 'workspaceMembers' })}
      </div>
      {expiresAt && (
        <div className="system-xs-regular text-text-quaternary">
          <time dateTime={expiresAt}>
            {t(($) => $['members.invitationExpiresOn'], {
              ns: 'workspaceMembers',
              date: new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(
                new Date(expiresAt),
              ),
            })}
          </time>
        </div>
      )}
    </div>
  )
}

type InvitedRowProps = {
  ref?: Ref<HTMLTableRowElement>
  invitation: PendingWorkspaceInvitationResponse
  canManage: boolean
}

export const InvitedRow = ({ ref, invitation, canManage }: InvitedRowProps) => (
  <tr ref={ref} className="border-b border-divider-subtle">
    <td className="px-3 py-2">
      <div className="flex min-w-0 items-center">
        <Avatar size="sm" className="me-2" aria-hidden="true">
          <AvatarFallback>{getAvatarInitial(invitation.email)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 system-sm-medium wrap-anywhere text-text-secondary">
          <span dir="ltr">{invitation.email}</span>
        </div>
      </div>
    </td>
    <td className="py-2">
      <InvitedStatus expiresAt={invitation.expires_at} />
    </td>
    <td className="px-3 py-2">
      <RoleBadges roleNames={[invitation.role]} />
    </td>
    {canManage && <td />}
  </tr>
)

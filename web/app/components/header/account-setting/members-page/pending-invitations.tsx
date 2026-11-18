import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { consoleQuery } from '@/service/console'
import { RoleBadges } from './role-badges'

export const PendingInvitations = ({ workspaceId }: { workspaceId: string }) => {
  const { t } = useTranslation(['workspaceMembers'])
  const locale = useLocale()
  const { data } = useQuery(
    consoleQuery.workspaces.byWorkspaceId.members.pendingInvitations.get.queryOptions({
      input: { params: { workspace_id: workspaceId } },
    }),
  )

  if (!data?.invitations.length) return null

  const title = t(($) => $['members.pendingInvitations'])
  const expirationFormat = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })

  return (
    <table className="mt-6 w-full table-fixed text-start">
      <caption className="mb-2 px-3 text-start system-sm-semibold text-text-primary">
        {title}
      </caption>
      <colgroup>
        <col className="w-1/2" />
        <col className="w-1/5" />
        <col />
      </colgroup>
      <thead>
        <tr className="border-b border-divider-regular">
          <th
            scope="col"
            className="px-3 py-1.75 text-start system-xs-medium-uppercase text-text-tertiary"
          >
            {t(($) => $['members.emailRecipients'])}
          </th>
          <th
            scope="col"
            className="px-3 py-1.75 text-start system-xs-medium-uppercase text-text-tertiary"
          >
            {t(($) => $['members.role'])}
          </th>
          <th
            scope="col"
            className="px-3 py-1.75 text-start system-xs-medium-uppercase text-text-tertiary"
          >
            {t(($) => $['members.invitationExpiresAt'])}
          </th>
        </tr>
      </thead>
      <tbody>
        {data.invitations.map((invitation) => (
          <tr key={invitation.email} className="border-b border-divider-subtle">
            <th
              scope="row"
              className="px-3 py-2 text-start system-sm-medium wrap-anywhere text-text-secondary"
            >
              <span dir="ltr">{invitation.email}</span>
            </th>
            <td className="px-3 py-2">
              <RoleBadges roleNames={[invitation.role]} />
            </td>
            <td className="px-3 py-2 system-sm-regular text-text-secondary">
              <time dateTime={invitation.expires_at}>
                {expirationFormat.format(new Date(invitation.expires_at))}
              </time>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

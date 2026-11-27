'use client'
import type { Ref } from 'react'
import { Avatar, AvatarFallback } from '@langgenius/dify-ui/avatar'
import { Dialog, DialogContent } from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@langgenius/dify-ui/menu'
import { isDefinedError } from '@orpc/client'
import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { toast } from '@/app/notifications'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/console'
import { useRequestErrorDescriber } from '@/service/use-request-error-message'
import { getAvatarInitial } from '@/utils/avatar'
import { InvitationResultsContent } from './invitation-results-content'
import { RoleBadges } from './role-badges'

export type Invitee = {
  email: string
  role: string
  roleName: string
  expiresAt?: string
}

const InvitedStatus = ({ expiresAt }: { expiresAt?: string }) => {
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
  invitee: Invitee
  canManage: boolean
  onRevoke: () => void
}

export const InvitedRow = ({ ref, invitee, canManage, onRevoke }: InvitedRowProps) => {
  const { t } = useTranslation(['common', 'workspaceMembers'])
  const describeRequestError = useRequestErrorDescriber()
  const locale = useLocale()
  const { data: isEmailSetup } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ is_email_setup }) => is_email_setup,
  })
  const resend = useMutation(
    consoleQuery.workspaces.current.members.inviteEmail.post.mutationOptions({
      meta: { errorToast: false },
      onSuccess: (response) => {
        const result = response.invitation_results.find(
          ({ email }) => email.toLowerCase() === invitee.email.toLowerCase(),
        )
        if (result?.status === 'success') {
          if (!isEmailSetup) return
          toast.success(
            t(($) => $['members.invitationResent'], {
              ns: 'workspaceMembers',
              email: invitee.email,
            }),
          )
          return
        }
        if (result?.status === 'already_member') {
          toast.warning(
            t(($) => $['members.alreadyJoined'], { ns: 'workspaceMembers', email: invitee.email }),
          )
          return
        }
        toast.error(result?.message || t(($) => $['api.actionFailed'], { ns: 'common' }))
      },
      onError: (error) => {
        const code = isDefinedError(error) ? error.code : undefined
        toast.error(
          code === 'limit_exceeded'
            ? t(($) => $['members.inviteLimitExceeded'], { ns: 'workspaceMembers' })
            : code === 'invalid_role'
              ? t(($) => $['members.invalidRole'], { ns: 'workspaceMembers' })
              : describeRequestError(
                  error,
                  t(($) => $['api.actionFailed'], { ns: 'common' }),
                ),
        )
      },
    }),
  )
  const resentLinks =
    !isEmailSetup && resend.data?.invitation_results.some(({ status }) => status === 'success')
      ? resend.data.invitation_results
      : undefined

  return (
    <tr ref={ref} className="border-b border-divider-subtle">
      <td className="px-3 py-2">
        <div className="flex min-w-0 items-center">
          <Avatar size="sm" className="me-2" aria-hidden="true">
            <AvatarFallback>{getAvatarInitial(invitee.email)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 system-sm-medium wrap-anywhere text-text-secondary">
            <span dir="ltr">{invitee.email}</span>
          </div>
        </div>
      </td>
      <td className="py-2">
        <InvitedStatus expiresAt={invitee.expiresAt} />
      </td>
      <td className="px-3 py-2">
        <RoleBadges roleNames={[invitee.roleName]} />
      </td>
      {canManage && (
        <td className="px-3 py-2">
          <Menu>
            <MenuTrigger
              render={
                <IconButton
                  size="lg"
                  aria-label={`${t(($) => $['members.invitationActions'], { ns: 'workspaceMembers' })}: ${invitee.email}`}
                  className="data-popup-open:bg-state-base-hover"
                >
                  <span aria-hidden className="i-ri-more-fill size-4 text-text-tertiary" />
                </IconButton>
              }
            />
            <MenuContent align="end" className="min-w-45 rounded-xl">
              <MenuItem
                className="system-sm-medium text-text-secondary"
                disabled={resend.isPending}
                onClick={() =>
                  resend.mutate({
                    body: { emails: [invitee.email], role: invitee.role, language: locale },
                  })
                }
              >
                {t(($) => $['members.resendInvitation'], { ns: 'workspaceMembers' })}
              </MenuItem>
              <MenuSeparator />
              <MenuItem variant="destructive" className="system-sm-medium" onClick={onRevoke}>
                {t(($) => $['members.revokeInvitation'], { ns: 'workspaceMembers' })}
              </MenuItem>
            </MenuContent>
          </Menu>
          <Dialog
            open={Boolean(resentLinks)}
            onOpenChange={(open) => {
              if (!open) resend.reset()
            }}
          >
            <DialogContent backdropProps={{ forceRender: true }}>
              {resentLinks && <InvitationResultsContent invitationResults={resentLinks} />}
            </DialogContent>
          </Dialog>
        </td>
      )}
    </tr>
  )
}

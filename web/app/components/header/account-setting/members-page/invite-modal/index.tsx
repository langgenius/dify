'use client'
import type { MemberInviteResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { DialogActions } from '@langgenius/dify-ui/dialog'
import type { Ref } from 'react'
import type { EmailRecipient } from './email-recipients'
import { Alert, AlertDescription, AlertTitle } from '@langgenius/dify-ui/alert'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { Form } from '@langgenius/dify-ui/form'
import { isDefinedError } from '@orpc/client'
import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { getCountQuota } from '@/app/components/billing/quota'
import { currentWorkspaceAtom } from '@/context/workspace-state'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/console'
import { useRequestErrorDescriber } from '@/service/use-request-error-message'
import { InvitationResultsContent } from '../invitation-results-content'
import { InviteButton } from '../invite-button'
import { mergeEmailRecipients } from './email-recipients'
import { EmailRecipientsField } from './email-recipients-field'
import { RoleSelector } from './role-selector'

type InvitationResults = MemberInviteResponse['invitation_results']
type InviteModalProps = {
  onSend: (emails: string[]) => void
}

type InviteFieldName = 'emails' | 'role'
type InviteFormValues = {
  emails: string
  role: string
}
// The documented invite errors the form presents on the field that caused them.
type InviteFieldErrorCode = 'invalid_role' | 'limit_exceeded'
type InviteFormProps = {
  ref: Ref<HTMLFormElement>
  isEmailSetup: boolean
  isPending: boolean
  errorCode: InviteFieldErrorCode | null
  error: unknown
  results: InvitationResults | undefined
  onSubmit: (
    emails: string[],
    role: string,
    onResults: (results: InvitationResults) => void,
  ) => void
  onDismissError: () => void
}

function InviteForm({
  ref,
  isEmailSetup,
  isPending,
  errorCode,
  error,
  results,
  onSubmit,
  onDismissError,
}: InviteFormProps) {
  const { t } = useTranslation(['workspaceMembers'])
  const describeRequestError = useRequestErrorDescriber()
  const { data: features } = useQuery(consoleQuery.features.get.queryOptions())
  const workspaceId = useAtomValue(currentWorkspaceAtom).id
  const { data: reservedSeats = 0 } = useQuery({
    ...consoleQuery.workspaces.byWorkspaceId.members.pendingInvitations.get.queryOptions({
      input: { params: { workspace_id: workspaceId } },
    }),
    enabled: Boolean(workspaceId),
    select: (data) => data.invitations.length,
  })
  const submitButtonRef = useRef<HTMLButtonElement>(null)
  const [recipients, setRecipients] = useState<EmailRecipient[]>([])
  const [draft, setDraft] = useState('')
  const fieldErrors: Partial<Record<InviteFieldName, string>> | undefined =
    errorCode === 'limit_exceeded'
      ? { emails: t(($) => $['members.inviteLimitExceeded'], { ns: 'workspaceMembers' }) }
      : errorCode === 'invalid_role'
        ? { role: t(($) => $['members.invalidRole'], { ns: 'workspaceMembers' }) }
        : undefined
  const formError =
    error && !fieldErrors
      ? describeRequestError(
          error,
          t(($) => $['members.inviteFailed'], { ns: 'workspaceMembers' }),
        )
      : null
  const memberLimit = features
    ? getCountQuota(
        features.workspace_members.enabled ? features.workspace_members : features.members,
      )
    : undefined
  const remainingSeats =
    memberLimit && memberLimit.limit !== 'unlimited'
      ? Math.max(memberLimit.limit - memberLimit.usage - reservedSeats, 0)
      : null
  const effectiveRecipients = mergeEmailRecipients(recipients, draft)
  const validRecipientCount = effectiveRecipients.filter(({ isValid }) => isValid).length
  const exceedsRemainingSeats = remainingSeats !== null && validRecipientCount > remainingSeats

  const dismissEmailError = () => {
    if (fieldErrors?.emails) onDismissError()
  }

  const handleSubmit = ({ role }: InviteFormValues) => {
    if (isPending) return

    // Keep keyboard submission focused before pending disables the email composer.
    submitButtonRef.current?.focus()
    setRecipients(effectiveRecipients)
    setDraft('')
    onSubmit(
      effectiveRecipients.map(({ value }) => value),
      role,
      (nextResults) => {
        const failedEmails = new Set(
          nextResults.filter(({ status }) => status === 'failed').map(({ email }) => email),
        )
        setRecipients(effectiveRecipients.filter(({ value }) => failedEmails.has(value)))
      },
    )
  }
  const failedResults = results?.filter((item) => item.status === 'failed') ?? []
  const alreadyMemberEmails =
    results?.filter((item) => item.status === 'already_member').map(({ email }) => email) ?? []
  const sentCount = results?.filter((item) => item.status === 'success').length ?? 0

  return (
    <Form<InviteFormValues>
      className="contents"
      ref={ref}
      aria-label={t(($) => $['members.inviteTeamMember'], { ns: 'workspaceMembers' })}
      errors={fieldErrors}
      onFormSubmit={handleSubmit}
    >
      <DialogBody className="grid gap-5">
        {!isEmailSetup && (
          <Alert type="warning">
            <AlertTitle>
              {t(($) => $['members.emailNotSetup'], { ns: 'workspaceMembers' })}
            </AlertTitle>
          </Alert>
        )}
        <EmailRecipientsField
          recipients={recipients}
          draft={draft}
          onRecipientsChange={setRecipients}
          onDraftChange={setDraft}
          onChange={dismissEmailError}
          disabled={isPending}
        />
        <RoleSelector hasServerError={Boolean(fieldErrors?.role)} disabled={isPending} />
        {exceedsRemainingSeats && (
          <Alert type="warning">
            <AlertTitle>
              {remainingSeats === 0
                ? t(($) => $['members.seatsFull'], { ns: 'workspaceMembers' })
                : t(($) => $['members.seatsRemaining'], {
                    ns: 'workspaceMembers',
                    count: remainingSeats,
                  })}
            </AlertTitle>
            <AlertDescription>
              {remainingSeats === 0
                ? t(($) => $['members.seatsFullTip'], { ns: 'workspaceMembers' })
                : t(($) => $['members.recipientCountExceedsSeats'], { ns: 'workspaceMembers' })}
            </AlertDescription>
          </Alert>
        )}
        {failedResults.length > 0 && (
          <Alert type={sentCount > 0 ? 'warning' : 'error'}>
            <AlertTitle>
              {sentCount > 0
                ? t(($) => $['members.invitePartiallyFailed'], {
                    ns: 'workspaceMembers',
                    count: failedResults.length,
                  })
                : t(($) => $['members.inviteNoneSent'], { ns: 'workspaceMembers' })}
            </AlertTitle>
            <AlertDescription render={<div />}>
              <ul className="my-1 flex flex-col gap-1">
                {failedResults.map((item) => (
                  <li key={item.email} className="wrap-anywhere">
                    <div dir="ltr" className="system-xs-medium text-text-secondary">
                      {item.email}
                    </div>
                    {item.message && <div>{item.message}</div>}
                  </li>
                ))}
              </ul>
              {t(($) => $['members.failedRecipientsKept'], { ns: 'workspaceMembers' })}
            </AlertDescription>
          </Alert>
        )}
        {alreadyMemberEmails.length > 0 && (
          <Alert type="info">
            <AlertTitle>
              {t(($) => $['members.alreadyInWorkspace'], {
                ns: 'workspaceMembers',
                count: alreadyMemberEmails.length,
              })}
            </AlertTitle>
            <AlertDescription>
              <span dir="ltr" className="wrap-anywhere">
                {alreadyMemberEmails.join(', ')}
              </span>
            </AlertDescription>
          </Alert>
        )}
        {formError && (
          <div role="alert" className="body-xs-regular text-text-destructive">
            {formError}
          </div>
        )}
      </DialogBody>
      <DialogFooter>
        <Button
          ref={submitButtonRef}
          type="submit"
          variant="primary"
          className="w-full"
          loading={isPending}
        >
          {validRecipientCount > 0
            ? t(($) => $['members.sendInviteCount'], {
                ns: 'workspaceMembers',
                count: validRecipientCount,
              })
            : t(($) => $['members.sendInvite'], { ns: 'workspaceMembers' })}
        </Button>
      </DialogFooter>
    </Form>
  )
}

export function InviteModal({ onSend }: InviteModalProps) {
  const { t } = useTranslation(['common', 'workspaceMembers'])
  const locale = useLocale()
  const actionsRef = useRef<DialogActions>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const { data: isEmailSetup } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ is_email_setup }) => is_email_setup,
  })
  const showsInvitationLinks = (results: InvitationResults) =>
    !isEmailSetup && results.some(({ status }) => status === 'success')
  const { mutate, reset, isPending, error, data } = useMutation(
    consoleQuery.workspaces.current.members.inviteEmail.post.mutationOptions({
      meta: { errorToast: false },
      onSuccess: (response) => {
        const results = response.invitation_results
        onSend(results.map(({ email }) => email.toLowerCase()))
        if (results.every(({ status }) => status === 'success') && !showsInvitationLinks(results))
          actionsRef.current?.close()
      },
    }),
  )

  const isBusy = isPending
  const handleSubmit = (
    emails: string[],
    role: string,
    onResults: (results: InvitationResults) => void,
  ) => {
    if (isPending) return
    reset()
    mutate(
      { body: { emails, role, language: locale } },
      { onSuccess: (response) => onResults(response.invitation_results) },
    )
  }
  const linkResults =
    data && showsInvitationLinks(data.invitation_results) ? data.invitation_results : undefined

  return (
    <>
      <Dialog
        actionsRef={actionsRef}
        disablePointerDismissal
        onOpenChange={(nextOpen, details) => {
          if (!nextOpen && isBusy && details.reason !== 'imperative-action') details.cancel()
        }}
        onOpenChangeComplete={(open) => {
          // A failure stays visible through the exit transition and ends with the session.
          if (!open) {
            reset()
          }
        }}
      >
        <DialogTrigger render={<InviteButton />} />
        <DialogContent
          backdropProps={{ forceRender: true }}
          initialFocus={() => {
            const emailInput = formRef.current?.elements.namedItem('emails')
            return emailInput instanceof HTMLInputElement ? emailInput : true
          }}
        >
          {linkResults ? (
            <InvitationResultsContent invitationResults={linkResults} />
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>
                  {t(($) => $['members.inviteTeamMember'], { ns: 'workspaceMembers' })}
                </DialogTitle>
                <DialogDescription>
                  {t(($) => $['members.inviteTeamMemberTip'], { ns: 'workspaceMembers' })}
                </DialogDescription>
                <DialogHeaderCloseButton
                  aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                  disabled={isBusy}
                />
              </DialogHeader>
              <InviteForm
                ref={formRef}
                isEmailSetup={isEmailSetup}
                isPending={isBusy}
                // The link marks a documented code as defined, so `error.code` narrows to the invite contract.
                errorCode={isDefinedError(error) ? error.code : null}
                error={error}
                results={data?.invitation_results}
                onSubmit={handleSubmit}
                onDismissError={() => {
                  reset()
                }}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

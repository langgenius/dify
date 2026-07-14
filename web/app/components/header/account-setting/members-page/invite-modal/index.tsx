'use client'

import type { MemberInviteResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ReactElement } from 'react'
import type { EmailRecipient } from './email-recipients'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { Form } from '@langgenius/dify-ui/form'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '@/context/i18n'
import { useProviderContextSelector } from '@/context/provider-context'
import { consoleQuery } from '@/service/client'
import { commonQueryKeys } from '@/service/use-common'
import { mergeEmailRecipients } from './email-recipients'
import { EmailRecipientsField } from './email-recipients-field'
import { getInviteErrorCode } from './invite-error'
import { RoleSelector } from './role-selector'

type InviteModalProps = {
  open: boolean
  trigger: ReactElement
  isEmailSetup: boolean
  onOpenChange: (open: boolean) => void
  onSend: (invitationResults: MemberInviteResponse['invitation_results']) => void
}

type InviteFieldName = 'emails' | 'role'
type InviteFormValues = {
  emails: string
  role: string
}
type SubmissionError =
  | { kind: 'fields'; errors: Partial<Record<InviteFieldName, string>> }
  | { kind: 'form'; message: string }
  | null

type InviteFormProps = Omit<InviteModalProps, 'open' | 'trigger'>

function InviteForm({ isEmailSetup, onOpenChange, onSend }: InviteFormProps) {
  const { t } = useTranslation()
  const locale = useLocale()
  const queryClient = useQueryClient()
  const licenseLimit = useProviderContextSelector((state) => state.licenseLimit)
  const refreshLicenseLimit = useProviderContextSelector((state) => state.refreshLicenseLimit)
  const [recipients, setRecipients] = useState<EmailRecipient[]>([])
  const [draft, setDraft] = useState('')
  const [submissionError, setSubmissionError] = useState<SubmissionError>(null)
  const fieldErrors = submissionError?.kind === 'fields' ? submissionError.errors : undefined
  const currentSize = licenseLimit.workspace_members.size ?? 0
  const memberLimit = licenseLimit.workspace_members.limit
  const remainingSeats = memberLimit > 0 ? Math.max(memberLimit - currentSize, 0) : null
  const effectiveRecipients = mergeEmailRecipients(recipients, draft)
  const validRecipientCount = effectiveRecipients.filter(({ isValid }) => isValid).length
  const exceedsRemainingSeats = remainingSeats !== null && validRecipientCount > remainingSeats

  const { mutate, isPending } = useMutation(
    consoleQuery.workspaces.current.members.inviteEmail.post.mutationOptions({
      context: { silent: true },
    }),
  )

  const clearEmailSubmissionError = () => {
    setSubmissionError((error) => (error?.kind === 'fields' && error.errors.emails ? null : error))
  }

  const handleSubmit = ({ role }: InviteFormValues) => {
    if (isPending) return

    setRecipients(effectiveRecipients)
    setDraft('')
    setSubmissionError(null)
    mutate(
      {
        body: {
          emails: effectiveRecipients.map(({ value }) => value),
          role,
          language: locale,
        },
      },
      {
        onSuccess: (response) => {
          refreshLicenseLimit()
          void queryClient.invalidateQueries({ queryKey: commonQueryKeys.members })
          onOpenChange(false)
          onSend(response.invitation_results)
        },
        onError: (error) => {
          switch (getInviteErrorCode(error)) {
            case 'limit_exceeded':
              setSubmissionError({
                kind: 'fields',
                errors: {
                  emails: t(($) => $['members.inviteLimitExceeded'], { ns: 'common' }),
                },
              })
              break
            case 'invalid_role':
              setSubmissionError({
                kind: 'fields',
                errors: { role: t(($) => $['members.invalidRole'], { ns: 'common' }) },
              })
              break
            default:
              setSubmissionError({
                kind: 'form',
                message: t(($) => $['members.inviteFailed'], { ns: 'common' }),
              })
          }
        },
      },
    )
  }

  return (
    <Form<InviteFormValues>
      aria-label={t(($) => $['members.inviteTeamMember'], { ns: 'common' })}
      errors={fieldErrors}
      className="grid gap-5 pt-5"
      onFormSubmit={handleSubmit}
    >
      {!isEmailSetup && (
        <div className="flex items-start gap-1.5 rounded-lg bg-state-warning-hover p-2 text-text-warning">
          <span aria-hidden="true" className="i-ri-error-warning-fill size-4 shrink-0" />
          <span className="system-xs-medium text-text-primary">
            {t(($) => $['members.emailNotSetup'], { ns: 'common' })}
          </span>
        </div>
      )}
      <EmailRecipientsField
        recipients={recipients}
        draft={draft}
        onRecipientsChange={setRecipients}
        onDraftChange={setDraft}
        onChange={clearEmailSubmissionError}
        disabled={isPending}
      />
      <RoleSelector hasServerError={Boolean(fieldErrors?.role)} disabled={isPending} />
      {exceedsRemainingSeats && (
        <div
          role="status"
          className="flex items-start gap-1.5 rounded-lg bg-state-warning-hover p-2 body-xs-regular text-text-warning"
        >
          <span aria-hidden="true" className="i-ri-error-warning-line size-4 shrink-0" />
          <span>
            {t(($) => $['members.seatsRemaining'], {
              ns: 'common',
              count: remainingSeats,
            })}
            <span aria-hidden="true"> · </span>
            {t(($) => $['members.recipientCountExceedsSeats'], { ns: 'common' })}
          </span>
        </div>
      )}
      {submissionError?.kind === 'form' && (
        <div role="alert" className="body-xs-regular text-text-destructive">
          {submissionError.message}
        </div>
      )}
      <Button
        type="submit"
        variant="primary"
        className="w-full"
        loading={isPending}
        disabled={isPending}
      >
        {validRecipientCount > 0
          ? t(($) => $['members.sendInviteCount'], {
              ns: 'common',
              count: validRecipientCount,
            })
          : t(($) => $['members.sendInvite'], { ns: 'common' })}
      </Button>
    </Form>
  )
}

export function InviteModal({
  open,
  trigger,
  isEmailSetup,
  onOpenChange,
  onSend,
}: InviteModalProps) {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => onOpenChange(nextOpen)}>
      <DialogTrigger render={trigger} />
      <DialogContent backdropProps={{ forceRender: true }}>
        <div className="grid gap-1 pr-8">
          <DialogTitle className="text-xl font-semibold text-text-primary">
            {t(($) => $['members.inviteTeamMember'], { ns: 'common' })}
          </DialogTitle>
          <DialogDescription className="text-sm text-text-tertiary">
            {t(($) => $['members.inviteTeamMemberTip'], { ns: 'common' })}
          </DialogDescription>
        </div>
        <InviteForm isEmailSetup={isEmailSetup} onOpenChange={onOpenChange} onSend={onSend} />
        <DialogCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
      </DialogContent>
    </Dialog>
  )
}

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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '@/context/i18n'
import { isContactsManagementEnabled } from '@/features/contacts/management/feature-flag'
import { useOptionalMemberInviteContactUpgrade } from '@/features/contacts/management/hooks'
import { MemberInviteContactUpgradeDialog } from '@/features/contacts/management/member-invite-contact-upgrade-dialog'
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
type InviteSubmission = {
  emails: string[]
  role: string
}
type PendingUpgradeConfirmation = {
  contactIds: string[]
  submission: InviteSubmission
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
  const { data: features } = useQuery(consoleQuery.features.get.queryOptions())
  const contactUpgrade = useOptionalMemberInviteContactUpgrade()
  const [recipients, setRecipients] = useState<EmailRecipient[]>([])
  const [draft, setDraft] = useState('')
  const [pendingUpgradeConfirmation, setPendingUpgradeConfirmation] =
    useState<PendingUpgradeConfirmation | null>(null)
  const [submissionError, setSubmissionError] = useState<SubmissionError>(null)
  const fieldErrors = submissionError?.kind === 'fields' ? submissionError.errors : undefined
  const memberLimit = features?.workspace_members.enabled
    ? features.workspace_members
    : features?.billing.enabled && features.members.limit > 0
      ? features.members
      : undefined
  const remainingSeats =
    memberLimit && memberLimit.limit > 0 ? Math.max(memberLimit.limit - memberLimit.size, 0) : null
  const effectiveRecipients = mergeEmailRecipients(recipients, draft)
  const validRecipientCount = effectiveRecipients.filter(({ isValid }) => isValid).length
  const exceedsRemainingSeats = remainingSeats !== null && validRecipientCount > remainingSeats

  const { mutate, isPending } = useMutation(
    consoleQuery.workspaces.current.members.inviteEmail.post.mutationOptions({
      context: { silent: true },
    }),
  )
  const isBusy = isPending || contactUpgrade.isChecking || contactUpgrade.isUpgrading

  const clearEmailSubmissionError = () => {
    setSubmissionError((error) => (error?.kind === 'fields' && error.errors.emails ? null : error))
  }

  const handleInviteError = (error: unknown) => {
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
  }

  const submitInvitation = (submission: InviteSubmission, contactIds: string[] = []) => {
    mutate(
      {
        body: {
          emails: submission.emails,
          role: submission.role,
          language: locale,
        },
      },
      {
        onSuccess: async (response) => {
          void queryClient.invalidateQueries({ queryKey: consoleQuery.features.get.queryKey() })
          if (contactIds.length > 0) {
            await contactUpgrade.upgradeContacts({ contactIds })
          }
          setPendingUpgradeConfirmation(null)
          void queryClient.invalidateQueries({ queryKey: commonQueryKeys.members })
          onOpenChange(false)
          onSend(response.invitation_results)
        },
        onError: (error) => {
          setPendingUpgradeConfirmation(null)
          handleInviteError(error)
        },
      },
    )
  }

  const handleSubmit = async ({ role }: InviteFormValues) => {
    if (isBusy) return

    const submission = {
      emails: effectiveRecipients.map(({ value }) => value),
      role,
    }
    setRecipients(effectiveRecipients)
    setDraft('')
    setSubmissionError(null)

    if (isContactsManagementEnabled() && contactUpgrade.available) {
      try {
        const conflicts = await contactUpgrade.findConflicts({ emails: submission.emails })
        if (conflicts.length > 0) {
          setPendingUpgradeConfirmation({
            contactIds: conflicts.map((contact) => contact.id),
            submission,
          })
          return
        }
      } catch (error) {
        handleInviteError(error)
        return
      }
    }

    submitInvitation(submission)
  }

  const handleUpgradeDialogOpenChange = (open: boolean) => {
    if (open || isBusy) return
    setPendingUpgradeConfirmation(null)
  }

  const handleConfirmUpgrade = () => {
    if (!pendingUpgradeConfirmation || isBusy) return
    submitInvitation(pendingUpgradeConfirmation.submission, pendingUpgradeConfirmation.contactIds)
  }

  return (
    <>
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
          disabled={isBusy}
        />
        <RoleSelector hasServerError={Boolean(fieldErrors?.role)} disabled={isBusy} />
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
          loading={isBusy}
          disabled={isBusy}
        >
          {validRecipientCount > 0
            ? t(($) => $['members.sendInviteCount'], {
                ns: 'common',
                count: validRecipientCount,
              })
            : t(($) => $['members.sendInvite'], { ns: 'common' })}
        </Button>
      </Form>
      <MemberInviteContactUpgradeDialog
        conflictCount={pendingUpgradeConfirmation?.contactIds.length ?? 0}
        open={Boolean(pendingUpgradeConfirmation)}
        pending={isPending || contactUpgrade.isUpgrading}
        onOpenChange={handleUpgradeDialogOpenChange}
        onConfirm={handleConfirmUpgrade}
      />
    </>
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

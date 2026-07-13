'use client'

import type { FormProps } from '@langgenius/dify-ui/form'
import type { ReactElement } from 'react'
import type { EmailRecipient } from './email-recipients'
import type { Role } from '@/models/access-control'
import type { InvitationResult } from '@/models/common'
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
import { useEffect, useRef, useState } from 'react'
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
  onSend: (invitationResults: InvitationResult[]) => void
}

type SubmitError = {
  target: 'emails' | 'role' | 'form'
  message: string
} | null

type FormSubmitHandler = NonNullable<FormProps['onSubmit']>

type InviteFormProps = Omit<InviteModalProps, 'open' | 'trigger'>

function InviteForm({ isEmailSetup, onOpenChange, onSend }: InviteFormProps) {
  const { t } = useTranslation()
  const locale = useLocale()
  const queryClient = useQueryClient()
  const licenseLimit = useProviderContextSelector((state) => state.licenseLimit)
  const refreshLicenseLimit = useProviderContextSelector((state) => state.refreshLicenseLimit)
  const [recipients, setRecipients] = useState<EmailRecipient[]>([])
  const [draft, setDraft] = useState('')
  const [role, setRole] = useState<Role | null>(null)
  const [submitError, setSubmitError] = useState<SubmitError>(null)
  const emailInputRef = useRef<HTMLInputElement>(null)
  const roleTriggerRef = useRef<HTMLButtonElement>(null)
  const invalidRecipientError = recipients.some(({ isValid }) => !isValid)
    ? t(($) => $['members.emailInvalid'], { ns: 'common' })
    : null
  const emailServerError = submitError?.target === 'emails' ? submitError.message : undefined
  const emailError = invalidRecipientError || emailServerError
  const roleError = submitError?.target === 'role' ? submitError.message : undefined
  const currentSize = licenseLimit.workspace_members.size ?? 0
  const memberLimit = licenseLimit.workspace_members.limit
  const remainingSeats = memberLimit > 0 ? Math.max(memberLimit - currentSize, 0) : null
  const validRecipientCount = recipients.filter(({ isValid }) => isValid).length
  const exceedsRemainingSeats = remainingSeats !== null && validRecipientCount > remainingSeats
  const formErrors = {
    ...(emailError ? { emails: emailError } : {}),
    ...(roleError ? { role: roleError } : {}),
  }

  const { mutateAsync, isPending } = useMutation(
    consoleQuery.workspaces.current.members.inviteEmail.post.mutationOptions({
      context: { silent: true },
    }),
  )

  const clearSubmitError = (target: 'emails' | 'role') => {
    setSubmitError((error) => (error?.target === target ? null : error))
  }

  useEffect(() => {
    if (submitError?.target === 'emails') emailInputRef.current?.focus()
    if (submitError?.target === 'role') roleTriggerRef.current?.focus()
  }, [submitError])

  const handleSubmit: FormSubmitHandler = async (event) => {
    event.preventDefault()
    if (isPending) return

    const submittedDraft = new FormData(event.currentTarget).get('emails')
    const draftValue = typeof submittedDraft === 'string' ? submittedDraft : draft

    const submittedDraftRecipients = mergeEmailRecipients([], draftValue)
    if (draftValue.trim() && submittedDraftRecipients.some(({ isValid }) => !isValid)) {
      emailInputRef.current?.focus()
      return
    }

    const nextRecipients = mergeEmailRecipients(recipients, draftValue)

    if (nextRecipients.length === 0) {
      setSubmitError({
        target: 'emails',
        message: t(($) => $['members.emailRequired'], { ns: 'common' }),
      })
      emailInputRef.current?.focus()
      return
    }

    if (nextRecipients.some(({ isValid }) => !isValid)) {
      emailInputRef.current?.focus()
      return
    }

    setRecipients(nextRecipients)
    setDraft('')

    if (!role) {
      roleTriggerRef.current?.focus()
      return
    }

    setSubmitError(null)
    try {
      const response = await mutateAsync({
        body: {
          emails: nextRecipients.map(({ value }) => value),
          role: role.id,
          language: locale,
        },
      })

      refreshLicenseLimit()
      void queryClient.invalidateQueries({ queryKey: commonQueryKeys.members })
      onOpenChange(false)
      onSend(response.invitation_results)
    } catch (error) {
      switch (getInviteErrorCode(error)) {
        case 'limit_exceeded':
          setSubmitError({
            target: 'emails',
            message: t(($) => $['members.inviteLimitExceeded'], { ns: 'common' }),
          })
          break
        case 'invalid-role':
          setSubmitError({
            target: 'role',
            message: t(($) => $['members.invalidRole'], { ns: 'common' }),
          })
          break
        default:
          setSubmitError({
            target: 'form',
            message: t(($) => $['members.inviteFailed'], { ns: 'common' }),
          })
      }
    }
  }

  return (
    <Form
      aria-label={t(($) => $['members.inviteTeamMember'], { ns: 'common' })}
      errors={formErrors}
      className="grid gap-5 pt-5"
      onSubmit={handleSubmit}
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
        onChange={() => clearSubmitError('emails')}
        error={emailServerError}
        disabled={isPending}
        inputRef={emailInputRef}
      />
      <RoleSelector
        value={role}
        onChange={setRole}
        onInteract={() => clearSubmitError('role')}
        error={roleError}
        disabled={isPending}
        triggerRef={roleTriggerRef}
      />
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
      {submitError?.target === 'form' && (
        <div role="alert" className="body-xs-regular text-text-destructive">
          {submitError.message}
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

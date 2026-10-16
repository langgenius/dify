'use client'
import type { MemberInviteResponse } from '@dify/contracts/api/console/workspaces/types.gen'
import type { DialogActions } from '@langgenius/dify-ui/dialog'
import type { Ref } from 'react'
import type { EmailRecipient } from './email-recipients'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@langgenius/dify-ui/dialog'
import { Form } from '@langgenius/dify-ui/form'
import { isDefinedError } from '@orpc/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocale } from '#i18n'
import { deploymentEditionAtom } from '@/features/system-features/state'
import { consoleQuery } from '@/service/console'
import { InviteButton } from '../invite-button'
import { mergeEmailRecipients } from './email-recipients'
import { EmailRecipientsField } from './email-recipients-field'
import { RoleSelector } from './role-selector'

type InviteModalProps = {
  isEmailSetup: boolean
  onSend: (invitationResults: MemberInviteResponse['invitation_results']) => void
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
  hasError: boolean
  onSubmit: (emails: string[], role: string) => void
  onDismissError: () => void
}

function InviteForm({
  ref,
  isEmailSetup,
  isPending,
  errorCode,
  hasError,
  onSubmit,
  onDismissError,
}: InviteFormProps) {
  const { t } = useTranslation(['workspaceMembers'])
  const deploymentEdition = useAtomValue(deploymentEditionAtom)
  const { data: features } = useQuery(consoleQuery.features.get.queryOptions())
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
    hasError && !fieldErrors
      ? t(($) => $['members.inviteFailed'], { ns: 'workspaceMembers' })
      : null
  // A limit of 0 means unlimited.
  const memberLimit = features?.workspace_members.enabled
    ? features.workspace_members
    : deploymentEdition === 'CLOUD' && features && features.members.limit > 0
      ? features.members
      : undefined
  const remainingSeats =
    memberLimit && memberLimit.limit > 0 ? Math.max(memberLimit.limit - memberLimit.size, 0) : null
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
    )
  }

  return (
    <Form<InviteFormValues>
      ref={ref}
      aria-label={t(($) => $['members.inviteTeamMember'], { ns: 'workspaceMembers' })}
      errors={fieldErrors}
      onFormSubmit={handleSubmit}
    >
      <DialogBody className="grid gap-5">
        {!isEmailSetup && (
          <div className="flex items-start gap-1.5 rounded-lg bg-state-warning-hover p-2 text-text-warning">
            <span aria-hidden="true" className="i-ri-error-warning-fill size-4 shrink-0" />
            <span className="system-xs-medium text-text-primary">
              {t(($) => $['members.emailNotSetup'], { ns: 'workspaceMembers' })}
            </span>
          </div>
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
          <div
            role="status"
            className="flex items-start gap-1.5 rounded-lg bg-state-warning-hover p-2 body-xs-regular text-text-warning"
          >
            <span aria-hidden="true" className="i-ri-error-warning-line size-4 shrink-0" />
            <span>
              {t(($) => $['members.seatsRemaining'], {
                ns: 'workspaceMembers',
                count: remainingSeats,
              })}
              <span aria-hidden="true"> · </span>
              {t(($) => $['members.recipientCountExceedsSeats'], { ns: 'workspaceMembers' })}
            </span>
          </div>
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

export function InviteModal({ isEmailSetup, onSend }: InviteModalProps) {
  const { t } = useTranslation(['common', 'workspaceMembers'])
  const locale = useLocale()
  const queryClient = useQueryClient()
  const actionsRef = useRef<DialogActions>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const { mutate, reset, isPending, error } = useMutation(
    consoleQuery.workspaces.current.members.inviteEmail.post.mutationOptions({
      context: { silent: true },
      onSuccess: (response) => {
        // The request alone decides success; seat and member refreshes run in the background.
        void queryClient.invalidateQueries({ queryKey: consoleQuery.features.get.queryKey() })
        void queryClient.invalidateQueries({
          queryKey: consoleQuery.workspaces.current.members.get.key(),
        })
        onSend(response.invitation_results)
        actionsRef.current?.close()
      },
    }),
  )

  return (
    <Dialog
      actionsRef={actionsRef}
      onOpenChange={(nextOpen, details) => {
        if (!nextOpen && isPending && details.reason !== 'imperative-action') details.cancel()
      }}
      onOpenChangeComplete={(open) => {
        // A failure stays visible through the exit transition and ends with the session.
        if (!open) reset()
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
        <DialogHeader>
          <DialogTitle>
            {t(($) => $['members.inviteTeamMember'], { ns: 'workspaceMembers' })}
          </DialogTitle>
          <DialogDescription>
            {t(($) => $['members.inviteTeamMemberTip'], { ns: 'workspaceMembers' })}
          </DialogDescription>
          <DialogCloseButton
            aria-label={t(($) => $['operation.close'], { ns: 'common' })}
            disabled={isPending}
          />
        </DialogHeader>
        <InviteForm
          ref={formRef}
          isEmailSetup={isEmailSetup}
          isPending={isPending}
          // The link marks a documented code as defined, so `error.code` narrows to the invite contract.
          errorCode={isDefinedError(error) ? error.code : null}
          hasError={!!error}
          onSubmit={(emails, role) => mutate({ body: { emails, role, language: locale } })}
          onDismissError={reset}
        />
      </DialogContent>
    </Dialog>
  )
}

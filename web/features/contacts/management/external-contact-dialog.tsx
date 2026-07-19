'use client'

import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldControl, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useContactsFeatureContext } from './composition-context'
import { useCreateExternalContact } from './hooks'

type ExternalContactDraft = {
  displayName: string
  email: string
}

type ExternalContactDialogProps = {
  onCreated: (contactId: string) => void
  onOpenChange: (open: boolean) => void
  open: boolean
}

const emptyDraft: ExternalContactDraft = { displayName: '', email: '' }
function isValidEmail(value: string) {
  const parts = value.split('@')
  if (parts.length !== 2) return false
  const [local, domain] = parts
  return Boolean(
    local &&
    domain &&
    !value.includes(' ') &&
    domain.includes('.') &&
    !domain.startsWith('.') &&
    !domain.endsWith('.'),
  )
}

export function ExternalContactDialog({
  onCreated,
  onOpenChange,
  open,
}: ExternalContactDialogProps) {
  const { t } = useTranslation('contacts')
  const context = useContactsFeatureContext()
  const createExternalContact = useCreateExternalContact()
  const [draft, setDraft] = useState<ExternalContactDraft>(emptyDraft)
  const [fieldError, setFieldError] = useState<
    'name_required' | 'email_required' | 'email_invalid' | null
  >(null)
  const [resultError, setResultError] = useState<string | null>(null)
  const resetMutation = createExternalContact.reset

  function resetDialog() {
    setDraft(emptyDraft)
    setFieldError(null)
    setResultError(null)
    resetMutation()
  }

  function closeDialog() {
    if (createExternalContact.isPending) return
    onOpenChange(false)
    resetDialog()
  }

  function updateDraft(field: keyof ExternalContactDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
    setFieldError(null)
    setResultError(null)
  }

  async function handleSubmit() {
    if (!draft.displayName.trim()) {
      setFieldError('name_required')
      return
    }
    if (!draft.email.trim()) {
      setFieldError('email_required')
      return
    }
    if (!isValidEmail(draft.email.trim())) {
      setFieldError('email_invalid')
      return
    }

    const result = await createExternalContact.mutateAsync({
      displayName: draft.displayName.trim(),
      email: draft.email.trim(),
      workspaceId: context.workspaceId,
    })
    if (result.kind === 'created') {
      onOpenChange(false)
      onCreated(result.contactId)
      resetDialog()
      return
    }

    setResultError(result.kind)
  }

  const fieldErrorMessage = fieldError ? t(($) => $[`external.validation.${fieldError}`]) : null
  const resultErrorMessage = (() => {
    switch (resultError) {
      case 'duplicate_external_contact':
        return t(($) => $['external.result.duplicate_external_contact'])
      case 'matches_workspace_contact':
        return t(($) => $['external.result.matches_workspace_contact'])
      case 'matches_platform_contact':
        return t(($) => $['external.result.matches_platform_contact'])
      case 'failed':
        return t(($) => $['external.result.failed'])
      default:
        return null
    }
  })()

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && closeDialog()}
      disablePointerDismissal={createExternalContact.isPending}
    >
      <DialogContent className="w-120 max-w-[calc(100vw-2rem)] p-0!">
        <DialogCloseButton
          aria-label={t(($) => $['action.close'])}
          disabled={createExternalContact.isPending}
        />
        <div className="px-6 pt-6 pb-4">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['external.title'])}
          </DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {t(($) => $['external.description'])}
          </DialogDescription>
        </div>
        <Form<ExternalContactDraft> onFormSubmit={handleSubmit} className="px-6 pb-6">
          <div className="mb-5 flex justify-center rounded-xl bg-gradient-to-br from-background-default-subtle to-background-section-burn py-5">
            <Avatar
              avatar={null}
              className="ring-4 ring-components-panel-bg"
              name={draft.displayName || t(($) => $['external.avatarFallback'])}
              size="3xl"
            />
          </div>
          <div className="space-y-4">
            <Field name="displayName" invalid={fieldError === 'name_required'}>
              <FieldLabel>{t(($) => $['external.name'])}</FieldLabel>
              <FieldControl
                aria-describedby={
                  fieldError === 'name_required' ? 'external-name-error' : undefined
                }
                autoComplete="name"
                disabled={createExternalContact.isPending}
                required
                value={draft.displayName}
                onValueChange={(value) => updateDraft('displayName', value)}
              />
              {fieldError === 'name_required' && (
                <p
                  id="external-name-error"
                  role="alert"
                  className="body-xs-regular text-text-destructive"
                >
                  {fieldErrorMessage}
                </p>
              )}
              <FieldError match="valueMissing">
                {t(($) => $['external.validation.name_required'])}
              </FieldError>
            </Field>
            <Field
              name="email"
              invalid={fieldError === 'email_required' || fieldError === 'email_invalid'}
            >
              <FieldLabel>{t(($) => $['external.email'])}</FieldLabel>
              <FieldControl
                aria-describedby={
                  fieldError?.startsWith('email') ? 'external-email-error' : undefined
                }
                autoComplete="email"
                disabled={createExternalContact.isPending}
                required
                type="email"
                value={draft.email}
                onValueChange={(value) => updateDraft('email', value)}
              />
              {fieldError?.startsWith('email') && (
                <p
                  id="external-email-error"
                  role="alert"
                  className="body-xs-regular text-text-destructive"
                >
                  {fieldErrorMessage}
                </p>
              )}
              <FieldError match="valueMissing">
                {t(($) => $['external.validation.email_required'])}
              </FieldError>
              <FieldError match="typeMismatch">
                {t(($) => $['external.validation.email_invalid'])}
              </FieldError>
            </Field>
          </div>
          {resultErrorMessage && (
            <div
              role="alert"
              className="mt-4 rounded-lg bg-state-destructive-hover p-3 system-sm-regular text-text-destructive"
            >
              {resultErrorMessage}
            </div>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button disabled={createExternalContact.isPending} onClick={closeDialog}>
              {t(($) => $['action.cancel'])}
            </Button>
            <Button type="submit" variant="primary" loading={createExternalContact.isPending}>
              {createExternalContact.isPending
                ? t(($) => $['external.adding'])
                : t(($) => $['external.add'])}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

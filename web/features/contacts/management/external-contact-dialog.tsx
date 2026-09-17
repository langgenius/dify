'use client'

import type { ContactView } from './types'
import { Avatar } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import { ALLOW_FILE_EXTENSIONS } from '@/types/app'
import { useCreateExternalContact, useUpdateExternalContact } from './hooks'

type ExternalContactDraft = {
  displayName: string
  email: string
}

type ExternalContactDialogProps = {
  onCreated: (contactId: string) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  contact?: Pick<ContactView, 'avatar_url' | 'email' | 'id' | 'name'>
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
  contact,
  onCreated,
  onOpenChange,
  open,
}: ExternalContactDialogProps) {
  const { t } = useTranslation('contacts')
  const createExternalContact = useCreateExternalContact()
  const updateExternalContact = useUpdateExternalContact()
  const uploadAvatar = useMutation(consoleQuery.files.upload.post.mutationOptions())
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [uploadedAvatar, setUploadedAvatar] = useState<{ id: string; url: string }>()
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const initialDraft = contact
    ? { displayName: contact.name, email: contact.email ?? '' }
    : emptyDraft
  const [draft, setDraft] = useState<ExternalContactDraft>(initialDraft)
  const [fieldError, setFieldError] = useState<
    'name_required' | 'email_required' | 'email_invalid' | null
  >(null)
  const [resultError, setResultError] = useState<string | null>(null)
  const resetMutation = createExternalContact.reset
  const pending = createExternalContact.isPending || updateExternalContact.isPending
  const busy = pending || uploadAvatar.isPending

  useEffect(() => {
    return () => {
      if (uploadedAvatar) URL.revokeObjectURL(uploadedAvatar.url)
    }
  }, [uploadedAvatar])

  function resetAvatar() {
    setUploadedAvatar(undefined)
    setAvatarError(null)
    uploadAvatar.reset()
  }

  function handleAvatarUpload(file: File) {
    if (busy) return
    const extension = file.name.split('.').pop()?.toLowerCase()
    if (!extension || !ALLOW_FILE_EXTENSIONS.includes(extension)) {
      setAvatarError(t(($) => $['imageInput.supportedFormats'], { ns: 'common' }))
      return
    }
    if (file.size > 3 * 1024 * 1024) {
      setAvatarError(
        t(($) => $['imageUploader.uploadFromComputerLimit'], { ns: 'common', size: 3 }),
      )
      return
    }
    setAvatarError(null)
    uploadAvatar.mutate(
      { body: { file } },
      {
        onSuccess: ({ id }) => setUploadedAvatar({ id, url: URL.createObjectURL(file) }),
        onError: () =>
          setAvatarError(
            t(($) => $['imageUploader.uploadFromComputerUploadError'], { ns: 'common' }),
          ),
      },
    )
  }

  function resetDialog() {
    setDraft(initialDraft)
    setFieldError(null)
    setResultError(null)
    resetMutation()
    updateExternalContact.reset()
    resetAvatar()
  }

  function closeDialog() {
    if (busy) return
    onOpenChange(false)
    resetDialog()
  }

  function updateDraft(field: keyof ExternalContactDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }))
    setFieldError(null)
    setResultError(null)
  }

  async function handleSubmit() {
    if (busy || avatarError) return
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

    const values = {
      displayName: draft.displayName.trim(),
      email: draft.email.trim(),
      ...(uploadedAvatar ? { avatar: uploadedAvatar.id } : {}),
    }
    const result = contact
      ? await updateExternalContact.mutateAsync({ ...values, contactId: contact.id })
      : await createExternalContact.mutateAsync(values)
    if (result.kind === 'created' || result.kind === 'updated') {
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
        return contact
          ? t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' })
          : t(($) => $['external.result.failed'])
      default:
        return null
    }
  })()

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => !nextOpen && closeDialog()}
      disablePointerDismissal={busy}
    >
      <DialogContent className="w-120 max-w-[calc(100vw-2rem)] p-0!">
        <DialogClose
          render={
            <IconButton
              aria-label={t(($) => $['action.close'])}
              className="absolute top-6 right-6"
              disabled={busy}
              size="lg"
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          }
        />
        <div className="px-6 pt-6 pb-4">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $[contact ? 'external.editTitle' : 'external.title'])}
          </DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {t(($) => $[contact ? 'external.editDescription' : 'external.description'])}
          </DialogDescription>
        </div>
        <Form<ExternalContactDraft> onFormSubmit={handleSubmit} className="px-6 pb-6">
          <div className="mb-5 flex flex-col items-center gap-3 rounded-xl bg-linear-to-br from-background-default-subtle to-background-section-burn py-5">
            <button
              type="button"
              aria-label={t(($) => $['avatar.editAction'], { ns: 'common' })}
              aria-describedby={avatarError ? 'external-avatar-error' : undefined}
              className="relative rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-components-input-border-hover disabled:cursor-wait"
              disabled={busy}
              onClick={() => avatarInputRef.current?.click()}
            >
              <Avatar
                avatar={uploadedAvatar?.url ?? contact?.avatar_url ?? null}
                className="ring-4 ring-components-panel-bg"
                name={draft.displayName || t(($) => $['external.avatarFallback'])}
                size="3xl"
              />
              <span className="absolute right-0 bottom-0 flex size-7 items-center justify-center rounded-full bg-components-panel-bg shadow-sm">
                <span
                  aria-hidden
                  className={
                    uploadAvatar.isPending
                      ? 'i-ri-loader-4-line size-4 animate-spin'
                      : 'i-ri-camera-line size-4'
                  }
                />
              </span>
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept={ALLOW_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(',')}
              aria-label={t(($) => $['imageUploader.imageUpload'], { ns: 'common' })}
              className="hidden"
              disabled={busy}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                if (file) handleAvatarUpload(file)
              }}
            />
            {uploadAvatar.isPending && (
              <span role="status" className="system-xs-regular text-text-tertiary">
                {t(($) => $.loading, { ns: 'common' })}
              </span>
            )}
            {avatarError && (
              <p
                id="external-avatar-error"
                role="alert"
                className="system-xs-regular text-text-destructive"
              >
                {avatarError}
              </p>
            )}
            {(uploadedAvatar || avatarError) && (
              <Button size="small" disabled={busy} onClick={resetAvatar}>
                {t(($) => $['operation.reset'], { ns: 'common' })}
              </Button>
            )}
          </div>
          <div className="space-y-4">
            <Field name="displayName" invalid={fieldError === 'name_required'}>
              <FieldLabel>{t(($) => $['external.name'])}</FieldLabel>
              <Input
                aria-describedby={
                  fieldError === 'name_required' ? 'external-name-error' : undefined
                }
                autoComplete="name"
                disabled={busy}
                required
                value={draft.displayName}
                onChange={(event) => updateDraft('displayName', event.currentTarget.value)}
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
              <Input
                aria-describedby={
                  fieldError?.startsWith('email') ? 'external-email-error' : undefined
                }
                autoComplete="email"
                disabled={busy}
                required
                type="email"
                value={draft.email}
                onChange={(event) => updateDraft('email', event.currentTarget.value)}
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
            <Button disabled={busy} onClick={closeDialog}>
              {t(($) => $['action.cancel'])}
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={pending}
              disabled={uploadAvatar.isPending || Boolean(avatarError)}
            >
              {pending
                ? t(($) => $[contact ? 'external.saving' : 'external.adding'])
                : t(($) => $[contact ? 'external.save' : 'external.add'])}
            </Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

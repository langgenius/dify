'use client'

import type { ContactView } from './types'
import { AvatarFallback, AvatarImage, AvatarRoot } from '@langgenius/dify-ui/avatar'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
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

// Original artwork exported from Figma node 1303:66983.
const defaultAvatarPeople =
  'data:image/svg+xml;base64,PHN2ZyBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIiBvdmVyZmxvdz0idmlzaWJsZSIgc3R5bGU9ImRpc3BsYXk6IGJsb2NrOyIgd2lkdGg9IjcyIiBoZWlnaHQ9IjExNi41NzEiIHZpZXdCb3g9IjAgMCA3MiAxMTYuNTcxIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8ZyBpZD0iUGVvcGxlIj4KPGNpcmNsZSBpZD0iSGVhZCIgY3g9IjM2IiBjeT0iMTguODU3MSIgcj0iMTguODU3MSIgZmlsbD0idXJsKCNwYWludDBfcmFkaWFsXzBfMTkxNykiLz4KPGNpcmNsZSBpZD0iQm9keSIgY3g9IjM2IiBjeT0iODAuNTcxNCIgcj0iMzYiIGZpbGw9InVybCgjcGFpbnQxX3JhZGlhbF8wXzE5MTcpIi8+CjwvZz4KPGRlZnM+CjxyYWRpYWxHcmFkaWVudCBpZD0icGFpbnQwX3JhZGlhbF8wXzE5MTciIGN4PSIwIiBjeT0iMCIgcj0iMSIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiIGdyYWRpZW50VHJhbnNmb3JtPSJ0cmFuc2xhdGUoMjcuNDI4NiA3LjcxNDI4KSByb3RhdGUoNTQuNjM3NSkgc2NhbGUoMzIuNTgyNykiPgo8c3RvcCBzdG9wLWNvbG9yPSJ3aGl0ZSIgc3RvcC1vcGFjaXR5PSIwLjkiLz4KPHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSJ3aGl0ZSIgc3RvcC1vcGFjaXR5PSIwLjMiLz4KPC9yYWRpYWxHcmFkaWVudD4KPHJhZGlhbEdyYWRpZW50IGlkPSJwYWludDFfcmFkaWFsXzBfMTkxNyIgY3g9IjAiIGN5PSIwIiByPSIxIiBncmFkaWVudFVuaXRzPSJ1c2VyU3BhY2VPblVzZSIgZ3JhZGllbnRUcmFuc2Zvcm09InRyYW5zbGF0ZSgyNC44NTcxIDU1LjcxNDMpIHJvdGF0ZSg2Mi4xNTI0KSBzY2FsZSg1MS4zNzg1KSI+CjxzdG9wIHN0b3AtY29sb3I9IndoaXRlIiBzdG9wLW9wYWNpdHk9IjAuNyIvPgo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IndoaXRlIiBzdG9wLW9wYWNpdHk9IjAuMyIvPgo8L3JhZGlhbEdyYWRpZW50Pgo8L2RlZnM+Cjwvc3ZnPgo='
const avatarInnerRing =
  'data:image/svg+xml;base64,PHN2ZyBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIiBvdmVyZmxvdz0idmlzaWJsZSIgc3R5bGU9ImRpc3BsYXk6IGJsb2NrOyIgd2lkdGg9IjEyNCIgaGVpZ2h0PSIxMjQiIHZpZXdCb3g9IjAgMCAxMjQgMTI0IiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8Y2lyY2xlIGlkPSJFbGxpcHNlIDEiIG9wYWNpdHk9IjAuNiIgY3g9IjYyIiBjeT0iNjIiIHI9IjYxLjUiIHN0cm9rZT0iIzEwMTgyOCIgc3Ryb2tlLW9wYWNpdHk9IjAuMDQiLz4KPC9zdmc+Cg=='
const avatarOuterRing =
  'data:image/svg+xml;base64,PHN2ZyBwcmVzZXJ2ZUFzcGVjdFJhdGlvPSJub25lIiBvdmVyZmxvdz0idmlzaWJsZSIgc3R5bGU9ImRpc3BsYXk6IGJsb2NrOyIgd2lkdGg9IjE1NiIgaGVpZ2h0PSIxNTYiIHZpZXdCb3g9IjAgMCAxNTYgMTU2IiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8Y2lyY2xlIGlkPSJFbGxpcHNlIDIiIG9wYWNpdHk9IjAuNCIgY3g9Ijc4IiBjeT0iNzgiIHI9Ijc3LjUiIHN0cm9rZT0iIzEwMTgyOCIgc3Ryb2tlLW9wYWNpdHk9IjAuMDQiLz4KPC9zdmc+Cg=='

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

function ContactAvatar({
  avatar,
  className,
  name,
}: {
  avatar: string | null
  className?: string
  name: string
}) {
  return (
    <AvatarRoot
      className={cn(
        'size-24 border-2 border-components-panel-bg bg-components-avatar-default-avatar-bg',
        className,
      )}
    >
      {avatar && <AvatarImage src={avatar} alt={name} />}
      <AvatarFallback className="relative overflow-hidden rounded-full border-[0.5px] border-divider-regular bg-linear-to-br from-components-avatar-bg-mask-stop-0/50 to-components-avatar-bg-mask-stop-100/50 backdrop-blur-xs">
        <img
          alt=""
          src={defaultAvatarPeople}
          className="absolute top-[21.43%] left-1/8 h-[121.43%] w-3/4 max-w-none"
        />
      </AvatarFallback>
    </AvatarRoot>
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
  const avatarUrl = uploadedAvatar?.url ?? contact?.avatar_url ?? null

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
      <DialogContent className="w-104 max-w-[calc(100vw-2rem)] border-0 p-0 ring-[0.5px] ring-components-panel-border">
        <DialogClose
          render={
            <IconButton
              aria-label={t(($) => $['action.close'])}
              className="absolute top-5 right-5"
              disabled={busy}
              size="lg"
            >
              <span aria-hidden className="i-ri-close-line size-4.5" />
            </IconButton>
          }
        />
        <div className="h-14.5 pt-6 pr-14 pb-3 pl-6">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $[contact ? 'external.editTitle' : 'external.title'])}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t(($) => $[contact ? 'external.editDescription' : 'external.description'])}
          </DialogDescription>
        </div>
        <Form<ExternalContactDraft> onFormSubmit={handleSubmit}>
          <div className="relative flex flex-col items-center gap-2 px-4 pt-10 pb-2">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-6 top-1 h-25 overflow-hidden rounded-lg"
            >
              <ContactAvatar
                avatar={avatarUrl}
                name=""
                className="absolute -top-33 left-0 size-108 opacity-20 blur-[80px]"
              />
              <img alt="" src={avatarInnerRing} className="absolute top-5.5 left-38.5 size-31" />
              <img alt="" src={avatarOuterRing} className="absolute top-1.5 left-34.5 size-39" />
            </div>
            <button
              type="button"
              aria-label={t(($) => $['avatar.editAction'], { ns: 'common' })}
              aria-describedby={avatarError ? 'external-avatar-error' : undefined}
              className="relative size-24 rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-components-input-border-hover disabled:cursor-wait"
              disabled={busy}
              onClick={() => avatarInputRef.current?.click()}
            >
              <ContactAvatar avatar={avatarUrl} name={draft.displayName} />
              <span className="absolute right-0 bottom-0 flex size-8 items-center justify-center rounded-full border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg text-components-button-secondary-text shadow-xs backdrop-blur-[5px]">
                <span
                  aria-hidden
                  className={
                    uploadAvatar.isPending
                      ? 'i-ri-loader-4-line size-4 animate-spin'
                      : 'i-ri-edit-line size-4'
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
          <div className="space-y-4 px-6 py-3">
            <Field name="displayName" invalid={fieldError === 'name_required'}>
              <FieldLabel>{t(($) => $['external.name'])}</FieldLabel>
              <Input
                aria-describedby={
                  fieldError === 'name_required' ? 'external-name-error' : undefined
                }
                autoComplete="name"
                placeholder={t(($) => $['external.namePlaceholder'])}
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
                placeholder={t(($) => $['external.email'])}
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
              className="mx-6 mt-4 rounded-lg bg-state-destructive-hover p-3 system-sm-regular text-text-destructive"
            >
              {resultErrorMessage}
            </div>
          )}
          <div className="flex justify-end gap-2 px-6 pt-5 pb-6">
            <Button className="min-w-18" disabled={busy} onClick={closeDialog}>
              {t(($) => $['action.cancel'])}
            </Button>
            <Button
              type="submit"
              className="min-w-18"
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

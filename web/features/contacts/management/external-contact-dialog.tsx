'use client'

import type { ExternalContactCreateRequest } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ContactView } from './types'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
import { ALLOW_FILE_EXTENSIONS } from '@/types/app'
import AvatarInnerRing from './assets/avatar-inner-ring.svg'
import AvatarOuterRing from './assets/avatar-outer-ring.svg'
import { ContactAvatar } from './contact-avatar'

type ExternalContactDialogProps = {
  onCreated: (contactId: string) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  contact?: Pick<ContactView, 'avatar_url' | 'email' | 'id' | 'name'>
}

const maxContactNameLength = 255

function isValidEmail(value: string) {
  const input = document.createElement('input')
  input.type = 'email'
  input.value = value
  const parts = value.split('@')
  if (parts.length !== 2) return false
  const [local, domain] = parts
  return Boolean(
    input.validity.valid &&
    local &&
    local.split('.').every((part) => part.length > 0) &&
    domain &&
    !/\s/.test(value) &&
    domain.includes('.') &&
    !domain.startsWith('.') &&
    !domain.endsWith('.'),
  )
}

function ExternalContactForm({
  contact,
  onCreated,
  onOpenChange,
  onBusyChange,
}: Omit<ExternalContactDialogProps, 'open'> & { onBusyChange: (busy: boolean) => void }) {
  const { t } = useTranslation(['contacts', 'common'])
  const create = useMutation(
    consoleQuery.workspaces.current.humanInput.v2.contacts.external.post.mutationOptions({
      context: { silent: true },
    }),
  )
  const update = useMutation(
    consoleQuery.workspaces.current.humanInput.v2.contacts.external.byContactId.patch.mutationOptions(
      { context: { silent: true } },
    ),
  )
  const uploadAvatar = useMutation(
    consoleQuery.files.upload.post.mutationOptions({ context: { silent: true } }),
  )
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [uploadedAvatar, setUploadedAvatar] = useState<{ id: string; url: string }>()
  const [avatarError, setAvatarError] = useState<string | null>(null)
  const [name, setName] = useState(contact?.name ?? '')
  const [emailError, setEmailError] = useState<string>()
  const avatarErrorId = useId()
  const pending = create.isPending || update.isPending
  const busy = pending || uploadAvatar.isPending
  const error = create.error ?? update.error
  const avatarUrl = uploadedAvatar?.url ?? contact?.avatar_url

  useEffect(() => {
    onBusyChange(busy)
  }, [busy, onBusyChange])
  useEffect(
    () => () => {
      if (uploadedAvatar) URL.revokeObjectURL(uploadedAvatar.url)
    },
    [uploadedAvatar],
  )

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

  function handleSubmit(values: ExternalContactCreateRequest) {
    if (busy || avatarError) return
    const body = {
      name: values.name.trim(),
      email: values.email.trim(),
      ...(uploadedAvatar ? { avatar: uploadedAvatar.id } : {}),
    }
    const callbacks = {
      onSuccess: ({ contact }: { contact: ContactView }) => {
        onOpenChange(false)
        onCreated(contact.id)
      },
      onError: (error: Error) => {
        if ('status' in error && error.status === 409)
          setEmailError(t(($) => $['external.result.duplicate_external_contact']))
      },
    }
    if (contact) update.mutate({ params: { contact_id: contact.id }, body }, callbacks)
    else create.mutate({ body }, callbacks)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t(($) => $[contact ? 'external.editTitle' : 'external.title'])}</DialogTitle>
        <DialogDescription className="sr-only">
          {t(($) => $[contact ? 'external.editDescription' : 'external.description'])}
        </DialogDescription>
        <DialogHeaderCloseButton aria-label={t(($) => $['action.close'])} disabled={busy} />
      </DialogHeader>
      <Form<ExternalContactCreateRequest>
        errors={emailError ? { email: emailError } : undefined}
        onFormSubmit={handleSubmit}
      >
        <div className="relative flex flex-col items-center gap-2 px-4 pt-10 pb-2">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-6 top-1 h-25 overflow-hidden rounded-lg"
          >
            <ContactAvatar
              avatar={avatarUrl}
              name={name.trim()}
              className="absolute inset-s-0 -top-33 size-108 bg-components-avatar-default-avatar-bg opacity-20 blur-[80px]"
            />
            <img
              alt=""
              src={AvatarInnerRing.src}
              className="absolute inset-s-38.5 top-5.5 size-31"
            />
            <img
              alt=""
              src={AvatarOuterRing.src}
              className="absolute inset-s-34.5 top-1.5 size-39"
            />
          </div>
          <button
            type="button"
            aria-label={t(($) => $['avatar.editAction'], { ns: 'common' })}
            aria-describedby={avatarError ? avatarErrorId : undefined}
            className="relative size-24 rounded-full outline-hidden focus-visible:ring-2 focus-visible:ring-components-input-border-hover disabled:cursor-wait"
            disabled={busy}
            onClick={() => avatarInputRef.current?.click()}
          >
            <ContactAvatar
              avatar={avatarUrl}
              name={name.trim()}
              className="size-24 border-2 border-components-panel-bg bg-text-accent text-5xl font-semibold"
            />
            <span className="absolute inset-e-0 bottom-0 flex size-8 items-center justify-center rounded-full border border-components-button-secondary-border bg-components-button-secondary-bg text-components-button-secondary-text shadow-xs backdrop-blur-[5px]">
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
          {avatarError && (
            <p id={avatarErrorId} role="alert" className="system-xs-regular text-text-destructive">
              {avatarError}
            </p>
          )}
          {(uploadedAvatar || avatarError) && (
            <Button
              size="small"
              disabled={busy}
              onClick={() => {
                setUploadedAvatar(undefined)
                setAvatarError(null)
                uploadAvatar.reset()
              }}
            >
              {t(($) => $['operation.reset'], { ns: 'common' })}
            </Button>
          )}
        </div>
        <div className="space-y-4 px-6 py-3">
          <Field
            name="name"
            validate={(value) =>
              typeof value !== 'string' || !value.trim()
                ? t(($) => $['external.validation.name_required'])
                : [...value.trim()].length > maxContactNameLength
                  ? t(($) => $['external.validation.name_too_long'], {
                      maxLength: maxContactNameLength,
                    })
                  : null
            }
          >
            <FieldLabel>{t(($) => $['external.name'])}</FieldLabel>
            <Input
              autoComplete="name"
              placeholder={t(($) => $['external.namePlaceholder'])}
              disabled={busy}
              value={name}
              onValueChange={setName}
            />
            <FieldError />
          </Field>
          <Field
            name="email"
            validate={(value) =>
              typeof value !== 'string' || !value.trim()
                ? t(($) => $['external.validation.email_required'])
                : !isValidEmail(value.trim())
                  ? t(($) => $['external.validation.email_invalid'])
                  : null
            }
          >
            <FieldLabel>{t(($) => $['external.email'])}</FieldLabel>
            <Input
              autoComplete="email"
              inputMode="email"
              placeholder={t(($) => $['external.email'])}
              disabled={busy}
              defaultValue={contact?.email ?? ''}
              onValueChange={() => {
                setEmailError(undefined)
                create.reset()
                update.reset()
              }}
            />
            <FieldError />
          </Field>
        </div>
        {error && !emailError && (
          <p
            role="alert"
            className="mx-6 mt-4 rounded-lg bg-state-destructive-hover p-3 system-sm-regular text-text-destructive"
          >
            {contact
              ? t(($) => $['actionMsg.modifiedUnsuccessfully'], { ns: 'common' })
              : t(($) => $['external.result.failed'])}
          </p>
        )}
        <div className="flex justify-end gap-2 px-6 pt-5 pb-6">
          <Button className="min-w-18" disabled={busy} onClick={() => onOpenChange(false)}>
            {t(($) => $['action.cancel'])}
          </Button>
          <Button
            type="submit"
            className="min-w-18"
            variant="primary"
            loading={pending}
            disabled={uploadAvatar.isPending || Boolean(avatarError)}
          >
            {t(($) => $[contact ? 'external.save' : 'external.add'])}
          </Button>
        </div>
      </Form>
    </>
  )
}

export function ExternalContactDialog({
  open,
  onOpenChange,
  ...props
}: ExternalContactDialogProps) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange(nextOpen)
      }}
      disablePointerDismissal={busy}
    >
      <DialogContent className="w-104">
        <ExternalContactForm
          key={props.contact?.id ?? 'create'}
          {...props}
          onOpenChange={onOpenChange}
          onBusyChange={setBusy}
        />
      </DialogContent>
    </Dialog>
  )
}

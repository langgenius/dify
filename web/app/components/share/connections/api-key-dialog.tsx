'use client'

import type { EndUserConnectionCreatePayload } from '@dify/contracts/api/web/types.gen'
import type { DialogContentProps } from '@langgenius/dify-ui/dialog'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { ORPCError } from '@orpc/client'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/app/notifications'
import { isAbortError } from '@/service/client-error'

export type ApiKeyValues = {
  name: string
  credentials: EndUserConnectionCreatePayload['credentials']
}

type ApiKeyFormProps = {
  mode: 'add' | 'replace'
  connectionName?: string
  readmeUrl?: string
  onSave: (values: ApiKeyValues) => void | Promise<void>
  onClose: () => void
  onSavingChange?: (saving: boolean) => void
  disabled?: boolean
}

type Props = Omit<ApiKeyFormProps, 'onClose' | 'onSavingChange'> & {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseComplete?: () => void
  finalFocus?: DialogContentProps['finalFocus']
}

export function ApiKeyForm({
  mode,
  connectionName = '',
  readmeUrl,
  onSave,
  onClose,
  onSavingChange,
  disabled = false,
}: ApiKeyFormProps) {
  const { t } = useTranslation(['share', 'plugin', 'common'])
  const [saving, setSaving] = useState(false)
  const [credentialsInvalid, setCredentialsInvalid] = useState(false)
  const [name, setName] = useState(connectionName)
  const [apiKey, setApiKey] = useState('')
  const savingRef = useRef(false)
  const formId = useId()
  const nameLabel = t(($) => $['auth.authorizationName'], { ns: 'plugin' })
  const apiKeyLabel = t(($) => $['connections.setup.apiKey'], { ns: 'share' })
  const requiredMessage = (field: string) =>
    t(($) => $['errorMsg.fieldRequired'], { ns: 'common', field })

  const save = async (values: { name: string; api_key: string }) => {
    if (
      disabled ||
      savingRef.current ||
      credentialsInvalid ||
      !values.name.trim() ||
      !values.api_key.trim()
    )
      return
    savingRef.current = true
    setSaving(true)
    onSavingChange?.(true)
    setCredentialsInvalid(false)
    let saved = false
    try {
      await onSave({ name: values.name.trim(), credentials: { api_key: values.api_key } })
      saved = true
    } catch (error) {
      if (isAbortError(error)) return
      if (error instanceof ORPCError && error.code === 'connection_credentials_invalid')
        setCredentialsInvalid(true)
      else toast.error(t(($) => $['api.actionFailed'], { ns: 'common' }))
    } finally {
      savingRef.current = false
      setSaving(false)
      onSavingChange?.(false)
    }
    if (saved) onClose()
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {mode === 'add'
            ? t(($) => $['connections.setup.addApiKey'], { ns: 'share' })
            : t(($) => $['connections.apiKeys.replaceTitle'], { ns: 'share' })}
        </DialogTitle>
        <DialogHeaderCloseButton
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          disabled={saving}
        />
      </DialogHeader>
      <DialogBody className="space-y-5">
        {readmeUrl && (
          <a
            href={readmeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-sm system-md-regular text-text-tertiary hover:text-text-accent focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
          >
            <span aria-hidden="true" className="i-ri-book-open-line size-4 shrink-0" />
            {t(($) => $['readmeInfo.needHelpCheckReadme'], { ns: 'plugin' })}
          </a>
        )}
        <Form<{ name: string; api_key: string }>
          id={formId}
          className="flex flex-col gap-5"
          validationMode="onBlur"
          errors={
            credentialsInvalid
              ? { api_key: t(($) => $['connections.apiKeys.validationError'], { ns: 'share' }) }
              : undefined
          }
          onFormSubmit={(values) => void save(values)}
        >
          <Field
            name="name"
            disabled={disabled || saving}
            validate={(value) =>
              typeof value === 'string' && value.trim() ? undefined : requiredMessage(nameLabel)
            }
          >
            <FieldLabel>
              {nameLabel}
              <span aria-hidden="true" className="ms-1 text-text-destructive">
                *
              </span>
            </FieldLabel>
            <Input required value={name} autoComplete="off" onValueChange={setName} />
            <FieldError role="alert" />
          </Field>
          <Field
            name="api_key"
            disabled={disabled || saving}
            validate={(value) =>
              typeof value === 'string' && value.trim() ? undefined : requiredMessage(apiKeyLabel)
            }
          >
            <FieldLabel>
              {apiKeyLabel}
              <span aria-hidden="true" className="ms-1 text-text-destructive">
                *
              </span>
            </FieldLabel>
            <Input
              required
              type="password"
              autoComplete="new-password"
              placeholder={t(($) => $['connections.apiKeys.newKeyPlaceholder'], { ns: 'share' })}
              value={apiKey}
              onValueChange={(value) => {
                setApiKey(value)
                setCredentialsInvalid(false)
              }}
            />
            <FieldError role="alert" />
          </Field>
        </Form>
      </DialogBody>
      <DialogFooter>
        <Button disabled={saving} onClick={onClose}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </Button>
        <Button
          type="submit"
          form={formId}
          variant="primary"
          disabled={disabled || credentialsInvalid || !name.trim() || !apiKey.trim()}
          loading={saving}
        >
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </DialogFooter>
    </>
  )
}

export default function ApiKeyDialog({
  mode,
  connectionName,
  readmeUrl,
  open,
  onOpenChange,
  onCloseComplete,
  onSave,
  finalFocus,
  disabled,
}: Props) {
  const savingRef = useRef(false)
  const contentRef = useRef<HTMLDivElement>(null)

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!savingRef.current) onOpenChange(nextOpen)
      }}
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) onCloseComplete?.()
      }}
    >
      <DialogContent
        ref={contentRef}
        initialFocus={() => contentRef.current?.querySelector<HTMLInputElement>('input') ?? false}
        className="w-140"
        finalFocus={finalFocus}
        backdropProps={{ forceRender: true }}
      >
        <ApiKeyForm
          mode={mode}
          connectionName={connectionName}
          readmeUrl={readmeUrl}
          onSave={onSave}
          onClose={() => onOpenChange(false)}
          onSavingChange={(saving) => {
            savingRef.current = saving
          }}
          disabled={disabled}
        />
      </DialogContent>
    </Dialog>
  )
}

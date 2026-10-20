'use client'

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
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type ApiKeyValues = {
  name: string
  apiKey: string
}

type Props = {
  mode: 'add' | 'replace'
  connectionName?: string
  readmeUrl?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onCloseComplete?: () => void
  onSave: (values: ApiKeyValues) => void | Promise<void>
  finalFocus?: DialogContentProps['finalFocus']
  disabled?: boolean
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
  const [name, setName] = useState(connectionName)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const savingRef = useRef(false)
  const focusName = useCallback((input: HTMLInputElement | null) => {
    input?.focus({ preventScroll: true })
  }, [])
  const nameLabel = t(($) => $['auth.authorizationName'], { ns: 'plugin' })
  const apiKeyLabel = t(($) => $['connections.setup.apiKey'], { ns: 'share' })
  const invalidKeyMessage = t(($) => $['connections.apiKeys.validationError'], { ns: 'share' })
  const trimmedApiKey = apiKey.trim()
  // Temporary demo validation until API key verification is available from the API.
  const validApiKey = trimmedApiKey.startsWith('sk')
  const invalidApiKey = trimmedApiKey.length > 0 && !validApiKey
  const requiredMessage = (field: string) =>
    t(($) => $['errorMsg.fieldRequired'], { ns: 'common', field })

  const save = async () => {
    if (disabled || savingRef.current || !name.trim() || !validApiKey) return
    savingRef.current = true
    setSaving(true)
    onSavingChange?.(true)
    setFailed(false)
    let saved = false
    try {
      await onSave({ name: name.trim(), apiKey: trimmedApiKey })
      saved = true
    } catch {
      setFailed(true)
    } finally {
      savingRef.current = false
      setSaving(false)
      onSavingChange?.(false)
    }
    if (saved) onClose()
  }

  return (
    <Form className="contents" onFormSubmit={() => void save()}>
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
        <Field
          name="name"
          className="gap-2"
          validate={(value) =>
            typeof value === 'string' && value.trim() ? null : requiredMessage(nameLabel)
          }
        >
          <FieldLabel>{nameLabel}</FieldLabel>
          <Input
            ref={focusName}
            value={name}
            onValueChange={setName}
            autoComplete="off"
            disabled={disabled || saving}
            required
          />
          <FieldError>{requiredMessage(nameLabel)}</FieldError>
        </Field>
        <Field
          name="apiKey"
          className="gap-2"
          validationMode="onChange"
          validate={(value) => {
            const key = typeof value === 'string' ? value.trim() : ''
            if (!key) return requiredMessage(apiKeyLabel)
            return key.startsWith('sk') ? null : invalidKeyMessage
          }}
        >
          <FieldLabel>
            {apiKeyLabel}
            <span aria-hidden="true" className="ml-1 text-text-destructive-secondary">
              *
            </span>
          </FieldLabel>
          <InputGroup>
            <InputGroupInput
              type="password"
              value={apiKey}
              onValueChange={setApiKey}
              placeholder={t(($) => $['connections.apiKeys.newKeyPlaceholder'], { ns: 'share' })}
              autoComplete="new-password"
              spellCheck={false}
              autoCapitalize="none"
              disabled={disabled || saving}
              required
            />
            {invalidApiKey && (
              <InputGroupAddon align="inline-end">
                <span
                  aria-hidden="true"
                  className="i-ri-error-warning-line size-4 text-text-destructive"
                />
              </InputGroupAddon>
            )}
          </InputGroup>
          <FieldError className={invalidApiKey ? 'text-text-warning' : undefined} />
        </Field>
        {failed && (
          <p role="alert" className="system-sm-regular text-text-destructive">
            {t(($) => $['api.actionFailed'], { ns: 'common' })}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button disabled={saving} onClick={onClose}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={disabled || !name.trim() || !validApiKey}
          loading={saving}
        >
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </DialogFooter>
    </Form>
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

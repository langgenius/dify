'use client'

import type {
  EndUserConnectionCreatePayload,
  ProviderConfig,
} from '@dify/contracts/api/web/types.gen'
import { Button } from '@langgenius/dify-ui/button'
import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldLabel } from '@langgenius/dify-ui/field'
import { Input } from '@langgenius/dify-ui/input'
import { ORPCError } from '@orpc/client'
import { useForm, useSelector } from '@tanstack/react-form'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AuthForm from '@/app/components/base/form/form-scenarios/auth'
import { toast } from '@/app/notifications'
import { useRenderI18nObject } from '@/hooks/use-i18n'
import { isAbortError } from '@/service/client-error'
import { selectCredentialFormSchema } from '@/service/console/plugin-auth-select'

export type ApiKeyValues = {
  name: string
  credentials: EndUserConnectionCreatePayload['credentials']
}

export type ApiKeyFormProps = {
  mode: 'add' | 'replace'
  schemas: ProviderConfig[]
  connectionName?: string
  readmeUrl?: string
  onSave: (values: ApiKeyValues) => void | Promise<void>
  onClose: () => void
  onSavingChange?: (saving: boolean) => void
  disabled?: boolean
}

const hasRequiredValue = (value: unknown) =>
  value !== undefined &&
  value !== null &&
  (typeof value !== 'string' || !!value.trim()) &&
  (!Array.isArray(value) || value.length > 0)

export function ApiKeyForm({
  mode,
  schemas,
  connectionName = '',
  readmeUrl,
  onSave,
  onClose,
  onSavingChange,
  disabled = false,
}: ApiKeyFormProps) {
  const { t } = useTranslation(['share', 'plugin', 'common'])
  const renderI18nObject = useRenderI18nObject()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState(connectionName)
  const [rejectedCredentials, setRejectedCredentials] = useState<Record<string, unknown> | null>(
    null,
  )
  const savingRef = useRef(false)
  const formId = useId()
  const nameLabel = t(($) => $['auth.authorizationName'], { ns: 'plugin' })
  const requiredMessage = (field: string) =>
    t(($) => $['errorMsg.fieldRequired'], { ns: 'common', field })
  const formSchemas = schemas.map((schema) => {
    const field = selectCredentialFormSchema(schema)
    if (!field.required) return field

    const validate = ({ value }: { value: unknown }) =>
      hasRequiredValue(value)
        ? undefined
        : requiredMessage(schema.label ? renderI18nObject(schema.label) : schema.name)
    return {
      ...field,
      validators: { onMount: validate, onChange: validate },
    }
  })
  const [defaultValues] = useState(() => {
    const values: ApiKeyValues['credentials'] = {}
    for (const schema of schemas) {
      if (schema.default != null) values[schema.name] = schema.default
    }
    return values
  })
  const form = useForm({ defaultValues })
  const credentials = useSelector(form.store, (state) => state.values)
  const credentialsInvalid = rejectedCredentials === credentials
  const complete = schemas.every(
    (schema) => !schema.required || hasRequiredValue(credentials[schema.name]),
  )

  const save = async () => {
    if (disabled || savingRef.current || credentialsInvalid || !complete) return
    savingRef.current = true
    setSaving(true)
    onSavingChange?.(true)
    setRejectedCredentials(null)
    let saved = false
    try {
      await onSave({ name: name.trim(), credentials })
      saved = true
    } catch (error) {
      if (isAbortError(error)) return
      if (error instanceof ORPCError && error.code === 'connection_credentials_invalid')
        setRejectedCredentials(credentials)
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
        <Field name="name" disabled={disabled || saving}>
          <FieldLabel>{nameLabel}</FieldLabel>
          <Input form={formId} value={name} autoComplete="off" onValueChange={setName} />
        </Field>
        {schemas.length ? (
          <AuthForm
            id={formId}
            formSchemas={formSchemas}
            formFromProps={form}
            disabled={disabled || saving}
            preventDefaultSubmit
            onSubmit={() => void save()}
          />
        ) : (
          <form
            id={formId}
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          />
        )}
        {credentialsInvalid && (
          <p role="alert" className="system-sm-regular text-text-destructive">
            {t(($) => $['connections.apiKeys.validationError'], { ns: 'share' })}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button disabled={saving} onClick={onClose}>
          {t(($) => $['operation.cancel'], { ns: 'common' })}
        </Button>
        <Button
          type="submit"
          form={formId}
          variant="primary"
          disabled={disabled || credentialsInvalid || !complete}
          loading={saving}
        >
          {t(($) => $['operation.save'], { ns: 'common' })}
        </Button>
      </DialogFooter>
    </>
  )
}

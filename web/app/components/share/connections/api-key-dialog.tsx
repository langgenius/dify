'use client'

import type { EndUserConnectionCreatePayload } from '@dify/contracts/api/web/types.gen'
import type { DialogContentProps } from '@langgenius/dify-ui/dialog'
import type { FormRefObject, FormSchema } from '@/app/components/base/form/types'
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
import { ORPCError } from '@orpc/client'
import { useForm, useSelector } from '@tanstack/react-form'
import { useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import AuthForm from '@/app/components/base/form/form-scenarios/auth'
import { FormTypeEnum } from '@/app/components/base/form/types'
import { toast } from '@/app/notifications'
import { isAbortError } from '@/service/client-error'

export type ApiKeyValues = {
  name: string
  credentials: EndUserConnectionCreatePayload['credentials']
}

type ApiKeyFormProps = {
  mode: 'add' | 'replace'
  connectionName?: string
  credentialSchemas?: FormSchema[]
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

const NAME_FIELD = '__connection_name__'

export function ApiKeyForm({
  mode,
  connectionName = '',
  credentialSchemas,
  readmeUrl,
  onSave,
  onClose,
  onSavingChange,
  disabled = false,
}: ApiKeyFormProps) {
  const { t } = useTranslation(['share', 'plugin', 'common'])
  const [saving, setSaving] = useState(false)
  const [credentialsInvalid, setCredentialsInvalid] = useState(false)
  const savingRef = useRef(false)
  const formRef = useRef<FormRefObject>(null)
  const formId = useId()
  const formSchemas = useMemo<FormSchema[]>(() => {
    const requiredName = ({ value }: { value: unknown }) =>
      typeof value === 'string' && value.trim()
        ? undefined
        : t(($) => $['errorMsg.fieldRequired'], {
            ns: 'common',
            field: t(($) => $['auth.authorizationName'], { ns: 'plugin' }),
          })
    return [
      {
        name: NAME_FIELD,
        type: FormTypeEnum.textInput,
        label: t(($) => $['auth.authorizationName'], { ns: 'plugin' }),
        required: true,
        default: connectionName,
        validators: { onMount: requiredName, onChange: requiredName, onBlur: requiredName },
      },
      ...(credentialSchemas ?? []),
    ]
  }, [connectionName, credentialSchemas, t])
  const defaultValues = useMemo<Record<string, unknown>>(
    () => Object.fromEntries(formSchemas.map((schema) => [schema.name, schema.default])),
    [formSchemas],
  )
  const form = useForm({ defaultValues })
  const invalid = useSelector(form.store, (state) =>
    formSchemas.some((schema) => {
      const visible =
        schema.show_on?.every(
          (condition) => state.values[condition.variable] === condition.value,
        ) ?? true
      return visible && !!state.fieldMeta[schema.name]?.errors.length
    }),
  )
  const hasName = useSelector(form.store, (state) => {
    const name = state.values[NAME_FIELD]
    return typeof name === 'string' && !!name.trim()
  })

  const save = async () => {
    if (disabled || savingRef.current || !credentialSchemas?.length) return
    const result = formRef.current?.getFormValues({ needCheckValidatedValues: true })
    if (!result?.isCheckValidated) return
    const values: Record<string, unknown> = result.values
    const name = values[NAME_FIELD]
    if (typeof name !== 'string' || !name.trim()) return
    const credentials = Object.fromEntries(
      credentialSchemas.map((schema) => [schema.name, values[schema.name]]),
    )
    savingRef.current = true
    setSaving(true)
    onSavingChange?.(true)
    setCredentialsInvalid(false)
    let saved = false
    try {
      await onSave({ name: name.trim(), credentials })
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
        <AuthForm
          id={formId}
          ref={formRef}
          formFromProps={form}
          formSchemas={formSchemas}
          disabled={disabled || saving}
          preventDefaultSubmit
          onSubmit={() => void save()}
          onChange={() => setCredentialsInvalid(false)}
        />
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
          disabled={disabled || !credentialSchemas?.length || !hasName || invalid}
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
  credentialSchemas,
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
          credentialSchemas={credentialSchemas}
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

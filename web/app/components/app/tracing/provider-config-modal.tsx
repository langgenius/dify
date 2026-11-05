'use client'
import type {
  TraceAppConfigResponse,
  TraceConfigPayload,
} from '@dify/contracts/api/console/apps/types.gen'
import type { RefObject } from 'react'
import type { ConfigurableTracingProvider, TracingProviderField } from './providers'
import type { TracingResource } from './resource'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import {
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { Separator } from '@langgenius/dify-ui/separator'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { EncryptedBottom } from '@/app/components/base/encrypted-bottom'
import { consoleQuery } from '@/service/console'
import { tracingProviders } from './providers'

type ProviderConfigModalProps = {
  resource: TracingResource
  type: ConfigurableTracingProvider
  /** The saved configuration; absent while the provider is not configured yet. */
  config: TraceAppConfigResponse | null | undefined
  /** Whether traces currently go to this provider, so removing it turns tracing off. */
  inUse: boolean
  onRemoved: () => void
  firstInputRef: RefObject<HTMLInputElement | null>
  onSaved: () => void
}

const I18N_PREFIX = 'tracing.configProvider'

/** A destination as the API compares it: trimmed, without trailing slashes. */
function comparableDestination(value: string | null) {
  return value === null ? null : value.trim().replace(/\/+$/, '')
}

export function ProviderConfigModal({
  resource,
  type,
  config,
  inUse,
  onRemoved,
  firstInputRef,
  onSaved,
}: ProviderConfigModalProps) {
  const { t } = useTranslation(['app', 'common', 'modelProvider'])
  const createAppConfig = useMutation(
    consoleQuery.apps.byAppId.traceConfig.post.mutationOptions({ context: { silent: true } }),
  )
  const createAgentConfig = useMutation(
    consoleQuery.agent.byAgentId.traceConfig.post.mutationOptions({ context: { silent: true } }),
  )
  const updateAppConfig = useMutation(
    consoleQuery.apps.byAppId.traceConfig.patch.mutationOptions({ context: { silent: true } }),
  )
  const updateAgentConfig = useMutation(
    consoleQuery.agent.byAgentId.traceConfig.patch.mutationOptions({ context: { silent: true } }),
  )
  const removeAppConfig = useMutation(
    consoleQuery.apps.byAppId.traceConfig.delete.mutationOptions({ context: { silent: true } }),
  )
  const removeAgentConfig = useMutation(
    consoleQuery.agent.byAgentId.traceConfig.delete.mutationOptions({ context: { silent: true } }),
  )
  const createConfig = resource.kind === 'agent' ? createAgentConfig : createAppConfig
  const updateConfig = resource.kind === 'agent' ? updateAgentConfig : updateAppConfig
  const removeConfig = resource.kind === 'agent' ? removeAgentConfig : removeAppConfig
  const fields: readonly TracingProviderField[] = tracingProviders[type].fields
  const savedValues = config?.tracing_config
  const configuredSecrets = config?.configured_secrets ?? []
  // Mirrors the destination inputs, which start from the values loaded when the form opened.
  const [destinationDrafts, setDestinationDrafts] = useState(() =>
    Object.fromEntries(
      fields
        .filter((field) => field.destination)
        .map((field) => [field.name, savedValues?.[field.name] ?? '']),
    ),
  )
  const submittedValue = (name: string, value: string) =>
    value === '' && savedValues?.[name] === null ? null : value
  // The API keeps saved secrets only for the destination they were entered for.
  const destinationChanged = fields.some(
    (field) =>
      field.destination &&
      comparableDestination(submittedValue(field.name, destinationDrafts[field.name] ?? '')) !==
        comparableDestination(savedValues?.[field.name] ?? null),
  )
  const isEdit = !!config
  const saveError = createConfig.error ?? updateConfig.error
  const pending = createConfig.isPending || updateConfig.isPending || removeConfig.isPending
  const handleRemove = () => {
    if (pending) return
    const query = { tracing_provider: type }
    if (resource.kind === 'agent')
      removeAgentConfig.mutate(
        { params: { agent_id: resource.agentId }, query },
        { onSuccess: onRemoved },
      )
    else
      removeAppConfig.mutate(
        { params: { app_id: resource.appId }, query },
        { onSuccess: onRemoved },
      )
  }
  const handleSave = (values: TraceConfigPayload['tracing_config']) => {
    if (pending) return
    if (isEdit) createConfig.reset()
    else updateConfig.reset()
    const tracingConfig: TraceConfigPayload['tracing_config'] = {}
    for (const field of fields) {
      const value = values[field.name] ?? ''
      if (field.secret) {
        // A secret left out keeps its saved value, so only a newly entered one is sent.
        if (value !== '') tracingConfig[field.name] = value
        continue
      }
      tracingConfig[field.name] = submittedValue(field.name, value)
    }
    const body: TraceConfigPayload = { tracing_provider: type, tracing_config: tracingConfig }
    if (!isEdit) body.activate = true
    if (resource.kind === 'agent')
      (isEdit ? updateAgentConfig : createAgentConfig).mutate(
        { params: { agent_id: resource.agentId }, body },
        { onSuccess: onSaved },
      )
    else
      (isEdit ? updateAppConfig : createAppConfig).mutate(
        { params: { app_id: resource.appId }, body },
        { onSuccess: onSaved },
      )
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t(($) => $[`${I18N_PREFIX}.title`], { ns: 'app' })}
          {t(($) => $[`tracing.${type}.title`], { ns: 'app' })}
        </DialogTitle>
        <DialogHeaderCloseButton
          aria-label={t(($) => $['operation.close'], { ns: 'common' })}
          disabled={pending}
        />
      </DialogHeader>

      <Form<TraceConfigPayload['tracing_config']>
        autoComplete="off"
        className="contents"
        onFormSubmit={handleSave}
      >
        <DialogBody>
          <div className="space-y-4">
            {fields.map((field, index) => {
              const { label, description } = field
              const labelText =
                typeof label === 'string' ? label : t(($) => $[label.key], { ns: 'app' })
              const keepsSavedSecret =
                field.secret && !destinationChanged && configuredSecrets.includes(field.name)
              const required = field.required && !keepsSavedSecret
              return (
                <Field key={field.name} disabled={pending} name={field.name}>
                  <FieldLabel>
                    {labelText}
                    {required && (
                      <span aria-hidden className="text-text-destructive">
                        *
                      </span>
                    )}
                  </FieldLabel>
                  <Input
                    ref={index === 0 ? firstInputRef : undefined}
                    autoComplete={field.secret ? 'off' : undefined}
                    type={field.type}
                    inputMode={field.inputMode}
                    pattern={field.pattern}
                    maxLength={field.maxLength}
                    required={required}
                    defaultValue={field.secret ? '' : (savedValues?.[field.name] ?? '')}
                    onValueChange={
                      field.destination
                        ? (value) =>
                            setDestinationDrafts((drafts) => ({ ...drafts, [field.name]: value }))
                        : undefined
                    }
                    placeholder={
                      keepsSavedSecret
                        ? t(($) => $[`${I18N_PREFIX}.configuredSecretPlaceholder`], { ns: 'app' })
                        : (field.placeholder ??
                          t(($) => $[`${I18N_PREFIX}.placeholder`], { ns: 'app', key: labelText }))
                    }
                  />
                  {description && (
                    <FieldDescription>{t(($) => $[description], { ns: 'app' })}</FieldDescription>
                  )}
                  <FieldError />
                </Field>
              )
            })}
          </div>
          {saveError && (
            <p role="alert" className="mt-4 system-sm-regular text-text-destructive">
              {saveError.message}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <a
            className="me-auto flex items-center space-x-1 text-xs leading-4.5 font-normal text-primary-600"
            target="_blank"
            href={tracingProviders[type].docUrl}
          >
            <span>
              {t(($) => $[`${I18N_PREFIX}.viewDocsLink`], {
                ns: 'app',
                key: t(($) => $[`tracing.${type}.title`], { ns: 'app' }),
              })}
            </span>
            <span aria-hidden className="i-custom-vender-line-general-link-external-02 size-3" />
          </a>
          {isEdit && (
            <>
              <AlertDialog
                onOpenChange={(open, details) => {
                  if (!open && removeConfig.isPending) details.cancel()
                }}
                onOpenChangeComplete={(open) => {
                  if (!open) removeConfig.reset()
                }}
              >
                <AlertDialogTrigger render={<Button tone="destructive" disabled={pending} />}>
                  {t(($) => $['operation.remove'], { ns: 'common' })}
                </AlertDialogTrigger>
                <AlertDialogContent backdropProps={{ forceRender: true }}>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t(($) => $[`${I18N_PREFIX}.removeConfirmTitle`], {
                        ns: 'app',
                        key: t(($) => $[`tracing.${type}.title`], { ns: 'app' }),
                      })}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t(
                        ($) =>
                          $[
                            `${I18N_PREFIX}.${inUse ? 'removeConfirmContentInUse' : 'removeConfirmContentNotInUse'}`
                          ],
                        { ns: 'app', key: t(($) => $[`tracing.${type}.title`], { ns: 'app' }) },
                      )}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  {removeConfig.error && (
                    <p role="alert" className="px-6 system-sm-regular text-text-destructive">
                      {removeConfig.error.message}
                    </p>
                  )}
                  <AlertDialogFooter>
                    <AlertDialogCancelButton disabled={removeConfig.isPending}>
                      {t(($) => $['operation.cancel'], { ns: 'common' })}
                    </AlertDialogCancelButton>
                    <AlertDialogConfirmButton onClick={handleRemove} loading={pending}>
                      {t(($) => $['operation.remove'], { ns: 'common' })}
                    </AlertDialogConfirmButton>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Separator orientation="vertical" className="mx-1 h-4.5" />
            </>
          )}
          <DialogClose disabled={pending} render={<Button />}>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </DialogClose>
          <Button variant="primary" type="submit" loading={pending}>
            {t(($) => $[`operation.${isEdit ? 'save' : 'saveAndEnable'}`], {
              ns: 'common',
            })}
          </Button>
        </DialogFooter>
        <EncryptedBottom
          front={t(($) => $['modelProvider.encrypted.front'], { ns: 'modelProvider' })}
          back={t(($) => $['modelProvider.encrypted.back'], { ns: 'modelProvider' })}
        />
      </Form>
    </>
  )
}

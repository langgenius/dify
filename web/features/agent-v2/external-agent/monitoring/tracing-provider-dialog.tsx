'use client'

import type { ExternalTracingConfigurationResponse } from '@dify/contracts/api/console/external-agents/types.gen'
import type {
  ConfigurableTracingProvider,
  TracingProviderField,
} from '@/app/components/app/tracing/providers'
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldValidity,
} from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { Separator } from '@langgenius/dify-ui/separator'
import { Switch } from '@langgenius/dify-ui/switch'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { tracingProviders } from '@/app/components/app/tracing/providers'
import { stringValue } from '../model'

type ProviderConfigurationDialogProps = {
  config: ExternalTracingConfigurationResponse | undefined
  inUse: boolean
  provider: ConfigurableTracingProvider
  onRemove: () => void
  onSave: (config: Record<string, string>, captureContent: boolean) => void
  pending: boolean
  error?: string
  onRefresh: () => void
}

export function ProviderConfigurationDialog({
  config,
  inUse,
  provider,
  onRemove,
  onSave,
  pending,
  error,
  onRefresh,
}: ProviderConfigurationDialogProps) {
  const { t } = useTranslation(['app', 'common', 'agentRoster'])
  const [confirmingRemoval, setConfirmingRemoval] = useState(false)
  const [captureContent, setCaptureContent] = useState(config?.capture_content ?? false)
  const fields: readonly TracingProviderField[] = tracingProviders[provider].fields
  const isEdit = !!config
  const providerTitle = t(($) => $[`tracing.${provider}.title`], { ns: 'app' })

  const handleSave = (values: Record<string, string>) => {
    onSave(values, captureContent)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {t(($) => $['tracing.configProvider.title'], { ns: 'app' })}
          {providerTitle}
        </DialogTitle>
        <DialogHeaderCloseButton aria-label={t(($) => $['operation.close'], { ns: 'common' })} />
      </DialogHeader>
      <Form<Record<string, string>>
        autoComplete="off"
        className="contents"
        onFormSubmit={handleSave}
      >
        <DialogBody>
          <div className="space-y-4">
            {fields.map((field) => {
              const { label, description } = field
              const labelText =
                typeof label === 'string' ? label : t(($) => $[label.key], { ns: 'app' })
              const keepsSavedSecret =
                field.secret && config?.configured_secrets.includes(field.name)
              const required = field.required && !keepsSavedSecret

              return (
                <Field
                  key={field.name}
                  name={field.name}
                  validate={(value) =>
                    required && (typeof value !== 'string' || !value.trim())
                      ? t(($) => $['errorMsg.fieldRequired'], {
                          ns: 'common',
                          field: labelText,
                        })
                      : null
                  }
                >
                  <FieldLabel>
                    {labelText}
                    {required && (
                      <span aria-hidden className="text-text-destructive">
                        *
                      </span>
                    )}
                  </FieldLabel>
                  <Input
                    autoComplete={field.secret ? 'off' : undefined}
                    defaultValue={field.secret ? '' : stringValue(config?.values[field.name])}
                    inputMode={field.inputMode}
                    maxLength={field.maxLength}
                    pattern={field.pattern}
                    placeholder={
                      keepsSavedSecret
                        ? t(($) => $['tracing.configProvider.configuredSecretPlaceholder'], {
                            ns: 'app',
                          })
                        : (field.placeholder ??
                          t(($) => $['tracing.configProvider.placeholder'], {
                            ns: 'app',
                            key: labelText,
                          }))
                    }
                    required={required}
                    type={field.secret ? 'password' : field.type}
                  />
                  {description && (
                    <FieldDescription>{t(($) => $[description], { ns: 'app' })}</FieldDescription>
                  )}
                  <FieldValidity>
                    {({ validity, error }) => (
                      <FieldError>
                        {validity.valueMissing
                          ? t(($) => $['errorMsg.fieldRequired'], {
                              ns: 'common',
                              field: labelText,
                            })
                          : error}
                      </FieldError>
                    )}
                  </FieldValidity>
                </Field>
              )
            })}
            <Field>
              <div className="flex items-center justify-between gap-3">
                <FieldLabel>{t(($) => $['tracing.captureContent'], { ns: 'app' })}</FieldLabel>
                <Switch
                  aria-label={t(($) => $['tracing.captureContent'], { ns: 'app' })}
                  checked={captureContent}
                  onCheckedChange={setCaptureContent}
                  disabled={pending}
                />
              </div>
              <FieldDescription>
                {t(($) => $['tracing.captureContentDescription'], { ns: 'app' })}
              </FieldDescription>
            </Field>
            {error && (
              <div role="alert" className="space-y-2 system-sm-regular text-text-destructive">
                <p>{error}</p>
                <Button size="small" disabled={pending} onClick={onRefresh}>
                  {t(($) => $['external.api.loadLatest'], { ns: 'agentRoster' })}
                </Button>
              </div>
            )}
          </div>
        </DialogBody>
        <DialogFooter>
          <a
            className="me-auto flex items-center gap-1 rounded-sm text-xs leading-4.5 font-normal text-primary-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-components-button-primary-bg"
            href={tracingProviders[provider].docUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            <span>
              {t(($) => $['tracing.configProvider.viewDocsLink'], {
                ns: 'app',
                key: providerTitle,
              })}
            </span>
            <span aria-hidden className="i-custom-vender-line-general-link-external-02 size-3" />
          </a>
          {isEdit && (
            <>
              <AlertDialog open={confirmingRemoval} onOpenChange={setConfirmingRemoval}>
                <AlertDialogTrigger render={<Button tone="destructive" disabled={pending} />}>
                  {t(($) => $['operation.remove'], { ns: 'common' })}
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t(($) => $['tracing.configProvider.removeConfirmTitle'], {
                        ns: 'app',
                        key: providerTitle,
                      })}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t(
                        ($) =>
                          $[
                            `tracing.configProvider.${inUse ? 'removeConfirmContentInUse' : 'removeConfirmContentNotInUse'}`
                          ],
                        { ns: 'app', key: providerTitle },
                      )}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancelButton>
                      {t(($) => $['operation.cancel'], { ns: 'common' })}
                    </AlertDialogCancelButton>
                    <AlertDialogConfirmButton
                      onClick={() => {
                        setConfirmingRemoval(false)
                        onRemove()
                      }}
                    >
                      {t(($) => $['operation.remove'], { ns: 'common' })}
                    </AlertDialogConfirmButton>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Separator orientation="vertical" className="mx-1 h-4.5" />
            </>
          )}
          <DialogClose render={<Button variant="secondary" />}>
            {t(($) => $['operation.cancel'], { ns: 'common' })}
          </DialogClose>
          <Button type="submit" variant="primary" loading={pending}>
            {t(($) => $[`operation.${isEdit ? 'save' : 'saveAndEnable'}`], { ns: 'common' })}
          </Button>
        </DialogFooter>
      </Form>
    </>
  )
}

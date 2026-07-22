'use client'

import type { ContactImIntegrationView, ContactImProviderDefinition } from './types'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import {
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import copy from 'copy-to-clipboard'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthorizeContactImProvider, useSaveContactImCredentials } from './hooks'
import { resolveContactImProviderFormAdapter } from './provider-form-adapters'
import { ContactImAuthMode, ContactImProviderField } from './types'

type CredentialValues = Partial<Record<Exclude<ContactImProviderField, 'secret'>, string>>

export type ContactImBindingDialogProps = {
  integration: ContactImIntegrationView | null
  open: boolean
  provider: ContactImProviderDefinition
  onOpenChange: (open: boolean) => void
}

export function ContactImBindingDialog({
  integration,
  open,
  provider,
  onOpenChange,
}: ContactImBindingDialogProps) {
  const { t } = useTranslation('contacts')
  const { t: tCommon } = useTranslation('common')
  const adapter = resolveContactImProviderFormAdapter(provider)
  const saveCredentials = useSaveContactImCredentials()
  const authorizeProvider = useAuthorizeContactImProvider()
  const [values, setValues] = useState<CredentialValues>(() => ({
    appId: integration?.configuredValues.appId,
    clientId: integration?.configuredValues.clientId,
    tenantId: integration?.configuredValues.tenantId,
  }))
  const [secret, setSecret] = useState('')
  const [copied, setCopied] = useState(false)
  const isCurrentProvider = Boolean(integration)
  const isPending = saveCredentials.isPending || authorizeProvider.isPending
  const mutationFailed = saveCredentials.isError || authorizeProvider.isError
  const title = isCurrentProvider
    ? t(($) => $['imPlatform.bindingDialog.configureTitle'], {
        provider: provider.displayName,
      })
    : t(($) => $['imPlatform.bindingDialog.connectTitle'], {
        provider: provider.displayName,
      })

  const closeDialog = () => {
    if (isPending) return
    setSecret('')
    onOpenChange(false)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) closeDialog()
  }

  const handleCopyCallback = () => {
    if (!provider.callbackUrl) return
    copy(provider.callbackUrl)
    setCopied(true)
  }

  const handleAuthorize = async () => {
    if (authorizeProvider.isPending) return

    try {
      await authorizeProvider.mutateAsync({
        provider: provider.provider,
      })
      onOpenChange(false)
    } catch {
      // The mutation exposes only its typed safe error state below.
    }
  }

  const handleSave = async () => {
    if (saveCredentials.isPending) return

    try {
      await saveCredentials.saveCredentials({
        provider: provider.provider,
        retainSecret: Boolean(isCurrentProvider && integration?.secretConfigured && !secret.trim()),
        secret: secret.trim() || undefined,
        values: {
          ...(values.appId?.trim() ? { appId: values.appId.trim() } : {}),
          ...(values.clientId?.trim() ? { clientId: values.clientId.trim() } : {}),
          ...(values.tenantId?.trim() ? { tenantId: values.tenantId.trim() } : {}),
        },
      })
      setSecret('')
      onOpenChange(false)
    } catch {
      setSecret('')
    }
  }

  const getFieldLabel = (field: Exclude<ContactImProviderField, 'secret'>) => {
    switch (field) {
      case ContactImProviderField.AppId:
        return t(($) => $['imPlatform.bindingDialog.field.appId'])
      case ContactImProviderField.ClientId:
        return t(($) => $['imPlatform.bindingDialog.field.clientId'])
      case ContactImProviderField.TenantId:
        return t(($) => $['imPlatform.bindingDialog.field.tenantId'])
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal={isPending}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[520px] flex-col overflow-hidden! p-0!">
        <DialogCloseButton aria-label={tCommon(($) => $['operation.close'])} disabled={isPending} />
        <div className="shrink-0 px-6 pt-6 pb-3">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">{title}</DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {t(($) => $['imPlatform.bindingDialog.description'])}
          </DialogDescription>
        </div>

        {provider.callbackUrl && (
          <div className="mx-6 mb-3 rounded-xl border border-divider-subtle bg-background-default-subtle p-3">
            <div className="system-xs-medium text-text-secondary">
              {t(($) => $['imPlatform.bindingDialog.callback'])}
            </div>
            <div className="mt-1 system-xs-regular text-text-tertiary">
              {t(($) => $['imPlatform.bindingDialog.callbackDescription'])}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-background-default px-2 py-1 text-xs text-text-secondary">
                {provider.callbackUrl}
              </code>
              <Button
                aria-label={t(($) => $['imPlatform.action.copyCallback'])}
                className="px-2"
                onClick={handleCopyCallback}
              >
                <span
                  aria-hidden="true"
                  className={copied ? 'i-ri-check-line size-4' : 'i-ri-file-copy-line size-4'}
                />
                <span className="sr-only">
                  {copied
                    ? t(($) => $['imPlatform.action.copied'])
                    : t(($) => $['imPlatform.action.copyCallback'])}
                </span>
              </Button>
            </div>
          </div>
        )}

        {adapter.authMode === ContactImAuthMode.OAuth ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {mutationFailed && (
              <div
                role="alert"
                className="mx-6 rounded-lg bg-state-destructive-hover p-3 system-sm-regular text-text-destructive"
              >
                {t(($) => $['imPlatform.bindingDialog.authorizationFailed'])}
              </div>
            )}
            <div className="mt-auto flex justify-end gap-2 px-6 pt-5 pb-6">
              <Button disabled={isPending} onClick={closeDialog}>
                {tCommon(($) => $['operation.cancel'])}
              </Button>
              <Button
                variant="primary"
                loading={authorizeProvider.isPending}
                onClick={handleAuthorize}
              >
                {authorizeProvider.isPending
                  ? t(($) => $['imPlatform.action.authorizing'])
                  : t(($) => $['imPlatform.action.authorize'])}
              </Button>
            </div>
          </div>
        ) : (
          <Form<CredentialValues>
            className="flex min-h-0 flex-1 flex-col"
            onFormSubmit={handleSave}
          >
            <div className="space-y-4 overflow-y-auto px-6 py-2">
              {adapter.fields.map((field) => {
                const fieldLabel = getFieldLabel(field)
                return (
                  <Field key={field} name={field}>
                    <FieldLabel>{fieldLabel}</FieldLabel>
                    <FieldControl
                      autoComplete="off"
                      placeholder={
                        isCurrentProvider
                          ? (integration?.displayIdentifier ?? undefined)
                          : undefined
                      }
                      required={!isCurrentProvider}
                      value={values[field] ?? ''}
                      onValueChange={(value) => {
                        setValues((currentValues) => ({ ...currentValues, [field]: value }))
                      }}
                    />
                    <FieldError match="valueMissing">
                      {t(($) => $['imPlatform.bindingDialog.required'])}
                    </FieldError>
                  </Field>
                )
              })}
              <Field name={ContactImProviderField.Secret}>
                <FieldLabel>{t(($) => $['imPlatform.bindingDialog.field.secret'])}</FieldLabel>
                <FieldControl
                  autoComplete="new-password"
                  placeholder={t(($) => $['imPlatform.bindingDialog.secretPlaceholder'])}
                  required={!isCurrentProvider || !integration?.secretConfigured}
                  type="password"
                  value={secret}
                  onValueChange={setSecret}
                />
                {isCurrentProvider && integration?.secretConfigured && (
                  <FieldDescription>
                    {t(($) => $['imPlatform.bindingDialog.secretConfigured'])}
                  </FieldDescription>
                )}
                <FieldError match="valueMissing">
                  {t(($) => $['imPlatform.bindingDialog.required'])}
                </FieldError>
              </Field>
              {mutationFailed && (
                <div
                  role="alert"
                  className="rounded-lg bg-state-destructive-hover p-3 system-sm-regular text-text-destructive"
                >
                  {t(($) => $['imPlatform.bindingDialog.saveFailed'])}
                </div>
              )}
            </div>
            <div className="mt-auto flex shrink-0 justify-end gap-2 px-6 pt-5 pb-6">
              <Button disabled={isPending} onClick={closeDialog}>
                {tCommon(($) => $['operation.cancel'])}
              </Button>
              <Button type="submit" variant="primary" loading={saveCredentials.isPending}>
                {saveCredentials.isPending
                  ? t(($) => $['imPlatform.action.saving'])
                  : t(($) => $['imPlatform.action.save'])}
              </Button>
            </div>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}

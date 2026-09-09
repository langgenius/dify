'use client'

import type { ContactImIntegrationView, ContactImProviderDefinition } from './types'
import { Button } from '@langgenius/dify-ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { Input } from '@langgenius/dify-ui/input'
import copy from 'copy-to-clipboard'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSaveContactImCredentials, useTestContactImConnection } from './hooks'
import { resolveContactImProviderFormAdapter } from './provider-form-adapters'
import {
  ContactImProvider,
  ContactImProviderField,
  ContactImRepositoryError,
  ContactImRepositoryErrorCode,
} from './types'

type CredentialValues = Partial<Record<Exclude<ContactImProviderField, 'secret'>, string>>

export type ContactImBindingDialogProps = {
  integration: ContactImIntegrationView | null
  open: boolean
  provider: ContactImProviderDefinition
  replaceActiveProvider: boolean
  replacedIntegration?: ContactImIntegrationView
  onOpenChange: (open: boolean) => void
}

export function ContactImBindingDialog({
  integration,
  open,
  provider,
  replaceActiveProvider,
  replacedIntegration,
  onOpenChange,
}: ContactImBindingDialogProps) {
  const { t } = useTranslation('contacts')
  const { t: tCommon } = useTranslation('common')
  const adapter = resolveContactImProviderFormAdapter(provider)
  const saveCredentials = useSaveContactImCredentials()
  const testConnection = useTestContactImConnection()
  const formRef = useRef<HTMLFormElement>(null)
  const [values, setValues] = useState<CredentialValues>(() => ({
    ...integration?.configuredValues,
  }))
  const [secret, setSecret] = useState('')
  const [copied, setCopied] = useState(false)
  const [testSucceeded, setTestSucceeded] = useState(false)
  const isCurrentProvider = Boolean(integration) && !replaceActiveProvider
  const isPending = saveCredentials.isPending || testConnection.isPending
  const callbackUrl =
    integration?.callbackUrl ?? (provider.requiresFreshCredentials ? null : provider.callbackUrl)
  const canRetainSecret =
    !provider.requiresFreshCredentials && isCurrentProvider && integration?.secretConfigured
  const targetIntegration = integration ?? replacedIntegration
  const credentialCommand = () => ({
    provider: provider.provider,
    retainSecret: Boolean(canRetainSecret && !secret.trim()),
    secret: secret.trim() || undefined,
    values: Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, value?.trim() ?? '']),
    ),
  })
  const clearSecrets = () => {
    setSecret('')
    setValues((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([key]) => !adapter.fields.some((field) => field.field === key && field.secret),
        ),
      ),
    )
  }
  const safeErrorMessage = (error: unknown, fallback: string) => {
    if (!(error instanceof ContactImRepositoryError)) return fallback
    if (error.code === ContactImRepositoryErrorCode.ConfigurationUpdated)
      return t(($) => $['imPlatform.configurationUpdated'])
    return error.statusDescription ?? fallback
  }
  const title = isCurrentProvider
    ? t(($) => $['imPlatform.bindingDialog.configureTitle'], {
        provider: provider.displayName,
      })
    : t(($) => $['imPlatform.bindingDialog.connectTitle'], {
        provider: provider.displayName,
      })

  const closeDialog = () => {
    if (isPending) return
    clearSecrets()
    onOpenChange(false)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) closeDialog()
  }

  const handleCopyCallback = () => {
    if (!callbackUrl) return
    copy(callbackUrl)
    setCopied(true)
  }

  const handleTestConnection = async () => {
    if (isPending || !formRef.current?.reportValidity()) return
    setTestSucceeded(false)
    try {
      await testConnection.testConnection(credentialCommand())
      setTestSucceeded(true)
    } catch {
      // Only the repository's safe error is rendered below.
    }
  }

  const handleSave = async () => {
    if (isPending) return
    setTestSucceeded(false)
    try {
      await saveCredentials.saveCredentials({
        ...credentialCommand(),
        channelId: targetIntegration?.channelId,
        expectedConfigVersion: targetIntegration?.configVersion,
        replaceActiveProvider,
      })
      clearSecrets()
      onOpenChange(false)
    } catch {
      clearSecrets()
    }
  }

  const fieldLabels: Record<ContactImProviderField, string> = {
    [ContactImProviderField.AppId]: t(($) => $['imPlatform.bindingDialog.field.appId']),
    [ContactImProviderField.ClientId]: t(($) => $['imPlatform.bindingDialog.field.clientId']),
    [ContactImProviderField.TenantId]: t(($) => $['imPlatform.bindingDialog.field.tenantId']),
    [ContactImProviderField.CorpId]: t(($) => $['imPlatform.bindingDialog.field.corpId']),
    [ContactImProviderField.AgentId]: t(($) => $['imPlatform.bindingDialog.field.agentId']),
    [ContactImProviderField.SigningSecret]: t(
      ($) => $['imPlatform.bindingDialog.field.signingSecret'],
    ),
    [ContactImProviderField.BotToken]: t(($) => $['imPlatform.bindingDialog.field.botToken']),
    [ContactImProviderField.AppToken]: t(($) => $['imPlatform.bindingDialog.field.appToken']),
    [ContactImProviderField.VerificationToken]: t(
      ($) => $['imPlatform.bindingDialog.field.verificationToken'],
    ),
    [ContactImProviderField.EncryptKey]: t(($) => $['imPlatform.bindingDialog.field.encryptKey']),
    [ContactImProviderField.Secret]:
      provider.provider === ContactImProvider.WeCom
        ? t(($) => $['imPlatform.bindingDialog.field.genericSecret'])
        : [ContactImProvider.Slack, ContactImProvider.DingTalk, ContactImProvider.MSTeams].some(
              (name) => name === provider.provider,
            )
          ? t(($) => $['imPlatform.bindingDialog.field.clientSecret'])
          : t(($) => $['imPlatform.bindingDialog.field.secret']),
    [ContactImProviderField.SenderEmail]: t(($) => $['imPlatform.email.senderEmail']),
    [ContactImProviderField.SenderName]: t(($) => $['imPlatform.email.senderName']),
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal={isPending}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[520px] flex-col overflow-hidden! p-0!">
        <DialogClose
          render={
            <IconButton
              aria-label={tCommon(($) => $['operation.close'])}
              className="absolute top-6 right-6"
              disabled={isPending}
              size="lg"
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </IconButton>
          }
        />
        <div className="shrink-0 px-6 pt-6 pb-3">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">{title}</DialogTitle>
          <DialogDescription className="mt-1 system-sm-regular text-text-tertiary">
            {t(($) => $['imPlatform.bindingDialog.description'])}
          </DialogDescription>
        </div>

        {callbackUrl && (
          <div className="mx-6 mb-3 rounded-xl border border-divider-subtle bg-background-default-subtle p-3">
            <div className="system-xs-medium text-text-secondary">
              {t(($) => $['imPlatform.bindingDialog.callback'])}
            </div>
            <div className="mt-1 system-xs-regular text-text-tertiary">
              {t(($) => $['imPlatform.bindingDialog.callbackDescription'])}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md bg-background-default px-2 py-1 text-xs text-text-secondary">
                {callbackUrl}
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

        <Form<CredentialValues>
          ref={formRef}
          className="flex min-h-0 flex-1 flex-col"
          onFormSubmit={handleSave}
        >
          <div className="space-y-4 overflow-y-auto px-6 py-2">
            {isCurrentProvider && provider.requiresFreshCredentials && (
              <p className="system-sm-regular text-text-tertiary">
                {t(($) => $['imPlatform.bindingDialog.freshCredentials'])}
              </p>
            )}
            {adapter.fields.map(({ field, required, secret: isSecret }) => (
              <Field key={field} name={field}>
                <FieldLabel>{fieldLabels[field]}</FieldLabel>
                <Input
                  autoComplete={isSecret ? 'new-password' : 'off'}
                  disabled={isPending}
                  required={
                    required && !(field === ContactImProviderField.Secret && canRetainSecret)
                  }
                  type={isSecret ? 'password' : 'text'}
                  value={field === ContactImProviderField.Secret ? secret : (values[field] ?? '')}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    setTestSucceeded(false)
                    testConnection.reset()
                    saveCredentials.reset()
                    if (field === ContactImProviderField.Secret) setSecret(value)
                    else setValues((current) => ({ ...current, [field]: value }))
                  }}
                />
                {field === ContactImProviderField.Secret && canRetainSecret && (
                  <FieldDescription>
                    {t(($) => $['imPlatform.bindingDialog.secretConfigured'])}
                  </FieldDescription>
                )}
                <FieldError match="valueMissing">
                  {t(($) => $['imPlatform.bindingDialog.required'])}
                </FieldError>
              </Field>
            ))}
            {testSucceeded && (
              <div role="status" className="system-xs-regular text-text-success">
                {t(($) => $['imPlatform.email.testSucceeded'])}
              </div>
            )}
            {testConnection.isError && (
              <div role="alert" className="system-sm-regular text-text-destructive">
                {safeErrorMessage(
                  testConnection.error,
                  t(($) => $['imPlatform.bindingDialog.testFailed']),
                )}
              </div>
            )}
            {saveCredentials.isError && (
              <div role="alert" className="system-sm-regular text-text-destructive">
                {safeErrorMessage(
                  saveCredentials.error,
                  t(($) => $['imPlatform.bindingDialog.saveFailed']),
                )}
              </div>
            )}
          </div>
          <div className="mt-auto flex shrink-0 items-center justify-between gap-3 px-6 pt-5 pb-6">
            <Button
              disabled={isPending}
              loading={testConnection.isPending}
              onClick={handleTestConnection}
            >
              {testConnection.isPending
                ? t(($) => $['imPlatform.action.testing'])
                : t(($) => $['imPlatform.action.testConnection'])}
            </Button>
            <div className="flex gap-2">
              <Button disabled={isPending} onClick={closeDialog}>
                {tCommon(($) => $['operation.cancel'])}
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={isPending}
                loading={saveCredentials.isPending}
              >
                {saveCredentials.isPending
                  ? t(($) => $['imPlatform.action.saving'])
                  : t(($) => $['imPlatform.action.save'])}
              </Button>
            </div>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

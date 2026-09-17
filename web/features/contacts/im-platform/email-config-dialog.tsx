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
import { InputGroup, InputGroupAddon, InputGroupInput } from '@langgenius/dify-ui/input-group'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSaveContactImCredentials, useTestContactImConnection } from './hooks'
import { ContactImProvider, ContactImRepositoryError, ContactImRepositoryErrorCode } from './types'

type EmailConfigValues = {
  senderEmail: string
  senderName: string
}

export type ContactEmailConfigDialogProps = {
  integration: ContactImIntegrationView | null
  open: boolean
  provider: ContactImProviderDefinition
  onOpenChange: (open: boolean) => void
}

export function ContactEmailConfigDialog({
  integration,
  open,
  provider,
  onOpenChange,
}: ContactEmailConfigDialogProps) {
  const { t } = useTranslation('contacts')
  const { t: tCommon } = useTranslation('common')
  const formRef = useRef<HTMLFormElement>(null)
  const saveCredentials = useSaveContactImCredentials()
  const testConnection = useTestContactImConnection()
  const [values, setValues] = useState<EmailConfigValues>(() => ({
    senderEmail: integration?.configuredValues.senderEmail ?? '',
    senderName: integration?.configuredValues.senderName ?? '',
  }))
  const [apiKey, setApiKey] = useState('')
  const [testSucceeded, setTestSucceeded] = useState(false)
  const isPending = saveCredentials.isPending || testConnection.isPending
  const canRetainSecret = !provider.requiresFreshCredentials && integration?.secretConfigured
  const retainSecret = Boolean(canRetainSecret && !apiKey.trim())
  const safeErrorMessage = (error: unknown, fallback: string) => {
    if (!(error instanceof ContactImRepositoryError)) return fallback
    if (error.code === ContactImRepositoryErrorCode.ConfigurationUpdated)
      return t(($) => $['imPlatform.configurationUpdated'])
    return error.statusDescription ?? fallback
  }

  if (provider.provider !== ContactImProvider.Email)
    throw new Error('ContactEmailConfigDialog requires the Email provider definition')

  const command = () => ({
    provider: provider.provider,
    retainSecret,
    secret: apiKey.trim() || undefined,
    values: {
      senderEmail: values.senderEmail.trim(),
      senderName: values.senderName.trim(),
    },
  })

  const validateForm = () => formRef.current?.reportValidity() ?? false

  const closeDialog = () => {
    if (isPending) return
    setApiKey('')
    onOpenChange(false)
  }

  const handleTestConnection = async () => {
    if (isPending || !validateForm()) return

    setTestSucceeded(false)
    try {
      await testConnection.testConnection(command())
      setTestSucceeded(true)
    } catch {
      // The mutation exposes only its typed safe error state below.
    }
  }

  const handleSave = async () => {
    if (isPending) return
    setTestSucceeded(false)
    try {
      await saveCredentials.saveCredentials({
        ...command(),
        replaceActiveProvider: false,
        channelId: integration?.channelId,
        expectedConfigVersion: integration?.configVersion,
      })
      setApiKey('')
      onOpenChange(false)
    } catch {
      setApiKey('')
    }
  }

  return (
    <Dialog
      open={open}
      disablePointerDismissal={isPending}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closeDialog()
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[520px] flex-col overflow-hidden! p-0!">
        <DialogClose
          render={
            <IconButton
              aria-label={tCommon(($) => $['operation.close'])}
              className="absolute top-5 right-5"
              disabled={isPending}
              size="lg"
            >
              <span aria-hidden className="i-ri-close-line size-4.5" />
            </IconButton>
          }
        />
        <div className="shrink-0 pt-6 pr-14 pb-3 pl-6">
          <DialogTitle className="title-2xl-semi-bold text-text-primary">
            {t(($) => $['imPlatform.email.title'])}
          </DialogTitle>
          <DialogDescription className="mt-1 system-xs-regular text-text-tertiary">
            {t(($) => $['imPlatform.email.description'])}{' '}
            <a
              className="text-text-accent hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
              href="https://docs.dify.ai/"
              rel="noreferrer"
              target="_blank"
            >
              {t(($) => $['imPlatform.learnMore'])}
            </a>
          </DialogDescription>
        </div>

        <Form<EmailConfigValues>
          ref={formRef}
          className="flex min-h-0 flex-1 flex-col"
          onFormSubmit={handleSave}
        >
          <div className="space-y-6 overflow-y-auto px-6 py-3">
            <Field name="emailProvider">
              <FieldLabel>{t(($) => $['imPlatform.email.provider'])}</FieldLabel>
              <InputGroup>
                <InputGroupInput disabled value="Resend" />
                <InputGroupAddon align="inline-end">
                  <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
                </InputGroupAddon>
              </InputGroup>
            </Field>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="system-xs-medium-uppercase text-text-tertiary">
                  {t(($) => $['imPlatform.email.resendSettings'])}
                </span>
                <span className="h-px flex-1 bg-divider-subtle" />
              </div>

              <p className="pb-0.5 body-xs-regular text-text-tertiary">
                {t(($) => $['imPlatform.email.resendDescription'])}
              </p>

              <Field name="senderEmail">
                <div>
                  <div className="flex items-center gap-1">
                    <FieldLabel>{t(($) => $['imPlatform.email.senderEmail'])}</FieldLabel>
                    <span aria-hidden className="system-xs-regular text-text-destructive-secondary">
                      *
                    </span>
                  </div>
                  <FieldDescription className="pt-0">
                    {t(($) => $['imPlatform.email.senderEmailDescription'])}
                  </FieldDescription>
                </div>
                <Input
                  required
                  disabled={isPending}
                  autoComplete="email"
                  placeholder="sybil@dify.ai"
                  type="email"
                  value={values.senderEmail}
                  onChange={(event) => {
                    const senderEmail = event.currentTarget.value
                    setTestSucceeded(false)
                    testConnection.reset()
                    saveCredentials.reset()
                    setValues((current) => ({ ...current, senderEmail }))
                  }}
                />
                <FieldError match="valueMissing">
                  {t(($) => $['imPlatform.bindingDialog.required'])}
                </FieldError>
                <FieldError match="typeMismatch">
                  {t(($) => $['imPlatform.email.invalidEmail'])}
                </FieldError>
              </Field>

              <Field name="senderName">
                <div>
                  <FieldLabel className="block">
                    {t(($) => $['imPlatform.email.senderName'])}
                  </FieldLabel>
                  <FieldDescription className="pt-0">
                    {t(($) => $['imPlatform.email.senderNameDescription'])}
                  </FieldDescription>
                </div>
                <Input
                  required
                  disabled={isPending}
                  maxLength={255}
                  autoComplete="organization"
                  placeholder="sybil"
                  value={values.senderName}
                  onChange={(event) => {
                    const senderName = event.currentTarget.value
                    setTestSucceeded(false)
                    testConnection.reset()
                    saveCredentials.reset()
                    setValues((current) => ({ ...current, senderName }))
                  }}
                />
                <FieldError match="valueMissing">
                  {t(($) => $['imPlatform.bindingDialog.required'])}
                </FieldError>
              </Field>

              <Field name="apiKey">
                <div>
                  <div className="flex items-center gap-1">
                    <FieldLabel>{t(($) => $['imPlatform.email.apiKey'])}</FieldLabel>
                    {!canRetainSecret && (
                      <span
                        aria-hidden
                        className="system-xs-regular text-text-destructive-secondary"
                      >
                        *
                      </span>
                    )}
                  </div>
                  <FieldDescription className="pt-0">
                    {integration && provider.requiresFreshCredentials
                      ? t(($) => $['imPlatform.bindingDialog.freshCredentials'])
                      : canRetainSecret
                        ? t(($) => $['imPlatform.email.apiKeyConfigured'])
                        : t(($) => $['imPlatform.email.apiKeyDescription'])}
                  </FieldDescription>
                </div>
                <Input
                  disabled={isPending}
                  autoComplete="new-password"
                  placeholder={t(($) => $['imPlatform.email.apiKeyPlaceholder'])}
                  required={!canRetainSecret}
                  type="password"
                  value={apiKey}
                  onChange={(event) => {
                    const value = event.currentTarget.value
                    setTestSucceeded(false)
                    testConnection.reset()
                    saveCredentials.reset()
                    setApiKey(value)
                  }}
                />
                <FieldError match="valueMissing">
                  {t(($) => $['imPlatform.bindingDialog.required'])}
                </FieldError>
              </Field>
            </div>

            {testSucceeded && (
              <div role="status" className="system-xs-regular text-text-success">
                {t(($) => $['imPlatform.email.testSucceeded'])}
              </div>
            )}
            {testConnection.isError && (
              <div role="alert" className="system-xs-regular text-text-destructive">
                {safeErrorMessage(
                  testConnection.error,
                  t(($) => $['imPlatform.bindingDialog.testFailed']),
                )}
              </div>
            )}
            {saveCredentials.isError && (
              <div role="alert" className="system-xs-regular text-text-destructive">
                {safeErrorMessage(
                  saveCredentials.error,
                  t(($) => $['imPlatform.bindingDialog.saveFailed']),
                )}
              </div>
            )}
          </div>

          <div className="mt-auto flex shrink-0 items-center justify-between gap-3 px-6 pt-5 pb-6">
            <Button
              disabled={saveCredentials.isPending}
              loading={testConnection.isPending}
              onClick={handleTestConnection}
            >
              <span aria-hidden="true" className="i-ri-send-plane-2-line size-4" />
              {testConnection.isPending
                ? t(($) => $['imPlatform.action.testing'])
                : t(($) => $['imPlatform.action.testConnection'])}
            </Button>
            <div className="flex gap-2">
              <Button className="min-w-18" disabled={isPending} onClick={closeDialog}>
                {tCommon(($) => $['operation.cancel'])}
              </Button>
              <Button
                type="submit"
                className="min-w-18"
                variant="primary"
                disabled={testConnection.isPending}
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

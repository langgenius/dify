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
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useSaveContactImCredentials, useTestContactImConnection } from './hooks'
import { ContactImProvider } from './types'

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
  const retainSecret = Boolean(integration?.secretConfigured && !apiKey.trim())

  if (provider.provider !== ContactImProvider.Email)
    throw new Error('ContactEmailConfigDialog requires the Email provider definition')

  const command = () => ({
    provider: provider.provider,
    retainSecret,
    secret: apiKey.trim() || undefined,
    values: {
      senderEmail: values.senderEmail.trim(),
      ...(values.senderName.trim() ? { senderName: values.senderName.trim() } : {}),
    },
  })

  const validateForm = () => formRef.current?.reportValidity() ?? false

  const closeDialog = () => {
    if (isPending) return
    setApiKey('')
    onOpenChange(false)
  }

  const handleTestConnection = async () => {
    if (testConnection.isPending || !validateForm()) return

    setTestSucceeded(false)
    try {
      await testConnection.testConnection(command())
      setTestSucceeded(true)
    } catch {
      // The mutation exposes only its typed safe error state below.
    }
  }

  const handleSave = async () => {
    if (saveCredentials.isPending) return

    try {
      await saveCredentials.saveCredentials(command())
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
        <DialogCloseButton aria-label={tCommon(($) => $['operation.close'])} disabled={isPending} />
        <div className="shrink-0 px-6 pt-6 pb-3">
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
          <div className="space-y-5 overflow-y-auto px-6 py-2">
            <Field name="emailProvider">
              <FieldLabel>{t(($) => $['imPlatform.email.provider'])}</FieldLabel>
              <FieldControl disabled value="Resend" />
            </Field>

            <div className="flex items-center gap-2 pt-1">
              <span className="system-xs-medium-uppercase text-text-tertiary">
                {t(($) => $['imPlatform.email.resendSettings'])}
              </span>
              <span className="h-px flex-1 bg-divider-subtle" />
            </div>

            <p className="body-xs-regular text-text-tertiary">
              {t(($) => $['imPlatform.email.resendDescription'])}
            </p>

            <Field name="senderEmail">
              <FieldLabel>{t(($) => $['imPlatform.email.senderEmail'])}</FieldLabel>
              <FieldDescription>
                {t(($) => $['imPlatform.email.senderEmailDescription'])}
              </FieldDescription>
              <FieldControl
                required
                autoComplete="email"
                placeholder="sybil@dify.ai"
                type="email"
                value={values.senderEmail}
                onValueChange={(senderEmail) => {
                  setTestSucceeded(false)
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
              <FieldLabel>{t(($) => $['imPlatform.email.senderName'])}</FieldLabel>
              <FieldDescription>
                {t(($) => $['imPlatform.email.senderNameDescription'])}
              </FieldDescription>
              <FieldControl
                autoComplete="organization"
                placeholder="sybil"
                value={values.senderName}
                onValueChange={(senderName) => {
                  setTestSucceeded(false)
                  setValues((current) => ({ ...current, senderName }))
                }}
              />
            </Field>

            <Field name="apiKey">
              <FieldLabel>{t(($) => $['imPlatform.email.apiKey'])}</FieldLabel>
              <FieldDescription>
                {integration?.secretConfigured
                  ? t(($) => $['imPlatform.email.apiKeyConfigured'])
                  : t(($) => $['imPlatform.email.apiKeyDescription'])}
              </FieldDescription>
              <FieldControl
                autoComplete="new-password"
                placeholder={t(($) => $['imPlatform.email.apiKeyPlaceholder'])}
                required={!integration?.secretConfigured}
                type="password"
                value={apiKey}
                onValueChange={(value) => {
                  setTestSucceeded(false)
                  setApiKey(value)
                }}
              />
              <FieldError match="valueMissing">
                {t(($) => $['imPlatform.bindingDialog.required'])}
              </FieldError>
            </Field>

            {testSucceeded && (
              <div role="status" className="system-xs-regular text-text-success">
                {t(($) => $['imPlatform.email.testSucceeded'])}
              </div>
            )}
            {testConnection.isError && (
              <div role="alert" className="system-xs-regular text-text-destructive">
                {t(($) => $['imPlatform.bindingDialog.testFailed'])}
              </div>
            )}
            {saveCredentials.isError && (
              <div role="alert" className="system-xs-regular text-text-destructive">
                {t(($) => $['imPlatform.bindingDialog.saveFailed'])}
              </div>
            )}
          </div>

          <div className="mt-auto flex shrink-0 items-center justify-between gap-3 px-6 pt-5 pb-6">
            <Button
              disabled={isPending}
              loading={testConnection.isPending}
              onClick={handleTestConnection}
            >
              <span aria-hidden="true" className="i-ri-send-plane-line size-4" />
              {testConnection.isPending
                ? t(($) => $['imPlatform.action.testing'])
                : t(($) => $['imPlatform.action.testConnection'])}
            </Button>
            <div className="flex gap-2">
              <Button disabled={isPending} onClick={closeDialog}>
                {tCommon(($) => $['operation.cancel'])}
              </Button>
              <Button type="submit" variant="primary" loading={saveCredentials.isPending}>
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

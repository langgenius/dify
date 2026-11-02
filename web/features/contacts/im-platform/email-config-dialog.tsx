'use client'

import type { ContactImIntegrationView, ContactImProviderDefinition } from './types'
import { Button } from '@langgenius/dify-ui/button'
import {
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogHeaderCloseButton,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@langgenius/dify-ui/field'
import { Form } from '@langgenius/dify-ui/form'
import { Input } from '@langgenius/dify-ui/input'
import { useId, useRef, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useDocLink } from '@/context/i18n'
import { canRetainCredential } from './credential-draft'
import { useSaveContactImCredentials, useTestContactImConnection } from './hooks'
import {
  ContactImProvider,
  ContactImProviderField,
  ContactImRepositoryError,
  ContactImRepositoryErrorCode,
} from './types'

type EmailConfigValues = {
  senderEmail: string
  senderName: string
}

export type ContactEmailConfigDialogProps = {
  integration: ContactImIntegrationView | null
  provider: ContactImProviderDefinition
  onOpenChange: (open: boolean) => void
}

export function ContactEmailConfigContent({
  integration,
  provider,
  onOpenChange,
}: ContactEmailConfigDialogProps) {
  const { t } = useTranslation(['contacts'])
  const { t: tCommon } = useTranslation(['common'])
  const docLink = useDocLink()
  const formRef = useRef<HTMLFormElement>(null)
  const saveCredentials = useSaveContactImCredentials()
  const testConnection = useTestContactImConnection()
  const [values, setValues] = useState<EmailConfigValues>(() => ({
    senderEmail: integration?.configuredValues.senderEmail ?? '',
    senderName: integration?.configuredValues.senderName ?? '',
  }))
  const [apiKey, setApiKey] = useState('')
  const testLabelId = useId()
  const saveLabelId = useId()
  const [testSucceeded, setTestSucceeded] = useState(false)
  const isPending = saveCredentials.isPending || testConnection.isPending
  const savedDetailsUnavailable =
    saveCredentials.error instanceof ContactImRepositoryError &&
    saveCredentials.error.code === ContactImRepositoryErrorCode.SavedDetailsUnavailable
  const credentialsDisabled = isPending || savedDetailsUnavailable
  const canRetainField = (field: ContactImProviderField) => canRetainCredential(integration, field)
  const canRetainSecret = canRetainField(ContactImProviderField.Secret)
  const safeErrorMessage = (error: unknown, fallback: string) => {
    if (!(error instanceof ContactImRepositoryError)) return fallback
    if (error.code === ContactImRepositoryErrorCode.ConfigurationUpdated)
      return t(($) => $['imPlatform.configurationUpdated'])
    if (error.code === ContactImRepositoryErrorCode.SavedDetailsUnavailable)
      return t(($) => $['imPlatform.bindingDialog.savedDetailsUnavailable'])
    if (error.code === ContactImRepositoryErrorCode.ReplacementRequired)
      return t(($) => $['imPlatform.bindingDialog.replacementRequired'])
    return error.statusDescription ?? fallback
  }

  if (provider.provider !== ContactImProvider.Email)
    throw new Error('ContactEmailConfigDialog requires the Email provider definition')

  const command = () => ({
    channelId: integration?.id,
    expectedConfigVersion: integration?.config_version,
    provider: provider.provider,
    clearedFields: [],
    secret: apiKey.trim() || undefined,
    values: {
      senderEmail: values.senderEmail.trim(),
      senderName: values.senderName.trim(),
    },
  })

  const validateForm = () => formRef.current?.reportValidity() ?? false

  const closeDialog = () => {
    if (isPending) return
    onOpenChange(false)
  }

  const handleTestConnection = async () => {
    if (credentialsDisabled || !validateForm()) return

    setTestSucceeded(false)
    try {
      await testConnection.testConnection(command())
      setTestSucceeded(true)
    } catch {
      // The mutation exposes only its typed safe error state below.
    }
  }

  const handleSave = async () => {
    if (credentialsDisabled) return
    setTestSucceeded(false)
    try {
      await saveCredentials.saveCredentials({
        ...command(),
        replaceActiveProvider: false,
        channelId: integration?.id,
        expectedConfigVersion: integration?.config_version,
      })
      setApiKey('')
      onOpenChange(false)
    } catch (error) {
      if (
        error instanceof ContactImRepositoryError &&
        error.code === ContactImRepositoryErrorCode.SavedDetailsUnavailable
      ) {
        setApiKey('')
        testConnection.reset()
      }
      // Ordinary write failures keep the draft available for correction and retry.
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogHeaderCloseButton
          aria-label={tCommon(($) => $['operation.close'])}
          disabled={isPending}
        />
        <DialogTitle>{t(($) => $['imPlatform.email.title'])}</DialogTitle>
        <DialogDescription>
          <Trans
            ns="contacts"
            i18nKey={($) => $['imPlatform.email.description']}
            components={{ emphasis: <span className="text-text-secondary" /> }}
          />{' '}
          <a
            className="text-text-accent hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            href={docLink('/use-dify/nodes/human-input')}
            rel="noreferrer"
            target="_blank"
          >
            {t(($) => $['imPlatform.learnMore'])}
          </a>
        </DialogDescription>
      </DialogHeader>

      <Form<EmailConfigValues>
        ref={formRef}
        className="flex min-h-0 flex-1 flex-col"
        onFormSubmit={handleSave}
      >
        <DialogBody className="space-y-6">
          <div className="space-y-2">
            <p className="system-sm-medium text-text-primary">
              {t(($) => $['imPlatform.email.provider'])}
            </p>
            <p className="system-sm-regular text-text-primary">Resend</p>
          </div>

          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="system-xs-medium-uppercase text-text-tertiary">
                {t(($) => $['imPlatform.email.resendSettings'])}
              </span>
              <span className="h-px flex-1 bg-divider-subtle" />
            </div>

            <p className="pb-0.5 body-xs-regular text-text-tertiary">
              <Trans
                ns="contacts"
                i18nKey={($) => $['imPlatform.email.resendDescription']}
                components={{
                  apiKey: (
                    <a
                      className="rounded-sm underline decoration-text-tertiary/30 underline-offset-2 focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                      href="https://resend.com/docs/dashboard/api-keys/introduction"
                      rel="noreferrer"
                      target="_blank"
                    >
                      Resend {t(($) => $['imPlatform.email.apiKey'])}
                    </a>
                  ),
                  resend: (
                    <a
                      className="rounded-sm underline decoration-text-tertiary/30 underline-offset-2 focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                      href="https://www.resend.com/"
                      rel="noreferrer"
                      target="_blank"
                    >
                      Resend
                    </a>
                  ),
                }}
              />
            </p>

            <Field name="senderEmail">
              <div>
                <div className="flex items-center gap-1">
                  <FieldLabel>{t(($) => $['imPlatform.email.senderEmail'])}</FieldLabel>
                  {!canRetainField(ContactImProviderField.SenderEmail) && (
                    <span aria-hidden className="system-xs-regular text-text-destructive-secondary">
                      *
                    </span>
                  )}
                </div>
                <FieldDescription className="pt-0">
                  {t(($) => $['imPlatform.email.senderEmailDescription'])}
                </FieldDescription>
              </div>
              <Input
                required={!canRetainField(ContactImProviderField.SenderEmail)}
                disabled={credentialsDisabled}
                autoComplete="email"
                placeholder="joe@example.com"
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
                {!canRetainField(ContactImProviderField.SenderName) && (
                  <span aria-hidden className="text-text-destructive-secondary">
                    *
                  </span>
                )}
                <FieldDescription className="pt-0">
                  {t(($) => $['imPlatform.email.senderNameDescription'])}
                </FieldDescription>
              </div>
              <Input
                required={!canRetainField(ContactImProviderField.SenderName)}
                disabled={credentialsDisabled}
                maxLength={255}
                autoComplete="organization"
                placeholder="joe"
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
                    <span aria-hidden className="system-xs-regular text-text-destructive-secondary">
                      *
                    </span>
                  )}
                </div>
                <FieldDescription className="pt-0">
                  {canRetainSecret
                    ? t(($) => $['imPlatform.email.apiKeyConfigured'])
                    : t(($) => $['imPlatform.email.apiKeyDescription'])}
                </FieldDescription>
              </div>
              <Input
                disabled={credentialsDisabled}
                autoComplete="new-password"
                placeholder={
                  canRetainSecret ? '••••••••' : t(($) => $['imPlatform.email.apiKeyPlaceholder'])
                }
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

          <div role="status" aria-atomic="true" className="system-xs-regular text-text-success">
            {testSucceeded ? t(($) => $['imPlatform.email.testSucceeded']) : ''}
          </div>
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
        </DialogBody>

        <DialogFooter>
          <div className="flex w-full items-center justify-between gap-3">
            <Button
              aria-labelledby={testLabelId}
              disabled={saveCredentials.isPending || savedDetailsUnavailable}
              loading={testConnection.isPending}
              onClick={handleTestConnection}
            >
              <span aria-hidden="true" className="i-ri-send-plane-2-line size-4" />
              <span id={testLabelId}>
                {testConnection.isPending
                  ? t(($) => $['imPlatform.action.testing'])
                  : t(($) => $['imPlatform.action.testConnection'])}
              </span>
            </Button>
            <div className="flex gap-2">
              <Button className="min-w-18" disabled={isPending} onClick={closeDialog}>
                {tCommon(($) => $['operation.cancel'])}
              </Button>
              <Button
                aria-labelledby={saveLabelId}
                type="submit"
                className="min-w-18"
                variant="primary"
                disabled={testConnection.isPending || savedDetailsUnavailable}
                loading={saveCredentials.isPending}
              >
                <span id={saveLabelId}>
                  {saveCredentials.isPending
                    ? t(($) => $['imPlatform.action.saving'])
                    : t(($) => $['imPlatform.action.save'])}
                </span>
              </Button>
            </div>
          </div>
        </DialogFooter>
      </Form>
    </>
  )
}

'use client'

import type { ContactImIntegrationView, ContactImProviderDefinition } from './types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
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
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContactImCallbackSetup } from './callback-setup'
import { useSaveContactImCredentials, useTestContactImConnection } from './hooks'
import {
  resolveContactImCallbackSetup,
  resolveContactImProviderFormAdapter,
} from './provider-form-adapters'
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
  const { t } = useTranslation(['contacts'])
  const { t: tCommon } = useTranslation(['common'])
  const adapter = resolveContactImProviderFormAdapter(provider)
  const saveCredentials = useSaveContactImCredentials()
  const testConnection = useTestContactImConnection()
  const formRef = useRef<HTMLFormElement>(null)
  const firstCredentialRef = useRef<HTMLInputElement>(null)
  const saveLabelId = useId()
  const testLabelId = useId()
  const [savedIntegration, setSavedIntegration] = useState(() =>
    replaceActiveProvider ? null : integration,
  )
  const [step, setStep] = useState<'credentials' | 'callbacks'>(() =>
    !replaceActiveProvider && integration?.callbackUrl ? 'callbacks' : 'credentials',
  )
  const [values, setValues] = useState<CredentialValues>(() => {
    const configuredValues = { ...integration?.configuredValues }
    if (
      !replaceActiveProvider &&
      (provider.provider === ContactImProvider.Feishu ||
        provider.provider === ContactImProvider.Lark) &&
      integration?.displayIdentifier
    ) {
      configuredValues[ContactImProviderField.AppId] ??= integration.displayIdentifier
    }
    return configuredValues
  })
  const [secret, setSecret] = useState('')
  const [credentialsEdited, setCredentialsEdited] = useState(false)
  const [testSucceeded, setTestSucceeded] = useState(false)
  const isCurrentProvider = Boolean(savedIntegration)
  const isPending = saveCredentials.isPending || testConnection.isPending
  const callbackUrl = savedIntegration?.callbackUrl
  const callbackSetup =
    provider.provider === ContactImProvider.Email
      ? null
      : resolveContactImCallbackSetup(provider.provider)
  const hasCallbackSetup = Boolean(callbackUrl || (!savedIntegration && callbackSetup))
  const canContinueWithoutSaving = Boolean(callbackUrl) && !credentialsEdited
  const canRetainSecret =
    !provider.requiresFreshCredentials && isCurrentProvider && savedIntegration?.secretConfigured
  const targetIntegration = savedIntegration ?? replacedIntegration

  useEffect(() => {
    if (step === 'credentials') firstCredentialRef.current?.focus()
  }, [step])
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
  const title =
    isCurrentProvider || hasCallbackSetup
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
      const saved = await saveCredentials.saveCredentials({
        ...credentialCommand(),
        channelId: targetIntegration?.channelId,
        expectedConfigVersion: targetIntegration?.configVersion,
        replaceActiveProvider: replaceActiveProvider && !savedIntegration,
      })
      setSavedIntegration(saved)
      setCredentialsEdited(false)
      clearSecrets()
      if (saved.callbackUrl) setStep('callbacks')
      else onOpenChange(false)
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

  const fieldPlaceholders: Partial<Record<ContactImProviderField, string>> = {
    [ContactImProviderField.AppId]: t(($) => $['imPlatform.bindingDialog.fieldPlaceholder.appId']),
    [ContactImProviderField.VerificationToken]: t(
      ($) => $['imPlatform.bindingDialog.fieldPlaceholder.verificationToken'],
    ),
    [ContactImProviderField.EncryptKey]: t(
      ($) => $['imPlatform.bindingDialog.fieldPlaceholder.encryptKey'],
    ),
    ...((provider.provider === ContactImProvider.Feishu ||
      provider.provider === ContactImProvider.Lark) && {
      [ContactImProviderField.Secret]: t(
        ($) => $['imPlatform.bindingDialog.fieldPlaceholder.secret'],
      ),
    }),
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal={isPending}>
      <DialogContent
        backdropProps={{ forceRender: true }}
        className={cn(
          'flex max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] flex-col overflow-hidden! p-0!',
          hasCallbackSetup ? 'w-120' : 'w-104',
        )}
      >
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
          <DialogTitle className="title-2xl-semi-bold text-text-primary">{title}</DialogTitle>
          <DialogDescription
            className={hasCallbackSetup ? 'mt-1 system-sm-regular text-text-tertiary' : 'sr-only'}
          >
            {hasCallbackSetup
              ? step === 'callbacks'
                ? t(($) => $['imPlatform.bindingDialog.callbackDescription'], {
                    provider: provider.displayName,
                  })
                : t(($) => $['imPlatform.bindingDialog.credentialsDescription'], {
                    provider: provider.displayName,
                  })
              : t(($) => $['imPlatform.bindingDialog.description'])}
          </DialogDescription>
        </div>

        {hasCallbackSetup && (
          <ol className="flex shrink-0 items-center gap-3 px-6 pt-2 pb-5">
            {(['credentials', 'callbacks'] as const).map((item, index) => (
              <li
                key={item}
                aria-current={step === item ? 'step' : undefined}
                className={cn(
                  'flex min-w-0 items-center gap-2 system-xs-medium-uppercase',
                  step === item ? 'text-text-accent' : 'text-text-quaternary',
                )}
              >
                {index > 0 && <span aria-hidden className="mr-1 h-px w-4 bg-divider-subtle" />}
                <span
                  className={cn(
                    'shrink-0 rounded-full px-1.5 py-0.5',
                    step === item
                      ? 'bg-components-button-primary-bg text-components-button-primary-text'
                      : 'ring-1 ring-divider-subtle',
                  )}
                >
                  {step === item
                    ? t(($) => $['imPlatform.bindingDialog.step'], { step: index + 1 })
                    : index + 1}
                </span>
                {item === 'credentials'
                  ? t(($) => $['imPlatform.bindingDialog.credentialsStep'])
                  : t(($) => $['imPlatform.bindingDialog.callbackStep'])}
              </li>
            ))}
          </ol>
        )}

        {step === 'callbacks' && callbackUrl ? (
          <ContactImCallbackSetup
            callbackUrl={callbackUrl}
            providerName={provider.displayName}
            setup={callbackSetup}
            setupGuideUrl={adapter.setupGuideUrl}
            onBack={() => setStep('credentials')}
            onFinish={closeDialog}
          />
        ) : (
          <Form<CredentialValues>
            ref={formRef}
            className="flex min-h-0 flex-1 flex-col"
            onFormSubmit={handleSave}
          >
            <div className="space-y-4 overflow-y-auto px-6 py-3">
              {isCurrentProvider && provider.requiresFreshCredentials && (
                <p className="system-sm-regular text-text-tertiary">
                  {t(($) => $['imPlatform.bindingDialog.freshCredentials'])}
                </p>
              )}
              {adapter.fields.map(({ field, required, secret: isSecret }, index) => (
                <Field key={field} name={field}>
                  <FieldLabel>{fieldLabels[field]}</FieldLabel>
                  <Input
                    ref={index === 0 ? firstCredentialRef : undefined}
                    autoComplete={isSecret ? 'new-password' : 'off'}
                    disabled={isPending}
                    placeholder={fieldPlaceholders[field]}
                    required={
                      required && !(field === ContactImProviderField.Secret && canRetainSecret)
                    }
                    type={isSecret ? 'password' : 'text'}
                    value={field === ContactImProviderField.Secret ? secret : (values[field] ?? '')}
                    onChange={(event) => {
                      const value = event.currentTarget.value
                      setCredentialsEdited(true)
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
              <Button
                aria-labelledby={testLabelId}
                disabled={saveCredentials.isPending}
                loading={testConnection.isPending}
                onClick={handleTestConnection}
              >
                <span aria-hidden className="i-ri-send-plane-2-line size-4" />
                <span id={testLabelId}>
                  {testConnection.isPending
                    ? t(($) => $['imPlatform.action.testing'])
                    : t(($) => $['imPlatform.action.testConnection'])}
                </span>
              </Button>
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
            <div className="mt-auto flex shrink-0 flex-wrap items-center justify-between gap-3 px-6 pt-5 pb-6">
              <a
                className="inline-flex items-center gap-1 rounded-sm system-xs-regular text-text-accent hover:underline focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
                href={adapter.setupGuideUrl}
                rel="noreferrer"
                target="_blank"
              >
                {hasCallbackSetup
                  ? t(($) => $['imPlatform.bindingDialog.openSetupGuide'])
                  : t(($) => $['imPlatform.action.setupGuide'])}
                <span aria-hidden className="i-ri-external-link-line size-3" />
              </a>
              <div className="ml-auto flex gap-2">
                <Button className="min-w-18" disabled={isPending} onClick={closeDialog}>
                  {tCommon(($) => $['operation.cancel'])}
                </Button>
                <Button
                  aria-labelledby={saveLabelId}
                  type={canContinueWithoutSaving ? 'button' : 'submit'}
                  onClick={canContinueWithoutSaving ? () => setStep('callbacks') : undefined}
                  className="min-w-18"
                  variant="primary"
                  disabled={testConnection.isPending}
                  loading={saveCredentials.isPending}
                >
                  <span id={saveLabelId}>
                    {saveCredentials.isPending
                      ? t(($) => $['imPlatform.action.saving'])
                      : hasCallbackSetup
                        ? t(($) => $['imPlatform.bindingDialog.saveAndContinue'])
                        : isCurrentProvider
                          ? t(($) => $['imPlatform.action.save'])
                          : t(($) => $['imPlatform.action.connect'])}
                  </span>
                </Button>
              </div>
            </div>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}

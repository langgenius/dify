'use client'

import type { ChannelSummary } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ContactImIntegrationView, ContactImProviderDefinition } from './types'
import {
  AlertDialog,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@langgenius/dify-ui/alert-dialog'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
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
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContactImCallbackSetup } from './callback-setup'
import { canRetainCredential } from './credential-draft'
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
  provider: ContactImProviderDefinition
  replaceActiveProvider: boolean
  replacedIntegration?: ChannelSummary
  onOpenChange: (open: boolean) => void
}

export function ContactImBindingContent({
  integration,
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
    !replaceActiveProvider && integration?.webhook_url ? 'callbacks' : 'credentials',
  )
  const [values, setValues] = useState<CredentialValues>(() =>
    replaceActiveProvider ? {} : { ...integration?.configuredValues },
  )
  const [secret, setSecret] = useState('')
  const [clearedFields, setClearedFields] = useState<ContactImProviderField[]>([])
  const [credentialsEdited, setCredentialsEdited] = useState(false)
  const [testSucceeded, setTestSucceeded] = useState(false)
  const [replaceTenant, setReplaceTenant] = useState(false)
  const [replacementConfirmationOpen, setReplacementConfirmationOpen] = useState(false)
  const isCurrentProvider = Boolean(savedIntegration)
  const isPending = saveCredentials.isPending || testConnection.isPending
  const savedDetailsUnavailable =
    saveCredentials.error instanceof ContactImRepositoryError &&
    saveCredentials.error.code === ContactImRepositoryErrorCode.SavedDetailsUnavailable
  const credentialsDisabled = isPending || savedDetailsUnavailable
  const callbackUrl = savedIntegration?.webhook_url
  const callbackSetup =
    provider.provider === ContactImProvider.Email
      ? null
      : resolveContactImCallbackSetup(provider.provider)
  const hasCallbackSetup = Boolean(callbackUrl || (!savedIntegration && callbackSetup))
  const canContinueWithoutSaving = Boolean(callbackUrl) && !credentialsEdited
  const targetIntegration = savedIntegration ?? replacedIntegration
  const canRetainField = (field: ContactImProviderField) =>
    !replaceTenant && canRetainCredential(savedIntegration, field)

  useEffect(() => {
    if (step === 'credentials') firstCredentialRef.current?.focus()
  }, [step])
  const credentialCommand = () => ({
    channelId: replaceTenant ? undefined : savedIntegration?.id,
    expectedConfigVersion: replaceTenant ? undefined : savedIntegration?.config_version,
    provider: provider.provider,
    clearedFields,
    secret: secret.trim() || undefined,
    values: Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, value?.trim() ?? '']),
    ),
  })
  const clearSecrets = () => {
    setSecret('')
    setClearedFields([])
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
    if (error.code === ContactImRepositoryErrorCode.SavedDetailsUnavailable)
      return t(($) => $['imPlatform.bindingDialog.savedDetailsUnavailable'])
    if (error.code === ContactImRepositoryErrorCode.ReplacementRequired)
      return t(($) => $['imPlatform.bindingDialog.replacementRequired'])
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
    onOpenChange(false)
  }

  const handleTestConnection = async () => {
    if (credentialsDisabled || !formRef.current?.reportValidity()) return
    setTestSucceeded(false)
    try {
      await testConnection.testConnection(credentialCommand())
      setTestSucceeded(true)
    } catch {
      // Only the repository's safe error is rendered below.
    }
  }

  const save = async (replaceCurrentTenant = false) => {
    if (credentialsDisabled) return
    setTestSucceeded(false)
    try {
      const saved = await saveCredentials.saveCredentials({
        ...credentialCommand(),
        channelId: targetIntegration?.id,
        expectedConfigVersion: targetIntegration?.config_version,
        replaceActiveProvider: replaceCurrentTenant || (replaceActiveProvider && !savedIntegration),
      })
      setSavedIntegration(saved)
      setReplaceTenant(false)
      setValues(saved.configuredValues)
      setCredentialsEdited(false)
      clearSecrets()
      if (saved.webhook_url) setStep('callbacks')
      else onOpenChange(false)
    } catch (error) {
      if (
        error instanceof ContactImRepositoryError &&
        error.code === ContactImRepositoryErrorCode.ReplacementRequired &&
        savedIntegration
      ) {
        setReplacementConfirmationOpen(true)
      }
      if (
        error instanceof ContactImRepositoryError &&
        error.code === ContactImRepositoryErrorCode.SavedDetailsUnavailable
      ) {
        clearSecrets()
        testConnection.reset()
      }
      // Ordinary write failures keep the draft available for correction and retry.
    }
  }

  const handleSave = () => {
    return save(replaceTenant)
  }

  const confirmReplacement = () => {
    setReplacementConfirmationOpen(false)
    setReplaceTenant(true)
    saveCredentials.reset()
    testConnection.reset()
    const hasCompleteCredentials = adapter.fields.every(
      ({ field, required }) =>
        !required ||
        Boolean((field === ContactImProviderField.Secret ? secret : values[field])?.trim()),
    )
    if (hasCompleteCredentials) return save(true)
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
    <>
      <DialogHeader>
        <DialogHeaderCloseButton
          aria-label={tCommon(($) => $['operation.close'])}
          disabled={isPending}
        />
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className={hasCallbackSetup ? undefined : 'sr-only'}>
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
      </DialogHeader>

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
              {index > 0 && <span aria-hidden className="me-1 h-px w-4 bg-divider-subtle" />}
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
          <DialogBody className="space-y-4">
            {isCurrentProvider && replaceTenant && (
              <p className="system-sm-regular text-text-tertiary">
                {t(($) => $['imPlatform.bindingDialog.freshCredentials'])}
              </p>
            )}
            {adapter.fields.map(({ field, required, secret: isSecret }, index) => (
              <Field key={field} name={field}>
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel>{fieldLabels[field]}</FieldLabel>
                  {isSecret && !required && canRetainField(field) && (
                    <Button
                      size="small"
                      variant="ghost"
                      disabled={credentialsDisabled}
                      aria-label={`${fieldLabels[field]}: ${
                        clearedFields.includes(field)
                          ? t(($) => $['imPlatform.bindingDialog.undoClearCredential'])
                          : t(($) => $['imPlatform.bindingDialog.clearSavedCredential'])
                      }`}
                      onClick={() => {
                        setClearedFields((current) =>
                          current.includes(field)
                            ? current.filter((item) => item !== field)
                            : [...current, field],
                        )
                        setValues((current) => ({ ...current, [field]: '' }))
                        setCredentialsEdited(true)
                        setTestSucceeded(false)
                        testConnection.reset()
                        saveCredentials.reset()
                      }}
                    >
                      {clearedFields.includes(field)
                        ? t(($) => $['imPlatform.bindingDialog.undoClearCredential'])
                        : t(($) => $['imPlatform.bindingDialog.clearSavedCredential'])}
                    </Button>
                  )}
                </div>
                <Input
                  ref={index === 0 ? firstCredentialRef : undefined}
                  autoComplete={isSecret ? 'new-password' : 'off'}
                  disabled={credentialsDisabled || clearedFields.includes(field)}
                  placeholder={
                    isSecret && canRetainField(field) && !clearedFields.includes(field)
                      ? '••••••••'
                      : fieldPlaceholders[field]
                  }
                  required={required && !canRetainField(field)}
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
                {clearedFields.includes(field) ? (
                  <FieldDescription>
                    {t(($) => $['imPlatform.bindingDialog.credentialWillBeCleared'])}
                  </FieldDescription>
                ) : (
                  isSecret &&
                  canRetainField(field) && (
                    <FieldDescription>
                      {t(($) => $['imPlatform.bindingDialog.secretConfigured'])}
                    </FieldDescription>
                  )
                )}
                <FieldError match="valueMissing">
                  {t(($) => $['imPlatform.bindingDialog.required'])}
                </FieldError>
              </Field>
            ))}
            <Button
              aria-labelledby={testLabelId}
              disabled={saveCredentials.isPending || savedDetailsUnavailable}
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
            <div role="status" aria-atomic="true" className="system-xs-regular text-text-success">
              {testSucceeded ? t(($) => $['imPlatform.email.testSucceeded']) : ''}
            </div>
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
          </DialogBody>
          <DialogFooter>
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
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
              <div className="ms-auto flex gap-2">
                <Button className="min-w-18" disabled={isPending} onClick={closeDialog}>
                  {tCommon(($) => $['operation.cancel'])}
                </Button>
                <Button
                  aria-labelledby={saveLabelId}
                  type={canContinueWithoutSaving ? 'button' : 'submit'}
                  onClick={canContinueWithoutSaving ? () => setStep('callbacks') : undefined}
                  className="min-w-18"
                  variant="primary"
                  disabled={testConnection.isPending || savedDetailsUnavailable}
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
          </DialogFooter>
        </Form>
      )}
      <AlertDialog open={replacementConfirmationOpen} onOpenChange={setReplacementConfirmationOpen}>
        <AlertDialogContent backdropProps={{ forceRender: true }}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t(($) => $['imPlatform.bindingDialog.replaceTenantTitle'], {
                identity: savedIntegration?.display_identifier ?? provider.displayName,
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(($) => $['imPlatform.bindingDialog.replacementRequired'])}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancelButton>
              {tCommon(($) => $['operation.cancel'])}
            </AlertDialogCancelButton>
            <AlertDialogConfirmButton tone="default" onClick={confirmReplacement}>
              {t(($) => $['imPlatform.replacement.confirm'])}
            </AlertDialogConfirmButton>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

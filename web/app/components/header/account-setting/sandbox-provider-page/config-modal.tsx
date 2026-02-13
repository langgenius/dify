'use client'

import type { FormRefObject, FormSchema } from '@/app/components/base/form/types'
import type { SandboxProvider } from '@/types/sandbox-provider'
import { RiExternalLinkLine, RiLock2Fill } from '@remixicon/react'
import { memo, useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { BaseForm } from '@/app/components/base/form/components/base'
import { FormTypeEnum } from '@/app/components/base/form/types'
import Modal from '@/app/components/base/modal'
import RadioUI from '@/app/components/base/radio/ui'
import { useToastContext } from '@/app/components/base/toast'
import {
  useActivateSandboxProvider,
  useDeleteSandboxProviderConfig,
  useSaveSandboxProviderConfig,
} from '@/service/use-sandbox-provider'
import { cn } from '@/utils/classnames'
import { PROVIDER_DOC_LINKS, PROVIDER_STATIC_LABELS, SANDBOX_FIELD_CONFIGS } from './constants'
import ProviderIcon from './provider-icon'

type ConfigMode = 'managed' | 'byok'

// Providers that support mode selection (must have system config available)
const PROVIDERS_WITH_MODE_SELECTION: readonly string[] = ['e2b']

type ModeOptionProps = {
  isSelected: boolean
  isDisabled?: boolean
  title: string
  description: string
  onClick: () => void
}

function ModeOption({ isSelected, isDisabled = false, title, description, onClick }: ModeOptionProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-xl border p-3',
        isDisabled && 'cursor-not-allowed opacity-50',
        !isDisabled && 'cursor-pointer',
        isSelected
          ? 'border-[1.5px] border-components-option-card-option-selected-border bg-components-option-card-option-selected-bg'
          : 'border-components-option-card-option-border bg-components-option-card-option-bg',
        !isDisabled && !isSelected && 'hover:bg-components-option-card-option-bg-hover',
      )}
      onClick={() => !isDisabled && onClick()}
    >
      <div className="mt-0.5 shrink-0">
        <RadioUI isChecked={isSelected} disabled={isDisabled} />
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-text-primary system-sm-semibold">{title}</span>
        <span className="text-text-tertiary system-xs-regular">{description}</span>
      </div>
    </div>
  )
}

type ConfigModalProps = {
  provider: SandboxProvider
  onClose: () => void
}

function ConfigModal({ provider, onClose }: ConfigModalProps) {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const formRef = useRef<FormRefObject>(null)

  const { mutateAsync: saveConfig, isPending: isSaving } = useSaveSandboxProviderConfig()
  const { mutateAsync: deleteConfig, isPending: isDeleting } = useDeleteSandboxProviderConfig()
  const { mutateAsync: activateProvider, isPending: isActivating } = useActivateSandboxProvider()

  // Determine if mode selection should be shown (for providers that support it)
  const shouldShowModeSelection = PROVIDERS_WITH_MODE_SELECTION.includes(provider.provider_type)

  // Managed mode is only available when system has configured this provider
  const isManagedModeAvailable = provider.is_system_configured

  // Determine default mode based on configuration state
  const defaultMode: ConfigMode = provider.is_tenant_configured
    ? 'byok'
    : provider.is_system_configured
      ? 'managed'
      : 'byok'

  const [configMode, setConfigMode] = useState<ConfigMode>(defaultMode)

  const formSchemas: FormSchema[] = useMemo(() => {
    return provider.config_schema.map((schema) => {
      const fieldConfig = SANDBOX_FIELD_CONFIGS[schema.name as keyof typeof SANDBOX_FIELD_CONFIGS]
      const fallbackType = schema.type === 'secret' ? FormTypeEnum.secretInput : FormTypeEnum.textInput

      return {
        name: schema.name,
        label: fieldConfig ? t(fieldConfig.labelKey, { ns: 'common' }) : schema.name,
        placeholder: fieldConfig
          ? (fieldConfig.placeholder ?? (fieldConfig.placeholderKey ? t(fieldConfig.placeholderKey, { ns: 'common' }) : ''))
          : '',
        type: fieldConfig?.type ?? fallbackType,
        required: schema.name === 'api_key',
        default: provider.config[schema.name] || '',
      }
    })
  }, [provider.config_schema, provider.config, t])

  const handleSave = useCallback(async () => {
    // For managed mode, activate system config (preserves user config for future use)
    if (shouldShowModeSelection && configMode === 'managed') {
      try {
        await activateProvider({ providerType: provider.provider_type, type: 'system' })
        notify({ type: 'success', message: t('api.saved', { ns: 'common' }) })
        onClose()
      }
      catch {
        // Error toast is handled by fetch layer
      }
      return
    }

    // For BYOK mode, validate and save user-provided config
    const formValues = formRef.current?.getFormValues({
      needTransformWhenSecretFieldIsPristine: true,
    })

    if (!formValues?.isCheckValidated)
      return

    try {
      await saveConfig({
        providerType: provider.provider_type,
        config: formValues.values,
        activate: true,
      })
      notify({ type: 'success', message: t('api.saved', { ns: 'common' }) })
      onClose()
    }
    catch {
      // Error toast is handled by fetch layer
    }
  }, [shouldShowModeSelection, configMode, saveConfig, activateProvider, provider.provider_type, notify, t, onClose])

  const handleRevoke = useCallback(async () => {
    try {
      await deleteConfig(provider.provider_type)
      notify({ type: 'success', message: t('api.remove', { ns: 'common' }) })
      onClose()
    }
    catch {
      // Error toast is handled by fetch layer
    }
  }, [deleteConfig, provider.provider_type, notify, t, onClose])

  const docLink = PROVIDER_DOC_LINKS[provider.provider_type]
  const providerLabel = PROVIDER_STATIC_LABELS[provider.provider_type as keyof typeof PROVIDER_STATIC_LABELS]
    ?? provider.provider_type

  // Only show revoke button when in BYOK mode, tenant has custom config, and provider is not active
  // (active provider cannot be revoked to prevent "no sandbox provider" error)
  const showRevokeButton = provider.is_tenant_configured && !provider.is_active && (!shouldShowModeSelection || configMode === 'byok')
  const isActionDisabled = isSaving || isDeleting || isActivating
  const showByokForm = !shouldShowModeSelection || configMode === 'byok'

  return (
    <Modal isShow onClose={onClose} closable className="w-[480px]">
      {/* Header */}
      <div className="mb-4 flex flex-col gap-2">
        <h3 className="text-text-primary title-2xl-semi-bold">
          {t('sandboxProvider.configModal.title', { ns: 'common' })}
        </h3>
        <div className="flex items-center gap-2">
          <ProviderIcon providerType={provider.provider_type} size="sm" withBorder />
          <span className="text-text-secondary system-md-regular">{providerLabel}</span>
        </div>
      </div>

      {/* Mode Selection */}
      {shouldShowModeSelection && (
        <div className="mb-4 flex flex-col gap-1">
          <label className="text-text-secondary system-sm-medium">
            {t('sandboxProvider.configModal.connectionMode', { ns: 'common' })}
          </label>
          <div className="flex flex-col gap-2">
            <ModeOption
              isSelected={configMode === 'managed'}
              isDisabled={!isManagedModeAvailable}
              title={t('sandboxProvider.configModal.managedByDify', { ns: 'common' })}
              description={t('sandboxProvider.configModal.managedByDifyDesc', { ns: 'common' })}
              onClick={() => setConfigMode('managed')}
            />
            <ModeOption
              isSelected={configMode === 'byok'}
              title={t('sandboxProvider.configModal.bringYourOwnKey', { ns: 'common' })}
              description={t('sandboxProvider.configModal.bringYourOwnKeyDesc', { ns: 'common' })}
              onClick={() => setConfigMode('byok')}
            />
          </div>
        </div>
      )}

      {/* Form fields (hidden when managed mode is selected) */}
      {showByokForm && (
        <BaseForm
          formSchemas={formSchemas}
          ref={formRef}
          labelClassName="system-sm-medium mb-1 flex items-center gap-1 text-text-secondary"
          formClassName="space-y-4"
        />
      )}

      {/* Footer Actions */}
      <div className="mt-6 flex items-center justify-between">
        <div>
          {docLink && (
            <a
              href={docLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-text-accent system-xs-regular hover:underline"
            >
              {t('sandboxProvider.configModal.readDocLink', { ns: 'common', provider: providerLabel })}
              <RiExternalLinkLine className="h-3 w-3" />
            </a>
          )}
        </div>
        <div className="flex items-center gap-2">
          {showRevokeButton && (
            <Button variant="warning" size="medium" onClick={handleRevoke} disabled={isActionDisabled}>
              {t('sandboxProvider.configModal.revoke', { ns: 'common' })}
            </Button>
          )}
          <Button variant="secondary" size="medium" onClick={onClose} disabled={isActionDisabled}>
            {t('sandboxProvider.configModal.cancel', { ns: 'common' })}
          </Button>
          <Button variant="primary" size="medium" onClick={handleSave} disabled={isActionDisabled}>
            {t('sandboxProvider.configModal.save', { ns: 'common' })}
          </Button>
        </div>
      </div>

      {/* Security tip */}
      <div className="-mx-6 -mb-6 mt-4 flex items-start justify-center gap-1 rounded-b-2xl border-t border-divider-subtle bg-background-soft px-2 py-3">
        <RiLock2Fill className="h-3 w-3 shrink-0 text-text-primary" />
        <p className="text-text-tertiary system-xs-regular">
          {t('sandboxProvider.configModal.securityTip', { ns: 'common' })}
          {' '}
          <span className="text-text-accent">PKCS1_OAEP</span>
          {' '}
          {t('sandboxProvider.configModal.securityTipTechnology', { ns: 'common' })}
        </p>
      </div>
    </Modal>
  )
}

export default memo(ConfigModal)

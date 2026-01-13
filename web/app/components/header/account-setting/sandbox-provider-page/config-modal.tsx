'use client'

import type { FormRefObject, FormSchema } from '@/app/components/base/form/types'
import type { SandboxProvider } from '@/service/use-sandbox-provider'
import { RiExternalLinkLine, RiLock2Fill } from '@remixicon/react'
import { memo, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import Button from '@/app/components/base/button'
import { BaseForm } from '@/app/components/base/form/components/base'
import { FormTypeEnum } from '@/app/components/base/form/types'
import Modal from '@/app/components/base/modal'
import { useToastContext } from '@/app/components/base/toast'
import {
  useDeleteSandboxProviderConfig,
  useInvalidSandboxProviderList,
  useSaveSandboxProviderConfig,
} from '@/service/use-sandbox-provider'
import { PROVIDER_DOC_LINKS, SANDBOX_FIELD_CONFIGS } from './constants'

type ConfigModalProps = {
  provider: SandboxProvider
  onClose: () => void
}

const PROVIDER_ICONS: Record<string, string> = {
  e2b: '/sandbox-providers/e2b.svg',
  daytona: '/sandbox-providers/daytona.svg',
  docker: '/sandbox-providers/docker.svg',
  local: '/sandbox-providers/local.svg',
}

const ProviderIcon = ({ providerType }: { providerType: string }) => {
  const iconSrc = PROVIDER_ICONS[providerType] || PROVIDER_ICONS.e2b

  return (
    <div className="h-4 w-4 shrink-0 text-clip rounded border-[0.5px] border-divider-subtle">
      <img
        src={iconSrc}
        alt={`${providerType} icon`}
        className="h-full w-full object-cover"
      />
    </div>
  )
}

const ConfigModal = ({
  provider,
  onClose,
}: ConfigModalProps) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const invalidateList = useInvalidSandboxProviderList()
  const formRef = useRef<FormRefObject>(null)

  const { mutateAsync: saveConfig, isPending: isSaving } = useSaveSandboxProviderConfig()
  const { mutateAsync: deleteConfig, isPending: isDeleting } = useDeleteSandboxProviderConfig()

  const formSchemas: FormSchema[] = useMemo(() => {
    return provider.config_schema.map((schema) => {
      const fieldConfig = SANDBOX_FIELD_CONFIGS[schema.name as keyof typeof SANDBOX_FIELD_CONFIGS]
      const fallbackType = schema.type === 'secret' ? FormTypeEnum.secretInput : FormTypeEnum.textInput

      return {
        name: schema.name,
        label: fieldConfig ? t(fieldConfig.labelKey, { ns: 'common' }) : schema.name,
        placeholder: fieldConfig ? t(fieldConfig.placeholderKey, { ns: 'common' }) : '',
        type: fieldConfig?.type ?? fallbackType,
        required: schema.name === 'api_key',
        default: provider.config[schema.name] || '',
      }
    })
  }, [provider.config_schema, provider.config, t])

  const handleSave = useCallback(async () => {
    const formValues = formRef.current?.getFormValues({
      needTransformWhenSecretFieldIsPristine: true,
    })

    if (!formValues?.isCheckValidated)
      return

    try {
      await saveConfig({
        providerType: provider.provider_type,
        config: formValues.values,
      })
      await invalidateList()
      notify({ type: 'success', message: t('api.saved', { ns: 'common' }) })
      onClose()
    }
    catch {
      // Error toast is handled by fetch layer
    }
  }, [saveConfig, provider.provider_type, invalidateList, notify, t, onClose])

  const handleRevoke = useCallback(async () => {
    try {
      await deleteConfig(provider.provider_type)
      await invalidateList()
      notify({ type: 'success', message: t('api.remove', { ns: 'common' }) })
      onClose()
    }
    catch {
      // Error toast is handled by fetch layer
    }
  }, [deleteConfig, provider.provider_type, invalidateList, notify, t, onClose])

  const isConfigured = provider.is_tenant_configured
  const docLink = PROVIDER_DOC_LINKS[provider.provider_type]

  return (
    <Modal
      isShow
      onClose={onClose}
      title={t('sandboxProvider.configModal.title', { ns: 'common' })}
      closable
      className="w-[480px]"
    >
      {/* Provider subtitle */}
      <div className="-mt-2 mb-4 flex items-center gap-2">
        <ProviderIcon providerType={provider.provider_type} />
        <span className="system-md-regular text-text-secondary">{provider.label}</span>
      </div>

      <BaseForm
        formSchemas={formSchemas}
        ref={formRef}
        labelClassName="system-sm-medium mb-1 flex items-center gap-1 text-text-secondary"
        formClassName="space-y-4"
      />

      {/* Footer Actions */}
      <div className="mt-6 flex items-center justify-between">
        <div>
          {docLink && (
            <a
              href={docLink}
              target="_blank"
              rel="noopener noreferrer"
              className="system-xs-regular inline-flex items-center gap-1 text-text-accent hover:underline"
            >
              {t('sandboxProvider.configModal.readDocLink', { ns: 'common', provider: provider.label })}
              <RiExternalLinkLine className="h-3 w-3" />
            </a>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isConfigured && (
            <Button
              variant="warning"
              size="medium"
              onClick={handleRevoke}
              disabled={isDeleting || isSaving}
            >
              {t('sandboxProvider.configModal.revoke', { ns: 'common' })}
            </Button>
          )}
          <Button
            variant="secondary"
            size="medium"
            onClick={onClose}
            disabled={isSaving || isDeleting}
          >
            {t('sandboxProvider.configModal.cancel', { ns: 'common' })}
          </Button>
          <Button
            variant="primary"
            size="medium"
            onClick={handleSave}
            disabled={isSaving || isDeleting}
          >
            {t('sandboxProvider.configModal.save', { ns: 'common' })}
          </Button>
        </div>
      </div>

      {/* Security tip */}
      <div className="-mx-6 -mb-6 mt-4 flex items-start justify-center gap-1 rounded-b-2xl border-t border-divider-subtle bg-background-soft px-2 py-3">
        <RiLock2Fill className="h-3 w-3 shrink-0 text-text-primary" />
        <p className="system-xs-regular text-text-tertiary">
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

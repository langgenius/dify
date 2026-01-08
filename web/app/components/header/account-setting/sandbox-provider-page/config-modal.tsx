'use client'

import type { FormRefObject, FormSchema } from '@/app/components/base/form/types'
import type { SandboxProvider } from '@/service/use-sandbox-provider'
import { RiExternalLinkLine } from '@remixicon/react'
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
      title={t('sandboxProvider.configModal.title', { ns: 'common', provider: provider.label })}
      closable
      className="w-[480px]"
    >
      <div className="mt-4">
        <BaseForm
          formSchemas={formSchemas}
          ref={formRef}
          labelClassName="system-sm-semibold mb-1 flex items-center gap-1 text-text-secondary"
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
                className="system-sm-medium inline-flex items-center gap-1 text-text-accent hover:underline"
              >
                {t('sandboxProvider.configModal.readDoc', { ns: 'common' })}
                <RiExternalLinkLine className="h-3.5 w-3.5" />
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
              variant="primary"
              size="medium"
              onClick={handleSave}
              disabled={isSaving || isDeleting}
            >
              {t('sandboxProvider.configModal.confirm', { ns: 'common' })}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default memo(ConfigModal)

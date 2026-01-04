import type {
  Credential,
  CustomConfigurationModelFixedFields,
  CustomModelCredential,
  ModelCredential,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { RiAddLine } from '@remixicon/react'
import {
  memo,
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import { ConfigurationMethodEnum, ModelModalModeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { Authorized } from '@/app/components/header/account-setting/model-provider-page/model-auth'
import { cn } from '@/utils/classnames'

type AddCredentialInLoadBalancingProps = {
  provider: ModelProvider
  model: CustomModelCredential
  configurationMethod: ConfigurationMethodEnum
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields
  modelCredential: ModelCredential
  onSelectCredential: (credential: Credential) => void
  onUpdate?: (payload?: any, formValues?: Record<string, any>) => void
  onRemove?: (credentialId: string) => void
}
const AddCredentialInLoadBalancing = ({
  provider,
  model,
  configurationMethod,
  modelCredential,
  onSelectCredential,
  onUpdate,
  onRemove,
}: AddCredentialInLoadBalancingProps) => {
  const { t } = useTranslation()
  const {
    available_credentials,
  } = modelCredential
  const isCustomModel = configurationMethod === ConfigurationMethodEnum.customizableModel
  const notAllowCustomCredential = provider.allow_custom_token === false
  const handleUpdate = useCallback((payload?: any, formValues?: Record<string, any>) => {
    onUpdate?.(payload, formValues)
  }, [onUpdate])

  const renderTrigger = useCallback((open?: boolean) => {
    const Item = (
      <div className={cn(
        'system-sm-medium flex h-8 items-center rounded-lg px-3 text-text-accent hover:bg-state-base-hover',
        open && 'bg-state-base-hover',
      )}
      >
        <RiAddLine className="mr-2 h-4 w-4" />
        {t('modelProvider.auth.addCredential', { ns: 'common' })}
      </div>
    )

    return Item
  }, [t, isCustomModel])

  return (
    <Authorized
      provider={provider}
      renderTrigger={renderTrigger}
      authParams={{
        isModelCredential: isCustomModel,
        mode: ModelModalModeEnum.configModelCredential,
        onUpdate: handleUpdate,
        onRemove,
      }}
      triggerOnlyOpenModal={!available_credentials?.length && !notAllowCustomCredential}
      items={[
        {
          title: isCustomModel ? '' : t('modelProvider.auth.apiKeys', { ns: 'common' }),
          model: isCustomModel ? model : undefined,
          credentials: available_credentials ?? [],
        },
      ]}
      showModelTitle={!isCustomModel}
      configurationMethod={configurationMethod}
      currentCustomConfigurationModelFixedFields={isCustomModel
        ? {
            __model_name: model.model,
            __model_type: model.model_type,
          }
        : undefined}
      onItemClick={onSelectCredential}
      placement="bottom-start"
      popupTitle={isCustomModel ? t('modelProvider.auth.modelCredentials', { ns: 'common' }) : ''}
    />
  )
}

export default memo(AddCredentialInLoadBalancing)

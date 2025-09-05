import {
  memo,
  useCallback,
  useMemo,
} from 'react'
import { RiAddLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { Authorized } from '@/app/components/header/account-setting/model-provider-page/model-auth'
import cn from '@/utils/classnames'
import type {
  Credential,
  CustomModelCredential,
  ModelCredential,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ConfigurationMethodEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import Tooltip from '@/app/components/base/tooltip'

type AddCredentialInLoadBalancingProps = {
  provider: ModelProvider
  model: CustomModelCredential
  configurationMethod: ConfigurationMethodEnum
  modelCredential: ModelCredential
  onSelectCredential: (credential: Credential) => void
  onUpdate?: () => void
}
const AddCredentialInLoadBalancing = ({
  provider,
  model,
  configurationMethod,
  modelCredential,
  onSelectCredential,
  onUpdate,
}: AddCredentialInLoadBalancingProps) => {
  const { t } = useTranslation()
  const {
    available_credentials,
  } = modelCredential
  const customModel = configurationMethod === ConfigurationMethodEnum.customizableModel
  const notAllowCustomCredential = provider.allow_custom_token === false

  const ButtonComponent = useMemo(() => {
    const Item = (
      <div className={cn(
        'system-sm-medium flex h-8 items-center rounded-lg px-3 text-text-accent hover:bg-state-base-hover',
        notAllowCustomCredential && 'cursor-not-allowed opacity-50',
      )}>
        <RiAddLine className='mr-2 h-4 w-4' />
        {
          customModel
            ? t('common.modelProvider.auth.addCredential')
            : t('common.modelProvider.auth.addApiKey')
        }
      </div>
    )

    if (notAllowCustomCredential) {
      return (
        <Tooltip
          asChild
          popupContent={t('plugin.auth.credentialUnavailable')}
        >
          {Item}
        </Tooltip>
      )
    }
    return Item
  }, [notAllowCustomCredential, t, customModel])

  const renderTrigger = useCallback((open?: boolean) => {
    const Item = (
      <div className={cn(
        'system-sm-medium flex h-8 items-center rounded-lg px-3 text-text-accent hover:bg-state-base-hover',
        open && 'bg-state-base-hover',
      )}>
        <RiAddLine className='mr-2 h-4 w-4' />
        {
          customModel
            ? t('common.modelProvider.auth.addCredential')
            : t('common.modelProvider.auth.addApiKey')
        }
      </div>
    )

    return Item
  }, [t, customModel])

  if (!available_credentials?.length)
    return ButtonComponent

  return (
    <Authorized
      provider={provider}
      renderTrigger={renderTrigger}
      items={[
        {
          title: customModel ? t('common.modelProvider.auth.modelCredentials') : t('common.modelProvider.auth.apiKeys'),
          model: customModel ? model : undefined,
          credentials: available_credentials ?? [],
        },
      ]}
      configurationMethod={configurationMethod}
      currentCustomConfigurationModelFixedFields={customModel ? {
        __model_name: model.model,
        __model_type: model.model_type,
      } : undefined}
      onItemClick={onSelectCredential}
      placement='bottom-start'
      onUpdate={onUpdate}
      isModelCredential={customModel}
    />
  )
}

export default memo(AddCredentialInLoadBalancing)

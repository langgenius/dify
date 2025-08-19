import {
  memo,
  useCallback,
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
  const renderTrigger = useCallback((open?: boolean) => {
    return (
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
  }, [])

  return (
    <Authorized
      provider={provider}
      renderTrigger={renderTrigger}
      items={[
        {
          title: customModel ? t('common.modelProvider.auth.modelCredentials') : t('common.modelProvider.auth.apiKeys'),
          model,
          credentials: available_credentials ?? [],
        },
      ]}
      configurationMethod={configurationMethod}
      onItemClick={onSelectCredential}
      placement='bottom-start'
      onUpdate={onUpdate}
      isModelCredential={customModel}
    />
  )
}

export default memo(AddCredentialInLoadBalancing)

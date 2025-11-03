import {
  memo,
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  RiEqualizer2Line,
} from '@remixicon/react'
import {
  Button,
} from '@/app/components/base/button'
import type {
  CustomConfigurationModelFixedFields,
  ModelProvider,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { ConfigurationMethodEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import Authorized from './authorized'
import { useCredentialStatus } from './hooks'
import Tooltip from '@/app/components/base/tooltip'

type ConfigProviderProps = {
  provider: ModelProvider,
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields,
}
const ConfigProvider = ({
  provider,
  currentCustomConfigurationModelFixedFields,
}: ConfigProviderProps) => {
  const { t } = useTranslation()
  const {
    hasCredential,
    authorized,
    current_credential_id,
    current_credential_name,
    available_credentials,
  } = useCredentialStatus(provider)
  const notAllowCustomCredential = provider.allow_custom_token === false

  const renderTrigger = useCallback(() => {
    const text = hasCredential ? t('common.operation.config') : t('common.operation.setup')
    const Item = (
      <Button
        className='flex grow'
        size='small'
        variant={!authorized ? 'secondary-accent' : 'secondary'}
        title={text}
      >
        <RiEqualizer2Line className='mr-1 h-3.5 w-3.5 shrink-0' />
        <span className='w-0 grow truncate text-left'>
          {text}
        </span>
      </Button>
    )
    if (notAllowCustomCredential && !hasCredential) {
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
  }, [authorized, hasCredential, notAllowCustomCredential, t])

  return (
    <Authorized
      provider={provider}
      configurationMethod={ConfigurationMethodEnum.predefinedModel}
      currentCustomConfigurationModelFixedFields={currentCustomConfigurationModelFixedFields}
      items={[
        {
          title: t('common.modelProvider.auth.apiKeys'),
          credentials: available_credentials ?? [],
          selectedCredential: {
            credential_id: current_credential_id ?? '',
            credential_name: current_credential_name ?? '',
          },
        },
      ]}
      showItemSelectedIcon
      showModelTitle
      renderTrigger={renderTrigger}
      triggerOnlyOpenModal={!hasCredential && !notAllowCustomCredential}
    />
  )
}

export default memo(ConfigProvider)

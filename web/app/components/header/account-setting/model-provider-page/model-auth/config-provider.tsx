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
    current_credential_id,
    current_credential_name,
    available_credentials,
    authorized,
    unAuthorized,
  } = useCredentialStatus(provider)
  const notAllowCustomCredential = provider.allow_custom_token === false

  const renderTrigger = useCallback(() => {
    const Item = (
      <Button
        className='grow'
        size='small'
        variant={unAuthorized ? 'secondary-accent' : 'secondary'}
      >
        <RiEqualizer2Line className='mr-1 h-3.5 w-3.5' />
        {!unAuthorized && t('common.operation.config')}
        {unAuthorized && t('common.operation.setup')}
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
  }, [hasCredential, notAllowCustomCredential, t])

  return (
    <Authorized
      provider={provider}
      configurationMethod={ConfigurationMethodEnum.predefinedModel}
      currentCustomConfigurationModelFixedFields={currentCustomConfigurationModelFixedFields}
      items={[
        {
          credentials: available_credentials ?? [],
          selectedCredential: {
            credential_id: current_credential_id ?? '',
            credential_name: current_credential_name ?? '',
          },
        },
      ]}
      showItemSelectedIcon
      renderTrigger={renderTrigger}
      triggerOnlyOpenModal={!hasCredential && !notAllowCustomCredential}
      showDeselect={authorized}
      popupTitle={t('common.modelProvider.auth.apiKeys')}
    />
  )
}

export default memo(ConfigProvider)

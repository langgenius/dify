import {
  memo,
  useCallback,
  useMemo,
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
import { useAuth, useCredentialStatus } from './hooks'
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'

type ConfigProviderProps = {
  provider: ModelProvider,
  configurationMethod: ConfigurationMethodEnum,
  currentCustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields,
}
const ConfigProvider = ({
  provider,
  configurationMethod,
  currentCustomConfigurationModelFixedFields,
}: ConfigProviderProps) => {
  const { t } = useTranslation()
  const {
    handleOpenModal,
  } = useAuth(provider, configurationMethod, currentCustomConfigurationModelFixedFields)
  const {
    hasCredential,
    authorized,
    current_credential_id,
    current_credential_name,
    available_credentials,
  } = useCredentialStatus(provider)
  const notAllowCustomCredential = provider.allow_custom_token === false
  const handleClick = useCallback(() => {
    if (!hasCredential && !notAllowCustomCredential)
      handleOpenModal()
  }, [handleOpenModal, hasCredential, notAllowCustomCredential])
  const ButtonComponent = useMemo(() => {
    const Item = (
      <Button
        className={cn('grow', notAllowCustomCredential && 'cursor-not-allowed opacity-50')}
        size='small'
        onClick={handleClick}
        variant={!authorized ? 'secondary-accent' : 'secondary'}
      >
        <RiEqualizer2Line className='mr-1 h-3.5 w-3.5' />
        {t('common.operation.setup')}
      </Button>
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
  }, [handleClick, authorized, notAllowCustomCredential, t])

  if (!hasCredential)
    return ButtonComponent

  return (
    <Authorized
      provider={provider}
      configurationMethod={ConfigurationMethodEnum.predefinedModel}
      items={[
        {
          title: t('common.modelProvider.auth.apiKeys'),
          credentials: available_credentials ?? [],
        },
      ]}
      selectedCredential={{
        credential_id: current_credential_id ?? '',
        credential_name: current_credential_name ?? '',
      }}
      showItemSelectedIcon
    />
  )
}

export default memo(ConfigProvider)

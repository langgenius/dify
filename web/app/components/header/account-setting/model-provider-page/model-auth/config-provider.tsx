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
  const handleClick = useCallback(() => {
    if (!hasCredential)
      handleOpenModal()
  }, [handleOpenModal, hasCredential])

  const ButtonComponent = useMemo(() => {
    return (
      <Button
        className='grow'
        size='small'
        onClick={handleClick}
        variant={!authorized ? 'secondary-accent' : 'secondary'}
      >
        <RiEqualizer2Line className='mr-1 h-3.5 w-3.5' />
        {t('common.operation.setup')}
      </Button>
    )
  }, [handleClick, authorized])

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

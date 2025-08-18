import type { Dispatch, SetStateAction } from 'react'
import {
  memo,
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'
import Badge from '@/app/components/base/badge'
import Authorized from './authorized'
import type {
  ModelLoadBalancingConfig,
  ModelProvider,
} from '../declarations'
import { ConfigurationMethodEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useCredentialStatus } from './hooks'
import cn from '@/utils/classnames'

type SwitchCredentialInLoadBalancingProps = {
  provider: ModelProvider
  draftConfig?: ModelLoadBalancingConfig
  setDraftConfig: Dispatch<SetStateAction<ModelLoadBalancingConfig | undefined>>
}
const SwitchCredentialInLoadBalancing = ({
  provider,
  draftConfig,
}: SwitchCredentialInLoadBalancingProps) => {
  const { t } = useTranslation()
  const {
    available_credentials,
    current_credential_name,
  } = useCredentialStatus(provider)

  const handleItemClick = useCallback(() => {
    console.log('handleItemClick', draftConfig)
  }, [])

  const renderTrigger = useCallback(() => {
    const selectedCredentialId = draftConfig?.configs.find(config => config.name === '__inherit__')?.credential_id
    const selectedCredential = available_credentials?.find(credential => credential.credential_id === selectedCredentialId)
    const name = selectedCredential?.credential_name || current_credential_name
    const authRemoved = !!selectedCredentialId && !selectedCredential
    return (
      <Button
        variant='secondary'
        className={cn(
          'shrink-0 space-x-1',
          authRemoved && 'text-components-button-destructive-secondary-text',
        )}
      >
        <Indicator
          className='mr-2'
          color={authRemoved ? 'red' : 'green'}
        />
        {
          authRemoved ? t('common.model.authRemoved') : name
        }
        {
          !authRemoved && (
            <Badge>enterprise</Badge>
          )
        }
        <RiArrowDownSLine className='h-4 w-4' />
      </Button>
    )
  }, [current_credential_name, t, draftConfig, available_credentials])

  return (
    <Authorized
      provider={provider}
      configurationMethod={ConfigurationMethodEnum.customizableModel}
      items={[
        {
          model: {
            model: t('common.modelProvider.modelCredentials'),
          } as any,
          credentials: available_credentials || [],
        },
      ]}
      renderTrigger={renderTrigger}
      onItemClick={handleItemClick}
      isModelCredential
      enableAddModelCredential
      bottomAddModelCredentialText={t('common.modelProvider.addModelCredential')}
    />
  )
}

export default memo(SwitchCredentialInLoadBalancing)

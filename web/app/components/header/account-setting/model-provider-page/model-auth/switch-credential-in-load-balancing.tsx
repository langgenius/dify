import type { Dispatch, SetStateAction } from 'react'
import {
  memo,
  useCallback,
} from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine } from '@remixicon/react'
import Button from '@/app/components/base/button'
import Indicator from '@/app/components/header/indicator'
import Authorized from './authorized'
import type {
  Credential,
  CustomModel,
  ModelProvider,
} from '../declarations'
import { ConfigurationMethodEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import cn from '@/utils/classnames'

type SwitchCredentialInLoadBalancingProps = {
  provider: ModelProvider
  model: CustomModel
  credentials?: Credential[]
  customModelCredential?: Credential
  setCustomModelCredential: Dispatch<SetStateAction<Credential | undefined>>
}
const SwitchCredentialInLoadBalancing = ({
  provider,
  model,
  customModelCredential,
  setCustomModelCredential,
  credentials,
}: SwitchCredentialInLoadBalancingProps) => {
  const { t } = useTranslation()

  const handleItemClick = useCallback((credential: Credential) => {
    setCustomModelCredential(credential)
  }, [setCustomModelCredential])

  const renderTrigger = useCallback(() => {
    const selectedCredentialId = customModelCredential?.credential_id
    const authRemoved = !selectedCredentialId && !!credentials?.length
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
          authRemoved ? t('common.modelProvider.auth.authRemoved') : customModelCredential?.credential_name
        }
        <RiArrowDownSLine className='h-4 w-4' />
      </Button>
    )
  }, [customModelCredential, t, credentials])

  return (
    <Authorized
      provider={provider}
      configurationMethod={ConfigurationMethodEnum.customizableModel}
      items={[
        {
          title: t('common.modelProvider.auth.modelCredentials'),
          model,
          credentials: credentials || [],
        },
      ]}
      renderTrigger={renderTrigger}
      onItemClick={handleItemClick}
      isModelCredential
      enableAddModelCredential
      bottomAddModelCredentialText={t('common.modelProvider.auth.addModelCredential')}
      selectedCredential={
        customModelCredential
          ? {
            credential_id: customModelCredential?.credential_id || '',
            credential_name: customModelCredential?.credential_name || '',
          }
          : undefined
      }
      showItemSelectedIcon
    />
  )
}

export default memo(SwitchCredentialInLoadBalancing)

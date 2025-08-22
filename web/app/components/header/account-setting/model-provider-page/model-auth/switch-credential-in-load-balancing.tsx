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
import Tooltip from '@/app/components/base/tooltip'
import Badge from '@/app/components/base/badge'

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
    let color = 'green'
    if (authRemoved && !customModelCredential?.not_allowed_to_use)
      color = 'red'
    if (customModelCredential?.not_allowed_to_use)
      color = 'gray'

    const Item = (
      <Button
        variant='secondary'
        className={cn(
          'shrink-0 space-x-1',
          authRemoved && 'text-components-button-destructive-secondary-text',
          customModelCredential?.not_allowed_to_use && 'cursor-not-allowed opacity-50',
        )}
      >
        <Indicator
          className='mr-2'
          color={color as any}
        />
        {
          authRemoved && !customModelCredential?.not_allowed_to_use && t('common.modelProvider.auth.authRemoved')
        }
        {
          !authRemoved && customModelCredential?.not_allowed_to_use && t('plugin.auth.credentialUnavailable')
        }
        {
          !authRemoved && !customModelCredential?.not_allowed_to_use && customModelCredential?.credential_name
        }
        {
          customModelCredential?.from_enterprise && (
            <Badge className='ml-2'>Enterprise</Badge>
          )
        }
        <RiArrowDownSLine className='h-4 w-4' />
      </Button>
    )
    if (customModelCredential?.not_allowed_to_use) {
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

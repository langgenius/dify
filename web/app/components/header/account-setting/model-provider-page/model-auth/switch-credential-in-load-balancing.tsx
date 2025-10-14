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
import { ConfigurationMethodEnum, ModelModalModeEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import cn from '@/utils/classnames'
import Tooltip from '@/app/components/base/tooltip'
import Badge from '@/app/components/base/badge'

type SwitchCredentialInLoadBalancingProps = {
  provider: ModelProvider
  model: CustomModel
  credentials?: Credential[]
  customModelCredential?: Credential
  setCustomModelCredential: Dispatch<SetStateAction<Credential | undefined>>
  onUpdate?: (payload?: any, formValues?: Record<string, any>) => void
  onRemove?: (credentialId: string) => void
}
const SwitchCredentialInLoadBalancing = ({
  provider,
  model,
  customModelCredential,
  setCustomModelCredential,
  credentials,
  onUpdate,
  onRemove,
}: SwitchCredentialInLoadBalancingProps) => {
  const { t } = useTranslation()
  const notAllowCustomCredential = provider.allow_custom_token === false
  const handleItemClick = useCallback((credential: Credential) => {
    setCustomModelCredential(credential)
  }, [setCustomModelCredential])

  const renderTrigger = useCallback(() => {
    const selectedCredentialId = customModelCredential?.credential_id
    const currentCredential = credentials?.find(c => c.credential_id === selectedCredentialId)
    const empty = !credentials?.length
    const authRemoved = selectedCredentialId && !currentCredential && !empty
    const unavailable = currentCredential?.not_allowed_to_use

    let color = 'green'
    if (authRemoved || unavailable)
      color = 'red'

    const Item = (
      <Button
        variant='secondary'
        className={cn(
          'shrink-0 space-x-1',
          (authRemoved || unavailable) && 'text-components-button-destructive-secondary-text',
          empty && 'cursor-not-allowed opacity-50',
        )}
      >
        {
          !empty && (
            <Indicator
              className='mr-2'
              color={color as any}
            />
          )
        }
        {
          authRemoved && t('common.modelProvider.auth.authRemoved')
        }
        {
          (unavailable || empty) && t('plugin.auth.credentialUnavailableInButton')
        }
        {
          !authRemoved && !unavailable && !empty && customModelCredential?.credential_name
        }
        {
          currentCredential?.from_enterprise && (
            <Badge className='ml-2'>Enterprise</Badge>
          )
        }
        <RiArrowDownSLine className='h-4 w-4' />
      </Button>
    )
    if (empty && notAllowCustomCredential) {
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
  }, [customModelCredential, t, credentials, notAllowCustomCredential])

  return (
    <Authorized
      provider={provider}
      configurationMethod={ConfigurationMethodEnum.customizableModel}
      currentCustomConfigurationModelFixedFields={model ? {
        __model_name: model.model,
        __model_type: model.model_type,
      } : undefined}
      authParams={{
        isModelCredential: true,
        mode: ModelModalModeEnum.configModelCredential,
        onUpdate,
        onRemove,
      }}
      items={[
        {
          model,
          credentials: credentials || [],
          selectedCredential: customModelCredential ? {
            credential_id: customModelCredential?.credential_id || '',
            credential_name: customModelCredential?.credential_name || '',
          } : undefined,
        },
      ]}
      renderTrigger={renderTrigger}
      onItemClick={handleItemClick}
      enableAddModelCredential
      showItemSelectedIcon
      popupTitle={t('common.modelProvider.auth.modelCredentials')}
      triggerOnlyOpenModal={!credentials?.length}
    />
  )
}

export default memo(SwitchCredentialInLoadBalancing)

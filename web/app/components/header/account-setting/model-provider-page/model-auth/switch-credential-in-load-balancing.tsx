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
  Credential,
  ModelLoadBalancingConfig,
  ModelProvider,
} from '../declarations'
import { ConfigurationMethodEnum } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useCredentialStatus } from './hooks'
import { useModelModalHandler } from '../hooks'
import cn from '@/utils/classnames'

type SwitchCredentialInLoadBalancingProps = {
  provider: ModelProvider
  draftConfig?: ModelLoadBalancingConfig
  setDraftConfig: Dispatch<SetStateAction<ModelLoadBalancingConfig | undefined>>
}
const SwitchCredentialInLoadBalancing = ({
  provider,
  draftConfig,
  setDraftConfig,
}: SwitchCredentialInLoadBalancingProps) => {
  const { t } = useTranslation()
  const {
    available_credentials,
    current_credential_name,
  } = useCredentialStatus(provider)
  const handleOpenModal = useModelModalHandler()
  console.log(draftConfig, 'draftConfig')

  const handleSetup = useCallback((credential?: Credential) => {
    handleOpenModal(provider, ConfigurationMethodEnum.predefinedModel, undefined, credential)
  }, [handleOpenModal, provider])

  const handleItemClick = useCallback((id: string) => {
    setDraftConfig((prev) => {
      if (!prev)
        return prev
      const newConfigs = [...prev.configs]
      const index = newConfigs.findIndex(config => config.name === '__inherit__')
      const inheritConfig = newConfigs[index]
      const modifiedConfig = inheritConfig ? {
        ...inheritConfig,
        credential_id: id,
      } : {
        name: '__inherit__',
        credential_id: id,
        credentials: {},
      }
      newConfigs.splice(index, 1, modifiedConfig)
      return {
        ...prev,
        configs: newConfigs,
      }
    })
  }, [setDraftConfig])

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
      provider={provider.provider}
      credentials={available_credentials || []}
      onSetup={handleSetup}
      renderTrigger={renderTrigger}
      onItemClick={handleItemClick}
      disableSetDefault
    />
  )
}

export default memo(SwitchCredentialInLoadBalancing)

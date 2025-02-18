import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { RiEqualizer2Line } from '@remixicon/react'
import type { ModelProvider } from '../declarations'
import {
  ConfigurationMethodEnum,
  CustomConfigurationStatusEnum,
  PreferredProviderTypeEnum,
} from '../declarations'
import {
  useUpdateModelList,
  useUpdateModelProviders,
} from '../hooks'
import PrioritySelector from './priority-selector'
import PriorityUseTip from './priority-use-tip'
import { UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST } from './index'
import Indicator from '@/app/components/header/indicator'
import Button from '@/app/components/base/button'
import { changeModelProviderPriority } from '@/service/common'
import { useToastContext } from '@/app/components/base/toast'
import { useEventEmitterContextContext } from '@/context/event-emitter'

type CredentialPanelProps = {
  provider: ModelProvider
  onSetup: () => void
}
const CredentialPanel: FC<CredentialPanelProps> = ({
  provider,
  onSetup,
}) => {
  const { t } = useTranslation()
  const { notify } = useToastContext()
  const { eventEmitter } = useEventEmitterContextContext()
  const updateModelList = useUpdateModelList()
  const updateModelProviders = useUpdateModelProviders()
  const customConfig = provider.custom_configuration
  const systemConfig = provider.system_configuration
  const priorityUseType = provider.preferred_provider_type
  const isCustomConfigured = customConfig.status === CustomConfigurationStatusEnum.active
  const configurateMethods = provider.configurate_methods

  const handleChangePriority = async (key: PreferredProviderTypeEnum) => {
    const res = await changeModelProviderPriority({
      url: `/workspaces/current/model-providers/${provider.provider}/preferred-provider-type`,
      body: {
        preferred_provider_type: key,
      },
    })
    if (res.result === 'success') {
      notify({ type: 'success', message: t('common.actionMsg.modifiedSuccessfully') })
      updateModelProviders()

      configurateMethods.forEach((method) => {
        if (method === ConfigurationMethodEnum.predefinedModel)
          provider.supported_model_types.forEach(modelType => updateModelList(modelType))
      })

      eventEmitter?.emit({
        type: UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST,
        payload: provider.provider,
      } as any)
    }
  }

  return (
    <>
      {
        provider.provider_credential_schema && (
          <div className='border-components-panel-border relative ml-1 w-[112px] shrink-0 rounded-lg border-[0.5px] bg-white/[0.18] p-1'>
            <div className='system-xs-medium-uppercase text-text-tertiary mb-1 flex h-5 items-center justify-between pl-2 pr-[7px] pt-1'>
              API-KEY
              <Indicator color={isCustomConfigured ? 'green' : 'red'} />
            </div>
            <div className='flex items-center gap-0.5'>
              <Button
                className='grow'
                size='small'
                onClick={onSetup}
              >
                <RiEqualizer2Line className='mr-1 h-3.5 w-3.5' />
                {t('common.operation.setup')}
              </Button>
              {
                systemConfig.enabled && isCustomConfigured && (
                  <PrioritySelector
                    value={priorityUseType}
                    onSelect={handleChangePriority}
                  />
                )
              }
            </div>
            {
              priorityUseType === PreferredProviderTypeEnum.custom && systemConfig.enabled && (
                <PriorityUseTip />
              )
            }
          </div>
        )
      }
      {
        systemConfig.enabled && isCustomConfigured && !provider.provider_credential_schema && (
          <div className='ml-1'>
            <PrioritySelector
              value={priorityUseType}
              onSelect={handleChangePriority}
            />
          </div>
        )
      }
    </>
  )
}

export default CredentialPanel

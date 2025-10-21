import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ModelProvider,
} from '../declarations'
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
import { changeModelProviderPriority } from '@/service/common'
import { useToastContext } from '@/app/components/base/toast'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import cn from '@/utils/classnames'
import { useCredentialStatus } from '@/app/components/header/account-setting/model-provider-page/model-auth/hooks'
import { ConfigProvider } from '@/app/components/header/account-setting/model-provider-page/model-auth'

type CredentialPanelProps = {
  provider: ModelProvider
}
const CredentialPanel = ({
  provider,
}: CredentialPanelProps) => {
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
  const {
    hasCredential,
    authorized,
    authRemoved,
    current_credential_name,
    notAllowedToUse,
  } = useCredentialStatus(provider)

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
  const credentialLabel = useMemo(() => {
    if (!hasCredential)
      return t('common.modelProvider.auth.unAuthorized')
    if (authorized)
      return current_credential_name
    if (authRemoved)
      return t('common.modelProvider.auth.authRemoved')

    return ''
  }, [authorized, authRemoved, current_credential_name, hasCredential])

  const color = useMemo(() => {
    if (authRemoved || !hasCredential)
      return 'red'
    if (notAllowedToUse)
      return 'gray'
    return 'green'
  }, [authRemoved, notAllowedToUse, hasCredential])

  return (
    <>
      {
        provider.provider_credential_schema && (
          <div className={cn(
            'relative ml-1 w-[120px] shrink-0 rounded-lg border-[0.5px] border-components-panel-border bg-white/[0.18] p-1',
            authRemoved && 'border-state-destructive-border bg-state-destructive-hover',
          )}>
            <div className='system-xs-medium mb-1 flex h-5 items-center justify-between pl-2 pr-[7px] pt-1 text-text-tertiary'>
              <div
                className={cn(
                  'grow truncate',
                  authRemoved && 'text-text-destructive',
                )}
                title={credentialLabel}
              >
                {credentialLabel}
              </div>
              <Indicator className='shrink-0' color={color} />
            </div>
            <div className='flex items-center gap-0.5'>
              <ConfigProvider
                provider={provider}
              />
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

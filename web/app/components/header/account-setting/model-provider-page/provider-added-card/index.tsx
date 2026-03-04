import type { FC } from 'react'
import type {
  ModelProvider,
} from '../declarations'
import type { ModelProviderQuotaGetPaid } from '../utils'
import type { PluginDetail } from '@/app/components/plugins/types'
import type { EventEmitterValue } from '@/context/event-emitter'

import { useQuery } from '@tanstack/react-query'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AddCustomModel,
  ManageCustomModelCredentials,
} from '@/app/components/header/account-setting/model-provider-page/model-auth'
import { IS_CE_EDITION } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { useProviderContext } from '@/context/provider-context'
import { consoleQuery } from '@/service/client'
import { cn } from '@/utils/classnames'
import { ConfigurationMethodEnum } from '../declarations'
import ModelBadge from '../model-badge'
import ProviderIcon from '../provider-icon'
import {
  MODEL_PROVIDER_QUOTA_GET_PAID,
  modelTypeFormat,
} from '../utils'
import CredentialPanel from './credential-panel'
import ModelList from './model-list'
import ProviderCardActions from './provider-card-actions'

export const UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST = 'UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST'

const isModelProviderCustomModelListUpdateEvent = (
  value: EventEmitterValue,
  providerName: string,
): value is {
  type: typeof UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST
  payload: string
} => {
  return typeof value === 'object'
    && value !== null
    && value.type === UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST
    && typeof value.payload === 'string'
    && value.payload === providerName
}

type ProviderAddedCardProps = {
  notConfigured?: boolean
  provider: ModelProvider
  pluginDetail?: PluginDetail
}
const ProviderAddedCard: FC<ProviderAddedCardProps> = ({
  notConfigured,
  provider,
  pluginDetail,
}) => {
  const { t } = useTranslation()
  const { eventEmitter } = useEventEmitterContextContext()
  const { refreshModelProviders } = useProviderContext()
  const [collapsed, setCollapsed] = useState(true)
  const currentProviderName = provider.provider
  const supportsPredefinedModel = provider.configurate_methods.includes(ConfigurationMethodEnum.predefinedModel)
  const supportsCustomizableModel = provider.configurate_methods.includes(ConfigurationMethodEnum.customizableModel)
  const systemConfig = provider.system_configuration
  const {
    data: modelList = [],
    isFetching: loading,
    isSuccess: hasFetchedModelList,
    refetch: refetchModelList,
  } = useQuery(consoleQuery.modelProviders.models.queryOptions({
    input: { params: { provider: currentProviderName } },
    enabled: !collapsed,
    refetchOnWindowFocus: false,
    select: response => response.data,
  }))
  const hasModelList = hasFetchedModelList && !!modelList.length
  const showCollapsedSection = collapsed || !hasFetchedModelList
  const { isCurrentWorkspaceManager } = useAppContext()
  const showModelProvider = systemConfig.enabled && MODEL_PROVIDER_QUOTA_GET_PAID.includes(currentProviderName as ModelProviderQuotaGetPaid) && !IS_CE_EDITION
  const showCredential = supportsPredefinedModel && isCurrentWorkspaceManager
  const showCustomModelActions = supportsCustomizableModel && isCurrentWorkspaceManager

  const refreshModelList = useCallback((targetProviderName: string) => {
    if (targetProviderName !== currentProviderName)
      return

    if (collapsed)
      setCollapsed(false)

    refetchModelList().catch(() => {})
  }, [collapsed, currentProviderName, refetchModelList])

  const handleOpenModelList = useCallback(() => {
    if (loading)
      return

    if (collapsed) {
      setCollapsed(false)
      return
    }

    refetchModelList().catch(() => {})
  }, [collapsed, loading, refetchModelList])

  const handleModelProviderCustomModelListUpdate = useCallback((value: EventEmitterValue) => {
    if (!isModelProviderCustomModelListUpdateEvent(value, currentProviderName))
      return

    refreshModelList(currentProviderName)
  }, [currentProviderName, refreshModelList])

  eventEmitter?.useSubscription(handleModelProviderCustomModelListUpdate)

  return (
    <div
      data-testid="provider-added-card"
      className={cn(
        'mb-2 rounded-xl border-[0.5px] border-divider-regular bg-third-party-model-bg-default shadow-xs',
        currentProviderName === 'langgenius/openai/openai' && 'bg-third-party-model-bg-openai',
        currentProviderName === 'langgenius/anthropic/anthropic' && 'bg-third-party-model-bg-anthropic',
      )}
    >
      <div className="flex rounded-t-xl py-2 pl-3 pr-2">
        <div className="grow px-1 pb-0.5 pt-1">
          <div className="mb-2 flex items-center gap-1">
            <ProviderIcon provider={provider} />
            {pluginDetail && (
              <ProviderCardActions
                detail={pluginDetail}
                onUpdate={refreshModelProviders}
              />
            )}
          </div>
          <div className="flex gap-0.5">
            {provider.supported_model_types.map(modelType => (
              <ModelBadge key={modelType}>
                {modelTypeFormat(modelType)}
              </ModelBadge>
            ))}
          </div>
        </div>
        {showCredential && (
          <CredentialPanel
            provider={provider}
          />
        )}
      </div>
      {
        showCollapsedSection && (
          <div className="group flex items-center justify-between border-t border-t-divider-subtle py-1.5 pl-2 pr-[11px] text-text-tertiary system-xs-medium">
            {(showModelProvider || !notConfigured) && (
              <>
                <div className="flex h-6 items-center pl-1 pr-1.5 leading-6 group-hover:hidden">
                  {
                    hasModelList
                      ? t('modelProvider.modelsNum', { ns: 'common', num: modelList.length })
                      : t('modelProvider.showModels', { ns: 'common' })
                  }
                  {!loading && <div className="i-ri-arrow-right-s-line h-4 w-4" />}
                </div>
                <div
                  data-testid="show-models-button"
                  className="hidden h-6 cursor-pointer items-center rounded-lg pl-1 pr-1.5 hover:bg-components-button-ghost-bg-hover group-hover:flex"
                  onClick={handleOpenModelList}
                >
                  {
                    hasModelList
                      ? t('modelProvider.showModelsNum', { ns: 'common', num: modelList.length })
                      : t('modelProvider.showModels', { ns: 'common' })
                  }
                  {!loading && <div className="i-ri-arrow-right-s-line h-4 w-4" />}
                  {
                    loading && (
                      <div className="i-ri-loader-2-line ml-0.5 h-3 w-3 animate-spin" />
                    )
                  }
                </div>
              </>
            )}
            {!showModelProvider && notConfigured && (
              <div className="flex h-6 items-center pl-1 pr-1.5">
                <div className="i-ri-information-2-fill mr-1 h-4 w-4 text-text-accent" />
                <span className="text-text-secondary system-xs-medium">{t('modelProvider.configureTip', { ns: 'common' })}</span>
              </div>
            )}
            {
              showCustomModelActions && (
                <div className="flex grow justify-end">
                  <ManageCustomModelCredentials
                    provider={provider}
                    currentCustomConfigurationModelFixedFields={undefined}
                  />
                  <AddCustomModel
                    provider={provider}
                    configurationMethod={ConfigurationMethodEnum.customizableModel}
                    currentCustomConfigurationModelFixedFields={undefined}
                  />
                </div>
              )
            }
          </div>
        )
      }
      {
        !showCollapsedSection && (
          <ModelList
            provider={provider}
            models={modelList}
            onCollapse={() => setCollapsed(true)}
            onChange={refreshModelList}
          />
        )
      }
    </div>
  )
}

export default ProviderAddedCard

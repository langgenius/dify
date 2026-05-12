import type { FC } from 'react'
import type {
  ModelProvider,
} from '../declarations'
import type { ModelProviderQuotaGetPaid } from '../utils'
import type { PluginDetail } from '@/app/components/plugins/types'

import { cn } from '@langgenius/dify-ui/cn'
import { useQuery } from '@tanstack/react-query'
import { memo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AddCustomModel,
  ManageCustomModelCredentials,
} from '@/app/components/header/account-setting/model-provider-page/model-auth'
import { IS_CE_EDITION } from '@/config'
import { useAppContext } from '@/context/app-context'
import { useProviderContextSelector } from '@/context/provider-context'
import { consoleQuery } from '@/service/client'
import { useModelProviderListExpanded, useSetModelProviderListExpanded } from '../atoms'
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
  const refreshModelProviders = useProviderContextSelector(state => state.refreshModelProviders)
  const currentProviderName = provider.provider
  const expanded = useModelProviderListExpanded(currentProviderName)
  const setExpanded = useSetModelProviderListExpanded(currentProviderName)
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
    enabled: expanded,
    refetchOnWindowFocus: false,
    select: response => response.data,
  }))
  const hasModelList = hasFetchedModelList && !!modelList.length
  const showCollapsedSection = !expanded || !hasFetchedModelList
  const { isCurrentWorkspaceManager } = useAppContext()
  const showModelProvider = systemConfig.enabled && MODEL_PROVIDER_QUOTA_GET_PAID.includes(currentProviderName as ModelProviderQuotaGetPaid) && !IS_CE_EDITION
  const showCredential = supportsPredefinedModel && isCurrentWorkspaceManager
  const showCustomModelActions = supportsCustomizableModel && isCurrentWorkspaceManager

  const refreshModelList = useCallback((targetProviderName: string) => {
    if (targetProviderName !== currentProviderName)
      return

    if (!expanded)
      setExpanded(true)

    refetchModelList().catch(() => {})
  }, [currentProviderName, expanded, refetchModelList, setExpanded])

  const handleOpenModelList = useCallback(() => {
    if (loading)
      return

    if (!expanded) {
      setExpanded(true)
      return
    }

    refetchModelList().catch(() => {})
  }, [expanded, loading, refetchModelList, setExpanded])

  return (
    <div
      data-testid="provider-added-card"
      className={cn(
        'mb-2 rounded-xl border-[0.5px] border-divider-regular bg-third-party-model-bg-default shadow-xs',
        currentProviderName === 'langgenius/openai/openai' && 'bg-third-party-model-bg-openai',
        currentProviderName === 'langgenius/anthropic/anthropic' && 'bg-third-party-model-bg-anthropic',
      )}
    >
      <div className="flex rounded-t-xl py-2 pr-2 pl-3">
        <div className="grow px-1 pt-1 pb-0.5">
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
          <div className="group flex items-center justify-between border-t border-t-divider-subtle py-1.5 pr-[11px] pl-2 system-xs-medium text-text-tertiary">
            {(showModelProvider || !notConfigured) && (
              <button
                type="button"
                className="flex h-6 items-center rounded-lg border-none bg-transparent pr-1.5 pl-1 text-left hover:bg-components-button-ghost-bg-hover"
                aria-label={t('modelProvider.showModels', { ns: 'common' })}
                onClick={handleOpenModelList}
              >
                {
                  hasModelList
                    ? t('modelProvider.modelsNum', { ns: 'common', num: modelList.length })
                    : t('modelProvider.showModels', { ns: 'common' })
                }
                {!loading && <div className="i-ri-arrow-right-s-line h-4 w-4" aria-hidden="true" />}
                {
                  loading && (
                    <div className="ml-0.5 i-ri-loader-2-line h-3 w-3 animate-spin" />
                  )
                }
              </button>
            )}
            {!showModelProvider && notConfigured && (
              <div className="flex h-6 items-center pr-1.5 pl-1">
                <div className="mr-1 i-ri-information-2-fill h-4 w-4 text-text-accent" />
                <span className="system-xs-medium text-text-secondary">{t('modelProvider.configureTip', { ns: 'common' })}</span>
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
            onCollapse={() => setExpanded(false)}
            onChange={refreshModelList}
          />
        )
      }
    </div>
  )
}

export default memo(ProviderAddedCard)

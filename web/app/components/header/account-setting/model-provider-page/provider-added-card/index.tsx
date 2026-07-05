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
import { useSelector as useAppContextWithSelector } from '@/context/app-context'
import { useProviderContextSelector } from '@/context/provider-context'
import { useCredentialPermissions } from '@/hooks/use-credential-permissions'
import { renderI18nObject } from '@/i18n-config'
import { consoleQuery } from '@/service/client'
import { hasPermission } from '@/utils/permission'
import { useModelProviderListExpanded, useSetModelProviderListExpanded } from '../atoms'
import { ConfigurationMethodEnum } from '../declarations'
import { useLanguage } from '../hooks'
import ModelBadge from '../model-badge'
import ProviderIcon from '../provider-icon'
import {
  MODEL_PROVIDER_QUOTA_GET_PAID,
  modelTypeFormat,
  normalizeModelProviderModelsResponse,
} from '../utils'
import CredentialPanel from './credential-panel'
import ModelList from './model-list'
import ProviderCardActions from './provider-card-actions'

type ProviderAddedCardProps = {
  layout?: 'list' | 'grid'
  notConfigured?: boolean
  provider: ModelProvider
  pluginDetail?: PluginDetail
}
const ProviderAddedCard: FC<ProviderAddedCardProps> = ({
  layout = 'list',
  notConfigured,
  provider,
  pluginDetail,
}) => {
  const { t } = useTranslation()
  const language = useLanguage()
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
  } = useQuery(consoleQuery.workspaces.current.modelProviders.byProvider.models.get.queryOptions({
    input: { params: { provider: currentProviderName } },
    enabled: expanded,
    refetchOnWindowFocus: false,
    select: normalizeModelProviderModelsResponse,
  }))
  const hasModelList = hasFetchedModelList && !!modelList.length
  const showCollapsedSection = !expanded || !hasFetchedModelList
  const workspacePermissionKeys = useAppContextWithSelector(state => state.workspacePermissionKeys)
  const showModelProvider = systemConfig.enabled && MODEL_PROVIDER_QUOTA_GET_PAID.includes(currentProviderName as ModelProviderQuotaGetPaid) && !IS_CE_EDITION
  const canConfigureModels = hasPermission(workspacePermissionKeys, 'plugin.model_config')
  const { canUseCredential, canCreateCredential, canManageCredential } = useCredentialPermissions()
  const canAccessCredentials = canUseCredential || canCreateCredential || canManageCredential
  const showCredential = supportsPredefinedModel && canAccessCredentials
  const showCustomModelActions = supportsCustomizableModel && canConfigureModels

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

  const providerLabel = renderI18nObject(provider.label, language)
  const description = renderI18nObject(
    provider.description || pluginDetail?.declaration.description || provider.help?.title || provider.label,
    language,
  )
  const organization = pluginDetail?.declaration.author || currentProviderName.split('/')[0]

  if (layout === 'grid') {
    return (
      <div
        className={cn(
          'group relative mb-0 min-h-[120px] overflow-hidden rounded-xl border-[0.5px] border-divider-regular bg-components-panel-on-panel-item-bg shadow-xs',
          currentProviderName === 'langgenius/openai/openai' && 'bg-third-party-model-bg-openai',
          currentProviderName === 'langgenius/anthropic/anthropic' && 'bg-third-party-model-bg-anthropic',
        )}
      >
        <div className="p-4 pb-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background-default-subtle">
              <img
                alt=""
                src={renderI18nObject(provider.icon_small, language)}
                width={40}
                height={40}
                className="size-10 rounded-lg object-contain"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex h-5 min-w-0 items-center gap-1">
                <div className="truncate system-md-semibold text-text-secondary" title={providerLabel}>
                  {providerLabel}
                </div>
                {pluginDetail && (
                  <ProviderCardActions
                    detail={pluginDetail}
                    onUpdate={refreshModelProviders}
                  />
                )}
              </div>
              <div className="mt-0.5 flex h-4 min-w-0 items-center gap-2 system-xs-regular text-text-tertiary">
                <span className="truncate" title={organization}>{organization}</span>
              </div>
            </div>
          </div>
          <div className="mt-3 line-clamp-2 h-8 system-xs-regular text-text-tertiary">
            {description}
          </div>
          <div className="mt-3 flex min-w-0 gap-0.5 overflow-hidden">
            {provider.supported_model_types.slice(0, 4).map(modelType => (
              <ModelBadge key={modelType}>
                {modelTypeFormat(modelType)}
              </ModelBadge>
            ))}
          </div>
        </div>
        <div className="absolute right-0 bottom-0 left-0 hidden min-h-20 flex-wrap items-end gap-2 rounded-xl bg-linear-to-t from-components-panel-on-panel-item-bg via-components-panel-on-panel-item-bg to-background-gradient-mask-transparent p-4 group-focus-within:flex group-hover:flex">
          {(showModelProvider || !notConfigured) && (
            <button
              type="button"
              className="flex h-8 min-w-0 flex-1 items-center justify-center rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3 system-sm-medium text-components-button-secondary-text shadow-xs hover:bg-components-button-secondary-bg-hover"
              aria-label={t('modelProvider.showModels', { ns: 'common' })}
              onClick={handleOpenModelList}
            >
              <span className="truncate">
                {
                  hasModelList
                    ? t('modelProvider.modelsNum', { ns: 'common', num: modelList.length })
                    : t('modelProvider.showModels', { ns: 'common' })
                }
              </span>
              {!loading && <span aria-hidden className="ml-1 i-ri-arrow-right-s-line size-4 shrink-0" />}
              {loading && <span aria-hidden className="ml-1 i-ri-loader-2-line size-3 animate-spin" />}
            </button>
          )}
          {!showModelProvider && notConfigured && (
            <div className="flex h-8 min-w-0 flex-1 items-center justify-center rounded-lg bg-background-default-subtle px-2">
              <span aria-hidden className="mr-1 i-ri-information-2-fill size-4 shrink-0 text-text-accent" />
              <span className="truncate system-xs-medium text-text-secondary">{t('modelProvider.configureTip', { ns: 'common' })}</span>
            </div>
          )}
          {showCredential && (
            <CredentialPanel
              provider={provider}
            />
          )}
          {showCustomModelActions && (
            <div className="flex shrink-0">
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
          )}
        </div>
        {!showCollapsedSection && (
          <div className="px-2 pb-2">
            <ModelList
              provider={provider}
              models={modelList}
              onCollapse={() => setExpanded(false)}
              onChange={refreshModelList}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      data-testid="provider-added-card"
      className={cn(
        'rounded-xl border-[0.5px] border-divider-regular bg-third-party-model-bg-default shadow-xs',
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
          <div className="group flex items-center justify-between border-t border-t-divider-subtle py-1.5 pr-2.75 pl-2 system-xs-medium text-text-tertiary">
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
                {!loading && <div className="i-ri-arrow-right-s-line size-4" aria-hidden="true" />}
                {
                  loading && (
                    <div className="ml-0.5 i-ri-loader-2-line size-3 animate-spin" />
                  )
                }
              </button>
            )}
            {!showModelProvider && notConfigured && (
              <div className="flex h-6 items-center pr-1.5 pl-1">
                <div className="mr-1 i-ri-information-2-fill size-4 text-text-accent" />
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

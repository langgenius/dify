import type { DefaultModel, Model } from '../declarations'
import type { ModelSelectorPreviewPayload } from './popup-item'
import type { ModelSelectorModelPredicate } from './types'
import type { ModelProviderQuotaGetPaid } from '@/types/model-provider'
import { ComboboxList } from '@langgenius/dify-ui/combobox'
import { createPreviewCardHandle, PreviewCard, PreviewCardContent } from '@langgenius/dify-ui/preview-card'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ACCOUNT_SETTING_MODAL_ACTION, ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import { useIntegrationsSetting } from '@/app/components/header/account-setting/use-integrations-setting'
import checkTaskStatus from '@/app/components/plugins/install-plugin/base/check-task-status'
import useRefreshPluginList from '@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list'
import useWorkspacePluginInstallPermission from '@/app/components/plugins/install-plugin/hooks/use-workspace-plugin-install-permission'
import { IS_CLOUD_EDITION } from '@/config'
import { useProviderContext } from '@/context/provider-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { useSearchParams } from '@/next/navigation'
import { consoleQuery } from '@/service/client'
import { useInstallPackageFromMarketPlace } from '@/service/use-plugins'
import { CustomConfigurationStatusEnum, ModelFeatureEnum, ModelStatusEnum, ModelTypeEnum } from '../declarations'
import { useLanguage, useMarketplaceAllPlugins } from '../hooks'
import ModelBadge from '../model-badge'
import ModelIcon from '../model-icon'
import CreditsExhaustedAlert from '../provider-added-card/model-auth-dropdown/credits-exhausted-alert'
import { useTrialCredits } from '../provider-added-card/use-trial-credits'
import { providerSupportsCredits } from '../supports-credits'
import { MODEL_PROVIDER_QUOTA_GET_PAID, modelTypeFormat, providerKeyToPluginId, sizeFormat } from '../utils'
import FeatureIcon from './feature-icon'
import MarketplaceSection from './marketplace-section'
import { createModelSelectorSearchIndex, filterModelSelectorModels } from './model-search'
import ModelSelectorEmptyState from './popup-empty-state'
import PopupItem from './popup-item'
import { CompatibleModelsNotice, ModelProviderSettingsFooter, ModelSelectorPopupFrame, ModelSelectorScrollBody, ModelSelectorSearchHeader, ShowIncompatibleModelsButton } from './popup-layout'

export type PopupProps = {
  defaultModel?: DefaultModel
  inputValue: string
  modelList: Model[]
  scopeFeatures?: ModelFeatureEnum[]
  hideProviderSettingsFooter?: boolean
  providerSettingsSource?: 'agent'
  modelPredicate?: ModelSelectorModelPredicate
  modelSuggestionPredicate?: ModelSelectorModelPredicate
  onConfigureEmptyState?: () => void
  onInputValueChange: (value: string) => void
  onOpenMarketplace?: () => void
  onHide: () => void
}
function Popup({
  defaultModel,
  inputValue,
  modelList,
  scopeFeatures = [],
  hideProviderSettingsFooter,
  providerSettingsSource,
  modelPredicate,
  modelSuggestionPredicate,
  onConfigureEmptyState,
  onInputValueChange,
  onOpenMarketplace,
  onHide,
}: PopupProps) {
  const { t } = useTranslation()
  const searchParams = useSearchParams()
  const { theme } = useTheme()
  const language = useLanguage()
  const previewCardHandle = useMemo(() => createPreviewCardHandle<ModelSelectorPreviewPayload>(), [])
  const [marketplaceCollapsed, setMarketplaceCollapsed] = useState(false)
  const [showIncompatibleModels, setShowIncompatibleModels] = useState(false)
  const openIntegrationsSetting = useIntegrationsSetting()
  const { modelProviders } = useProviderContext()
  const { data: enableMarketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: systemFeatures => systemFeatures.enable_marketplace,
  })
  const {
    plugins: allPlugins,
    isLoading: isMarketplacePluginsLoading,
  } = useMarketplaceAllPlugins(modelProviders, '', enableMarketplace)
  const { mutateAsync: installPackageFromMarketPlace } = useInstallPackageFromMarketPlace()
  const { refreshPluginList } = useRefreshPluginList()
  const { canInstallPlugin } = useWorkspacePluginInstallPermission()
  const [installingProvider, setInstallingProvider] = useState<ModelProviderQuotaGetPaid | null>(null)
  const { isExhausted: isCreditsExhausted } = useTrialCredits()
  const { data: trialModels = [] } = useQuery(consoleQuery.trialModels.get.queryOptions({
    enabled: IS_CLOUD_EDITION,
    select: data => data.trial_models,
  }))
  const installedProviderMap = useMemo(() => new Map(
    modelProviders.map(provider => [provider.provider, provider]),
  ), [modelProviders])
  const aiCreditVisibleProviders = useMemo(() => {
    if (!enableMarketplace || isCreditsExhausted)
      return new Set<string>()

    return new Set(
      modelProviders
        .filter(provider => providerSupportsCredits(provider, trialModels))
        .map(provider => provider.provider),
    )
  }, [enableMarketplace, isCreditsExhausted, modelProviders, trialModels])
  const showCreditsExhaustedAlert = enableMarketplace
    && isCreditsExhausted
    && modelProviders.some(provider => providerSupportsCredits(provider, trialModels))
  const hasApiKeyFallback = modelProviders.some((provider) => {
    const isApiKeyActive = provider.custom_configuration?.status === CustomConfigurationStatusEnum.active
    return isApiKeyActive && providerSupportsCredits(provider, trialModels)
  })

  const handleInstallPlugin = useCallback(async (key: ModelProviderQuotaGetPaid) => {
    if (!enableMarketplace || !canInstallPlugin || !allPlugins || isMarketplacePluginsLoading || installingProvider)
      return
    const pluginId = providerKeyToPluginId[key]
    const plugin = allPlugins.find(p => p.plugin_id === pluginId)
    if (!plugin)
      return

    const uniqueIdentifier = plugin.latest_package_identifier
    setInstallingProvider(key)
    try {
      const { all_installed, task_id } = await installPackageFromMarketPlace(uniqueIdentifier)
      if (!all_installed) {
        const { check } = checkTaskStatus()
        await check({ taskId: task_id, pluginUniqueIdentifier: uniqueIdentifier })
      }
      refreshPluginList(plugin)
    }
    catch { }
    finally {
      setInstallingProvider(null)
    }
  }, [allPlugins, enableMarketplace, canInstallPlugin, installPackageFromMarketPlace, installingProvider, isMarketplacePluginsLoading, refreshPluginList])

  const installedModelList = useMemo(() => {
    const modelMap = new Map(modelList.map(model => [model.provider, model]))
    const installedMarketplaceModels = MODEL_PROVIDER_QUOTA_GET_PAID.flatMap((providerKey) => {
      const installedProvider = installedProviderMap.get(providerKey)

      if (!installedProvider)
        return []

      const matchedModel = modelMap.get(providerKey)
      if (matchedModel)
        return [matchedModel]

      if (!aiCreditVisibleProviders.has(providerKey))
        return []

      return [{
        provider: installedProvider.provider,
        icon_small: installedProvider.icon_small,
        icon_small_dark: installedProvider.icon_small_dark,
        label: installedProvider.label,
        models: [],
        status: ModelStatusEnum.active,
      }]
    })
    const otherModels = modelList.filter(model => !MODEL_PROVIDER_QUOTA_GET_PAID.includes(model.provider as ModelProviderQuotaGetPaid))

    return [...installedMarketplaceModels, ...otherModels]
  }, [aiCreditVisibleProviders, installedProviderMap, modelList])

  const searchIndex = useMemo(
    () => createModelSelectorSearchIndex(installedModelList, language),
    [installedModelList, language],
  )
  const filteredModelList = useMemo(() => filterModelSelectorModels({
    aiCreditVisibleProviders,
    defaultModel,
    inputValue,
    installedModelList,
    modelPredicate: showIncompatibleModels ? undefined : modelPredicate,
    scopeFeatures,
    searchIndex,
  }), [aiCreditVisibleProviders, defaultModel, inputValue, installedModelList, modelPredicate, scopeFeatures, searchIndex, showIncompatibleModels])
  const shouldShowModelPredicateReveal = !!modelPredicate

  const marketplaceProviders = useMemo(() => {
    if (!enableMarketplace)
      return []

    const installedProviders = new Set(modelProviders.map(provider => provider.provider))
    return MODEL_PROVIDER_QUOTA_GET_PAID.filter(key => !installedProviders.has(key))
  }, [enableMarketplace, modelProviders])

  const handleOpenSettings = useCallback(() => {
    onHide()
    openIntegrationsSetting({ payload: ACCOUNT_SETTING_TAB.PROVIDER, source: providerSettingsSource })
  }, [onHide, openIntegrationsSetting, providerSettingsSource])
  const handleClosePreviewCard = useCallback(() => {
    previewCardHandle.close()
  }, [previewCardHandle])
  const isProviderSettingsCurrentPage = searchParams?.get('action') === ACCOUNT_SETTING_MODAL_ACTION
    && searchParams?.get('tab') === ACCOUNT_SETTING_TAB.PROVIDER
  const handleConfigureEmptyState = onConfigureEmptyState ?? (isProviderSettingsCurrentPage ? onHide : handleOpenSettings)

  return (
    <ModelSelectorPopupFrame>
      <ModelSelectorSearchHeader
        inputValue={inputValue}
        onInputValueChange={onInputValueChange}
      />
      {showCreditsExhaustedAlert && (
        <CreditsExhaustedAlert hasApiKeyFallback={hasApiKeyFallback} />
      )}
      <ModelSelectorScrollBody label={t('modelProvider.models', { ns: 'common' })}>
        <ComboboxList className="max-h-none overflow-visible p-0">
          <div className="pb-1">
            {
              filteredModelList.map(model => (
                <PopupItem
                  key={model.provider}
                  defaultModel={defaultModel}
                  model={model}
                  modelPredicate={modelPredicate}
                  modelSuggestionPredicate={modelSuggestionPredicate}
                  previewCardHandle={previewCardHandle}
                  onPreviewCardClose={handleClosePreviewCard}
                  onHide={onHide}
                />
              ))
            }
          </div>
        </ComboboxList>
        <div className="pb-1">
          {!filteredModelList.length && !installedModelList.length && (
            <ModelSelectorEmptyState
              onConfigure={handleConfigureEmptyState}
            />
          )}
          {!filteredModelList.length && installedModelList.length > 0 && (
            <div className="px-3 py-1.5 text-center text-xs/4.5 break-all text-text-tertiary">
              {t('modelProvider.selector.noModelFoundForSearch', { ns: 'common', query: inputValue })}
            </div>
          )}
          {scopeFeatures.length > 0 && (
            <CompatibleModelsNotice />
          )}
          {shouldShowModelPredicateReveal && (
            <ShowIncompatibleModelsButton
              showIncompatibleModels={showIncompatibleModels}
              onClick={() => setShowIncompatibleModels(value => !value)}
            />
          )}
          {enableMarketplace && (
            <MarketplaceSection
              marketplaceProviders={marketplaceProviders}
              marketplaceCollapsed={marketplaceCollapsed}
              installingProvider={installingProvider}
              isMarketplacePluginsLoading={isMarketplacePluginsLoading}
              canInstallPlugin={canInstallPlugin}
              theme={theme}
              onMarketplaceCollapsedChange={setMarketplaceCollapsed}
              onInstallPlugin={handleInstallPlugin}
              onOpenMarketplace={onOpenMarketplace}
            />
          )}
        </div>
      </ModelSelectorScrollBody>
      <PreviewCard handle={previewCardHandle}>
        {({ payload }) => (
          <ModelSelectorPreviewCard
            capabilitiesLabel={t('model.capabilities', { ns: 'common' })}
            language={language}
            payload={payload as ModelSelectorPreviewPayload | undefined}
          />
        )}
      </PreviewCard>
      {!hideProviderSettingsFooter && !isProviderSettingsCurrentPage && (
        <ModelProviderSettingsFooter onOpenSettings={handleOpenSettings} />
      )}
    </ModelSelectorPopupFrame>
  )
}

type ModelSelectorPreviewCardProps = {
  capabilitiesLabel: string
  language: string
  payload?: ModelSelectorPreviewPayload
}

function ModelSelectorPreviewCard({
  capabilitiesLabel,
  language,
  payload,
}: ModelSelectorPreviewCardProps) {
  if (!payload)
    return null

  const { provider, modelItem } = payload

  return (
    <PreviewCardContent
      placement="right"
      popupClassName="w-[206px] bg-components-panel-bg-blur p-3 shadow-none backdrop-blur-xs"
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-col items-start gap-2">
          <ModelIcon
            className="size-5 shrink-0"
            provider={provider}
            modelName={modelItem.model}
          />
          <div className="system-md-medium text-wrap wrap-break-word text-text-primary">{modelItem.label[language] || modelItem.label.en_US}</div>
        </div>
        <div className="flex flex-wrap gap-1">
          {!!modelItem.model_type && (
            <ModelBadge>
              {modelTypeFormat(modelItem.model_type)}
            </ModelBadge>
          )}
          {!!modelItem.model_properties.mode && (
            <ModelBadge>
              {(modelItem.model_properties.mode as string).toLocaleUpperCase()}
            </ModelBadge>
          )}
          {!!modelItem.model_properties.context_size && (
            <ModelBadge>
              {sizeFormat(modelItem.model_properties.context_size as number)}
            </ModelBadge>
          )}
        </div>
        {[ModelTypeEnum.textGeneration, ModelTypeEnum.textEmbedding, ModelTypeEnum.rerank].includes(modelItem.model_type as ModelTypeEnum)
          && modelItem.features?.some(feature => [ModelFeatureEnum.vision, ModelFeatureEnum.audio, ModelFeatureEnum.video, ModelFeatureEnum.document].includes(feature))
          && (
            <div className="pt-2">
              <div className="mb-1 system-2xs-medium-uppercase text-text-tertiary">{capabilitiesLabel}</div>
              <div className="flex flex-wrap gap-1">
                {modelItem.features?.map(feature => (
                  <FeatureIcon
                    key={feature}
                    feature={feature}
                    showFeaturesLabel
                  />
                ))}
              </div>
            </div>
          )}
      </div>
    </PreviewCardContent>
  )
}

export default Popup

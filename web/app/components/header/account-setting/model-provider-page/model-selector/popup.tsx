import type { ModelSelectorPreviewPayload } from './popup-item'
import type {
  ModelSelectorModel,
  ModelSelectorModelPredicate,
  ModelSelectorProvider,
  ModelSelectorValue,
} from './types'
import type { ModelProviderQuotaGetPaid } from '@/types/model-provider'
import {
  createPreviewCardHandle,
  PreviewCard,
  PreviewCardContent,
} from '@langgenius/dify-ui/preview-card'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import checkTaskStatus from '@/app/components/plugins/install-plugin/base/check-task-status'
import useRefreshPluginList from '@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list'
import useWorkspacePluginInstallPermission from '@/app/components/plugins/install-plugin/hooks/use-workspace-plugin-install-permission'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { useProviderContext } from '@/context/provider-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { renderI18nObject } from '@/i18n-config'
import { consoleQuery } from '@/service/client'
import { fetchPluginInfoFromMarketPlace } from '@/service/plugins'
import { useInstallPackageFromMarketPlace } from '@/service/use-plugins'
import { CustomConfigurationStatusEnum, ModelFeatureEnum, ModelTypeEnum } from '../declarations'
import { useLanguage } from '../hooks'
import ModelBadge from '../model-badge'
import ModelIcon from '../model-icon'
import CreditsExhaustedAlert from '../provider-added-card/model-auth-dropdown/credits-exhausted-alert'
import { useTrialCredits } from '../provider-added-card/use-trial-credits'
import { providerSupportsCredits } from '../supports-credits'
import {
  MODEL_PROVIDER_QUOTA_GET_PAID,
  modelTypeFormat,
  providerKeyToPluginId,
  sizeFormat,
} from '../utils'
import FeatureIcon from './feature-icon'
import MarketplaceSection from './marketplace-section'
import { createModelSelectorSearchIndex, filterModelSelectorModels } from './model-search'
import ModelSelectorEmptyState from './popup-empty-state'
import PopupItem from './popup-item'
import {
  CompatibleModelsNotice,
  ModelProviderSettingsFooter,
  ModelSelectorScrollBody,
  ModelSelectorSearchHeader,
  ShowIncompatibleModelsButton,
} from './popup-layout'

export type PopupProps = {
  defaultModel?: ModelSelectorValue
  inputValue: string
  modelList: ModelSelectorProvider[]
  scopeFeatures?: readonly string[]
  onOpenProviderSettings?: () => void
  modelPredicate?: ModelSelectorModelPredicate
  modelSuggestionPredicate?: ModelSelectorModelPredicate
  onConfigureEmptyState?: () => void
  onInputValueChange: (value: string) => void
  onSelect: (provider: string, model: ModelSelectorModel) => void
  onOpenMarketplace?: () => void
  onHide: () => void
}
function Popup({
  defaultModel,
  inputValue,
  modelList,
  scopeFeatures = [],
  onOpenProviderSettings,
  modelPredicate,
  modelSuggestionPredicate,
  onConfigureEmptyState,
  onInputValueChange,
  onSelect,
  onOpenMarketplace,
  onHide,
}: PopupProps) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const language = useLanguage()
  const previewCardHandle = useMemo(
    () => createPreviewCardHandle<ModelSelectorPreviewPayload>(),
    [],
  )
  const [marketplaceCollapsed, setMarketplaceCollapsed] = useState(false)
  const [showIncompatibleModels, setShowIncompatibleModels] = useState(false)
  const { modelProviders, modelProviderPlugins = {} } = useProviderContext()
  const { data: enableMarketplace } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: (systemFeatures) => systemFeatures.enable_marketplace,
  })
  const { data: deploymentEdition } = useSuspenseQuery({
    ...systemFeaturesQueryOptions(),
    select: ({ deployment_edition }) => deployment_edition,
  })
  const { mutateAsync: installPackageFromMarketPlace } = useInstallPackageFromMarketPlace()
  const { refreshPluginList } = useRefreshPluginList()
  const { canInstallPlugin } = useWorkspacePluginInstallPermission()
  const [installingProvider, setInstallingProvider] = useState<ModelProviderQuotaGetPaid | null>(
    null,
  )
  const { isExhausted: isCreditsExhausted } = useTrialCredits()
  const { data: trialModels = [] } = useQuery(
    consoleQuery.trialModels.get.queryOptions({
      enabled: deploymentEdition === 'CLOUD',
      select: (data) => data.trial_models,
    }),
  )
  const installedProviderMap = useMemo(
    () => new Map(modelProviders.map((provider) => [provider.provider, provider])),
    [modelProviders],
  )
  const aiCreditVisibleProviders = useMemo(() => {
    if (!enableMarketplace || isCreditsExhausted) return new Set<string>()

    return new Set(
      modelProviders
        .filter((provider) => providerSupportsCredits(provider, trialModels, deploymentEdition))
        .map((provider) => provider.provider),
    )
  }, [deploymentEdition, enableMarketplace, isCreditsExhausted, modelProviders, trialModels])
  const showCreditsExhaustedAlert =
    enableMarketplace &&
    isCreditsExhausted &&
    modelProviders.some((provider) =>
      providerSupportsCredits(provider, trialModels, deploymentEdition),
    )
  const hasApiKeyFallback = modelProviders.some((provider) => {
    const isApiKeyActive =
      provider.custom_configuration?.status === CustomConfigurationStatusEnum.active
    return (
      isApiKeyActive &&
      provider.custom_configuration.current_credential_usable &&
      providerSupportsCredits(provider, trialModels, deploymentEdition)
    )
  })

  const handleInstallPlugin = useCallback(
    async (key: ModelProviderQuotaGetPaid) => {
      if (!enableMarketplace || !canInstallPlugin || installingProvider) return
      const pluginId = providerKeyToPluginId[key]
      const [org, name] = pluginId.split('/')
      if (!org || !name) return
      setInstallingProvider(key)
      try {
        const pluginInfo = await fetchPluginInfoFromMarketPlace({ org, name })
        const uniqueIdentifier = pluginInfo.data.plugin.latest_package_identifier
        if (!uniqueIdentifier) return
        const { all_installed, task_id } = await installPackageFromMarketPlace(uniqueIdentifier)
        if (!all_installed) {
          const { check } = checkTaskStatus()
          await check({ taskId: task_id, pluginUniqueIdentifier: uniqueIdentifier })
        }
        refreshPluginList({ category: PluginCategoryEnum.model })
      } catch {
      } finally {
        setInstallingProvider(null)
      }
    },
    [
      enableMarketplace,
      canInstallPlugin,
      installPackageFromMarketPlace,
      installingProvider,
      refreshPluginList,
    ],
  )

  const installedModelList = useMemo(() => {
    const modelMap = new Map(modelList.map((model) => [model.provider, model]))
    const installedMarketplaceModels = MODEL_PROVIDER_QUOTA_GET_PAID.flatMap<ModelSelectorProvider>(
      (providerKey) => {
        const installedProvider = installedProviderMap.get(providerKey)

        if (!installedProvider) return []

        const matchedModel = modelMap.get(providerKey)
        if (matchedModel) return [matchedModel]

        if (!aiCreditVisibleProviders.has(providerKey)) return []

        return [
          {
            provider: installedProvider.provider,
            icon_small: installedProvider.icon_small,
            icon_small_dark: installedProvider.icon_small_dark,
            label: installedProvider.label,
            models: [],
          },
        ]
      },
    )
    const otherModels = modelList.filter(
      (model) =>
        !MODEL_PROVIDER_QUOTA_GET_PAID.includes(model.provider as ModelProviderQuotaGetPaid),
    )

    return [...installedMarketplaceModels, ...otherModels]
  }, [aiCreditVisibleProviders, installedProviderMap, modelList])

  const searchIndex = useMemo(
    () => createModelSelectorSearchIndex(installedModelList, language),
    [installedModelList, language],
  )
  const filteredModelList = useMemo(
    () =>
      filterModelSelectorModels({
        aiCreditVisibleProviders,
        defaultModel,
        inputValue,
        installedModelList,
        modelPredicate: showIncompatibleModels ? undefined : modelPredicate,
        scopeFeatures,
        searchIndex,
      }),
    [
      aiCreditVisibleProviders,
      defaultModel,
      inputValue,
      installedModelList,
      modelPredicate,
      scopeFeatures,
      searchIndex,
      showIncompatibleModels,
    ],
  )
  const shouldShowModelPredicateReveal = !!modelPredicate

  const marketplaceProviders = useMemo(() => {
    if (!enableMarketplace) return []

    const installedPluginIds = new Set(
      Object.values(modelProviderPlugins).map((plugin) => plugin.plugin_id),
    )
    return MODEL_PROVIDER_QUOTA_GET_PAID.filter(
      (key) => !installedPluginIds.has(providerKeyToPluginId[key]),
    )
  }, [enableMarketplace, modelProviderPlugins])

  const searchStatus =
    !filteredModelList.length && installedModelList.length > 0
      ? t(($) => $['modelProvider.selector.noModelFoundForSearch'], {
          ns: 'common',
          query: inputValue,
        })
      : null
  const handleClosePreviewCard = useCallback(() => {
    previewCardHandle.close()
  }, [previewCardHandle])

  return (
    <>
      <ModelSelectorSearchHeader inputValue={inputValue} onInputValueChange={onInputValueChange} />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <ModelSelectorScrollBody label={t(($) => $['modelProvider.models'], { ns: 'common' })}>
          {showCreditsExhaustedAlert && (
            <CreditsExhaustedAlert hasApiKeyFallback={hasApiKeyFallback} />
          )}
          <div className="pb-1">
            {filteredModelList.map((model) => (
              <PopupItem
                key={model.provider}
                defaultModel={defaultModel}
                model={model}
                modelPredicate={modelPredicate}
                modelSuggestionPredicate={modelSuggestionPredicate}
                previewCardHandle={previewCardHandle}
                onPreviewCardClose={handleClosePreviewCard}
                onSelect={onSelect}
                onHide={onHide}
              />
            ))}
          </div>
          <div className="pb-1">
            {!filteredModelList.length && !installedModelList.length && (
              <ModelSelectorEmptyState onConfigure={onConfigureEmptyState ?? onHide} />
            )}
            <div
              role="status"
              aria-live="polite"
              aria-atomic="true"
              className={
                searchStatus
                  ? 'px-3 py-1.5 text-center text-xs/4.5 break-all text-text-tertiary'
                  : 'h-0'
              }
            >
              {searchStatus}
            </div>
            {scopeFeatures.length > 0 && <CompatibleModelsNotice />}
            {shouldShowModelPredicateReveal && (
              <ShowIncompatibleModelsButton
                showIncompatibleModels={showIncompatibleModels}
                onClick={() => setShowIncompatibleModels((value) => !value)}
              />
            )}
            {enableMarketplace && (
              <MarketplaceSection
                marketplaceProviders={marketplaceProviders}
                marketplaceCollapsed={marketplaceCollapsed}
                installingProvider={installingProvider}
                canInstallPlugin={canInstallPlugin}
                theme={theme}
                onMarketplaceCollapsedChange={setMarketplaceCollapsed}
                onInstallPlugin={handleInstallPlugin}
                onOpenMarketplace={onOpenMarketplace}
              />
            )}
          </div>
        </ModelSelectorScrollBody>
        {onOpenProviderSettings && (
          <ModelProviderSettingsFooter onOpenSettings={onOpenProviderSettings} />
        )}
      </div>
      <PreviewCard handle={previewCardHandle}>
        {({ payload }) => (
          <ModelSelectorPreviewCard
            capabilitiesLabel={t(($) => $['model.capabilities'], { ns: 'common' })}
            language={language}
            payload={payload as ModelSelectorPreviewPayload | undefined}
          />
        )}
      </PreviewCard>
    </>
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
  if (!payload) return null

  const { provider, modelItem } = payload

  return (
    <PreviewCardContent
      placement="right"
      className="w-[206px] bg-components-panel-bg-blur p-3 shadow-none backdrop-blur-xs"
    >
      <div className="flex flex-col gap-1">
        <div className="flex flex-col items-start gap-2">
          <ModelIcon className="size-5 shrink-0" provider={provider} modelName={modelItem.model} />
          <div className="system-md-medium text-wrap wrap-break-word text-text-primary">
            {renderI18nObject(modelItem.label, language)}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {!!modelItem.model_type && (
            <ModelBadge>{modelTypeFormat(modelItem.model_type)}</ModelBadge>
          )}
          {!!modelItem.model_properties.mode && (
            <ModelBadge>
              {(modelItem.model_properties.mode as string).toLocaleUpperCase()}
            </ModelBadge>
          )}
          {!!modelItem.model_properties.context_size && (
            <ModelBadge>{sizeFormat(modelItem.model_properties.context_size as number)}</ModelBadge>
          )}
        </div>
        {[ModelTypeEnum.textGeneration, ModelTypeEnum.textEmbedding, ModelTypeEnum.rerank].includes(
          modelItem.model_type as ModelTypeEnum,
        ) &&
          modelItem.features?.some((feature) =>
            [
              ModelFeatureEnum.vision,
              ModelFeatureEnum.audio,
              ModelFeatureEnum.video,
              ModelFeatureEnum.document,
            ].some((supportedFeature) => supportedFeature === feature),
          ) && (
            <div className="pt-2">
              <div className="mb-1 system-2xs-medium-uppercase text-text-tertiary">
                {capabilitiesLabel}
              </div>
              <div className="flex flex-wrap gap-1">
                {modelItem.features?.map((feature) => (
                  <FeatureIcon key={feature} feature={feature} showFeaturesLabel />
                ))}
              </div>
            </div>
          )}
      </div>
    </PreviewCardContent>
  )
}

export default Popup

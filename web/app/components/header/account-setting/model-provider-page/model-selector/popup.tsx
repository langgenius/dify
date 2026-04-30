import type { FC } from 'react'
import type {
  DefaultModel,
  Model,
  ModelItem,
} from '../declarations'
import type { ModelProviderQuotaGetPaid } from '@/types/model-provider'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useTheme } from 'next-themes'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import checkTaskStatus from '@/app/components/plugins/install-plugin/base/check-task-status'
import useRefreshPluginList from '@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import { useInstallPackageFromMarketPlace } from '@/service/use-plugins'
import { supportFunctionCall } from '@/utils/tool-call'
import {
  CustomConfigurationStatusEnum,
  ModelFeatureEnum,
  ModelStatusEnum,
} from '../declarations'
import { useLanguage, useMarketplaceAllPlugins } from '../hooks'
import CreditsExhaustedAlert from '../provider-added-card/model-auth-dropdown/credits-exhausted-alert'
import { useTrialCredits } from '../provider-added-card/use-trial-credits'
import { providerSupportsCredits } from '../supports-credits'
import { MODEL_PROVIDER_QUOTA_GET_PAID, providerKeyToPluginId } from '../utils'
import MarketplaceSection from './marketplace-section'
import ModelSelectorEmptyState from './popup-empty-state'
import PopupItem from './popup-item'
import {
  CompatibleModelsNotice,
  ModelProviderSettingsFooter,
  ModelSelectorPopupFrame,
  ModelSelectorScrollBody,
  ModelSelectorSearchHeader,
} from './popup-layout'

type PopupProps = {
  defaultModel?: DefaultModel
  modelList: Model[]
  onSelect: (provider: string, model: ModelItem) => void
  scopeFeatures?: ModelFeatureEnum[]
  onHide: () => void
}
const Popup: FC<PopupProps> = ({
  defaultModel,
  modelList,
  onSelect,
  scopeFeatures = [],
  onHide,
}) => {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const language = useLanguage()
  const [searchText, setSearchText] = useState('')
  const [marketplaceCollapsed, setMarketplaceCollapsed] = useState(false)
  const { setShowAccountSettingModal } = useModalContext()
  const { modelProviders } = useProviderContext()
  const {
    plugins: allPlugins,
    isLoading: isMarketplacePluginsLoading,
  } = useMarketplaceAllPlugins(modelProviders, '')
  const { mutateAsync: installPackageFromMarketPlace } = useInstallPackageFromMarketPlace()
  const { refreshPluginList } = useRefreshPluginList()
  const [installingProvider, setInstallingProvider] = useState<ModelProviderQuotaGetPaid | null>(null)
  const { isExhausted: isCreditsExhausted } = useTrialCredits()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const trialModels = systemFeatures.trial_models
  const installedProviderMap = useMemo(() => new Map(
    modelProviders.map(provider => [provider.provider, provider]),
  ), [modelProviders])
  const aiCreditVisibleProviders = useMemo(() => {
    if (isCreditsExhausted)
      return new Set<string>()

    return new Set(
      modelProviders
        .filter(provider => providerSupportsCredits(provider, trialModels))
        .map(provider => provider.provider),
    )
  }, [isCreditsExhausted, modelProviders, trialModels])
  const showCreditsExhaustedAlert = isCreditsExhausted
    && modelProviders.some(provider => providerSupportsCredits(provider, trialModels))
  const hasApiKeyFallback = modelProviders.some((provider) => {
    const isApiKeyActive = provider.custom_configuration?.status === CustomConfigurationStatusEnum.active
    return isApiKeyActive && providerSupportsCredits(provider, trialModels)
  })

  const handleInstallPlugin = useCallback(async (key: ModelProviderQuotaGetPaid) => {
    if (!allPlugins || isMarketplacePluginsLoading || installingProvider)
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
  }, [allPlugins, installPackageFromMarketPlace, installingProvider, isMarketplacePluginsLoading, refreshPluginList])

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

  const filteredModelList = useMemo(() => {
    const normalizedSearch = searchText.toLowerCase()
    const matchesLabel = (label: Record<string, string>) => {
      if (label[language] !== undefined)
        return label[language].toLowerCase().includes(normalizedSearch)
      return Object.values(label).some(value =>
        value.toLowerCase().includes(normalizedSearch),
      )
    }

    const filtered = installedModelList.map((model) => {
      const providerMatched = !!searchText && (
        matchesLabel(model.label)
        || model.provider.toLowerCase().includes(normalizedSearch)
      )

      const filteredModels = model.models
        .filter((modelItem) => {
          if (!searchText || providerMatched)
            return true
          return matchesLabel(modelItem.label)
        })
        .filter((modelItem) => {
          if (scopeFeatures.length === 0)
            return true
          return scopeFeatures.every((feature) => {
            if (feature === ModelFeatureEnum.toolCall)
              return supportFunctionCall(modelItem.features)
            return modelItem.features?.includes(feature) ?? false
          })
        })
      if (
        (searchText && filteredModels.length === 0)
        || (!searchText && filteredModels.length === 0 && !aiCreditVisibleProviders.has(model.provider))
      ) {
        return null
      }

      return { ...model, models: filteredModels }
    }).filter((model): model is Model => model !== null)

    if (defaultModel?.provider) {
      filtered.sort((a, b) => {
        const aSelected = a.provider === defaultModel.provider ? 0 : 1
        const bSelected = b.provider === defaultModel.provider ? 0 : 1
        return aSelected - bSelected
      })
    }

    return filtered
  }, [aiCreditVisibleProviders, defaultModel?.provider, installedModelList, language, scopeFeatures, searchText])

  const marketplaceProviders = useMemo(() => {
    const installedProviders = new Set(modelProviders.map(provider => provider.provider))
    return MODEL_PROVIDER_QUOTA_GET_PAID.filter(key => !installedProviders.has(key))
  }, [modelProviders])

  const handleOpenSettings = useCallback(() => {
    onHide()
    setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.PROVIDER })
  }, [onHide, setShowAccountSettingModal])

  return (
    <ModelSelectorPopupFrame>
      <ModelSelectorSearchHeader
        searchText={searchText}
        onSearchTextChange={setSearchText}
      />
      {showCreditsExhaustedAlert && (
        <CreditsExhaustedAlert hasApiKeyFallback={hasApiKeyFallback} />
      )}
      <ModelSelectorScrollBody label={t('modelProvider.models', { ns: 'common' })}>
        <div className="pb-1">
          {
            filteredModelList.map(model => (
              <PopupItem
                key={model.provider}
                defaultModel={defaultModel}
                model={model}
                onSelect={onSelect}
                onHide={onHide}
              />
            ))
          }
          {!filteredModelList.length && !installedModelList.length && (
            <ModelSelectorEmptyState
              onConfigure={handleOpenSettings}
            />
          )}
          {!filteredModelList.length && installedModelList.length > 0 && (
            <div className="px-3 py-1.5 text-center text-xs leading-[18px] break-all text-text-tertiary">
              {`No model found for \u201C${searchText}\u201D`}
            </div>
          )}
          {scopeFeatures.length > 0 && (
            <CompatibleModelsNotice />
          )}
          <MarketplaceSection
            marketplaceProviders={marketplaceProviders}
            marketplaceCollapsed={marketplaceCollapsed}
            installingProvider={installingProvider}
            isMarketplacePluginsLoading={isMarketplacePluginsLoading}
            theme={theme}
            onMarketplaceCollapsedChange={setMarketplaceCollapsed}
            onInstallPlugin={handleInstallPlugin}
          />
        </div>
      </ModelSelectorScrollBody>
      <ModelProviderSettingsFooter onOpenSettings={handleOpenSettings} />
    </ModelSelectorPopupFrame>
  )
}

export default Popup

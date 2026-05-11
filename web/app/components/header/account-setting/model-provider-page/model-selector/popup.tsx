import type { DefaultModel, Model, ModelFeatureEnum } from '../declarations'
import type { ModelProviderQuotaGetPaid } from '@/types/model-provider'
import { ComboboxList } from '@langgenius/dify-ui/combobox'
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
import { CustomConfigurationStatusEnum, ModelStatusEnum } from '../declarations'
import { useLanguage, useMarketplaceAllPlugins } from '../hooks'
import CreditsExhaustedAlert from '../provider-added-card/model-auth-dropdown/credits-exhausted-alert'
import { useTrialCredits } from '../provider-added-card/use-trial-credits'
import { providerSupportsCredits } from '../supports-credits'
import { MODEL_PROVIDER_QUOTA_GET_PAID, providerKeyToPluginId } from '../utils'
import MarketplaceSection from './marketplace-section'
import { createModelSelectorSearchIndex, filterModelSelectorModels } from './model-search'
import ModelSelectorEmptyState from './popup-empty-state'
import PopupItem from './popup-item'
import { CompatibleModelsNotice, ModelProviderSettingsFooter, ModelSelectorPopupFrame, ModelSelectorScrollBody, ModelSelectorSearchHeader } from './popup-layout'

export type PopupProps = {
  defaultModel?: DefaultModel
  inputValue: string
  modelList: Model[]
  scopeFeatures?: ModelFeatureEnum[]
  onInputValueChange: (value: string) => void
  onHide: () => void
}
function Popup({
  defaultModel,
  inputValue,
  modelList,
  scopeFeatures = [],
  onInputValueChange,
  onHide,
}: PopupProps) {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const language = useLanguage()
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

  const searchIndex = useMemo(
    () => createModelSelectorSearchIndex(installedModelList, language),
    [installedModelList, language],
  )
  const filteredModelList = useMemo(() => filterModelSelectorModels({
    aiCreditVisibleProviders,
    defaultModel,
    inputValue,
    installedModelList,
    scopeFeatures,
    searchIndex,
  }), [aiCreditVisibleProviders, defaultModel, inputValue, installedModelList, scopeFeatures, searchIndex])

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
                  onHide={onHide}
                />
              ))
            }
          </div>
        </ComboboxList>
        <div className="pb-1">
          {!filteredModelList.length && !installedModelList.length && (
            <ModelSelectorEmptyState
              onConfigure={handleOpenSettings}
            />
          )}
          {!filteredModelList.length && installedModelList.length > 0 && (
            <div className="px-3 py-1.5 text-center text-xs leading-4.5 break-all text-text-tertiary">
              {`No model found for \u201C${inputValue}\u201D`}
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

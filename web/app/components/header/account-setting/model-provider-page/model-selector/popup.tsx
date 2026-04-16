import type { FC } from 'react'
import type {
  DefaultModel,
  Model,
  ModelItem,
} from '../declarations'
import type { ModelProviderQuotaGetPaid } from '@/types/model-provider'
import { cn } from '@langgenius/dify-ui/cn'
import { useTheme } from 'next-themes'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/app/components/base/ui/button'
import { ACCOUNT_SETTING_TAB } from '@/app/components/header/account-setting/constants'
import checkTaskStatus from '@/app/components/plugins/install-plugin/base/check-task-status'
import useRefreshPluginList from '@/app/components/plugins/install-plugin/hooks/use-refresh-plugin-list'
import { useSystemFeaturesQuery } from '@/context/global-public-context'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { useInstallPackageFromMarketPlace } from '@/service/use-plugins'
import { supportFunctionCall } from '@/utils/tool-call'
import { getMarketplaceUrl } from '@/utils/var'
import {
  CustomConfigurationStatusEnum,
  ModelFeatureEnum,
  ModelStatusEnum,
} from '../declarations'
import { useLanguage, useMarketplaceAllPlugins } from '../hooks'
import CreditsExhaustedAlert from '../provider-added-card/model-auth-dropdown/credits-exhausted-alert'
import { useTrialCredits } from '../provider-added-card/use-trial-credits'
import { providerSupportsCredits } from '../supports-credits'
import { MODEL_PROVIDER_QUOTA_GET_PAID, modelNameMap, providerIconMap, providerKeyToPluginId } from '../utils'
import PopupItem from './popup-item'

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
  const { data: systemFeatures } = useSystemFeaturesQuery()
  const trialModels = systemFeatures?.trial_models
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
    const filtered = installedModelList.map((model) => {
      const matchesProviderSearch = !searchText
        || model.provider.toLowerCase().includes(searchText.toLowerCase())
        || Object.values(model.label).some(label => label.toLowerCase().includes(searchText.toLowerCase()))

      const filteredModels = model.models
        .filter((modelItem) => {
          if (modelItem.label[language] !== undefined)
            return modelItem.label[language].toLowerCase().includes(searchText.toLowerCase())
          return Object.values(modelItem.label).some(label =>
            label.toLowerCase().includes(searchText.toLowerCase()),
          )
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
      if (!matchesProviderSearch || (filteredModels.length === 0 && !aiCreditVisibleProviders.has(model.provider)))
        return null

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

  return (
    <div className="no-scrollbar max-h-[480px] overflow-y-auto">
      <div className="sticky top-0 z-10 bg-components-panel-bg pt-3 pr-2 pb-1 pl-3">
        <div className={`
          flex h-8 items-center rounded-lg border pr-[10px] pl-[9px]
          ${searchText ? 'border-components-input-border-active bg-components-input-bg-active shadow-xs' : 'border-transparent bg-components-input-bg-normal'}
        `}
        >
          <span
            className={`
              mr-[7px] i-ri-search-line h-[14px] w-[14px] shrink-0
              ${searchText ? 'text-text-tertiary' : 'text-text-quaternary'}
            `}
          />
          <input
            className="block h-[18px] grow appearance-none bg-transparent text-[13px] text-text-primary outline-hidden"
            placeholder={t('form.searchModel', { ns: 'datasetSettings' }) || ''}
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />
          {
            searchText && (
              <span
                className="ml-1.5 i-custom-vender-solid-general-x-circle h-[14px] w-[14px] shrink-0 cursor-pointer text-text-quaternary"
                onClick={() => setSearchText('')}
              />
            )
          }
        </div>
        {scopeFeatures.length > 0 && (
          <div
            data-testid="compatible-models-banner"
            className="mt-2 flex items-center gap-1 rounded-lg bg-background-section-burn px-2.5 py-2"
          >
            <span className="i-ri-information-2-fill h-4 w-4 shrink-0 text-text-accent" />
            <p className="system-xs-medium text-text-secondary">
              {t('modelProvider.selector.onlyCompatibleModelsShown', { ns: 'common' })}
            </p>
          </div>
        )}
      </div>
      {showCreditsExhaustedAlert && (
        <CreditsExhaustedAlert hasApiKeyFallback={hasApiKeyFallback} />
      )}
      <div className="px-1 pb-1">
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
          <div className="flex flex-col gap-2 rounded-[10px] bg-linear-to-r from-state-base-hover to-background-gradient-mask-transparent p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg backdrop-blur-[5px]">
              <span className="i-ri-brain-2-line h-5 w-5 text-text-tertiary" />
            </div>
            <div className="flex flex-col gap-1">
              <p className="system-sm-medium text-text-secondary">
                {t('modelProvider.selector.noProviderConfigured', { ns: 'common' })}
              </p>
              <p className="system-xs-regular text-text-tertiary">
                {t('modelProvider.selector.noProviderConfiguredDesc', { ns: 'common' })}
              </p>
            </div>
            <Button
              variant="primary"
              className="w-[108px]"
              onClick={() => {
                onHide()
                setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.PROVIDER })
              }}
            >
              {t('modelProvider.selector.configure', { ns: 'common' })}
              <span className="i-ri-arrow-right-line h-4 w-4" />
            </Button>
          </div>
        )}
        {!filteredModelList.length && installedModelList.length > 0 && (
          <div className="px-3 py-1.5 text-center text-xs leading-[18px] break-all text-text-tertiary">
            {`No model found for \u201C${searchText}\u201D`}
          </div>
        )}
        {marketplaceProviders.length > 0 && (
          <>
            <div className="mx-2 my-1 border-t border-divider-subtle" />
            <div className="mb-1">
              <div className="flex h-[22px] items-center px-3">
                <div
                  className="flex flex-1 cursor-pointer items-center system-sm-medium text-text-primary"
                  onClick={() => setMarketplaceCollapsed(prev => !prev)}
                >
                  {t('modelProvider.selector.fromMarketplace', { ns: 'common' })}
                  <span className={cn('i-custom-vender-solid-general-arrow-down-round-fill h-4 w-4 text-text-quaternary', marketplaceCollapsed && '-rotate-90')} />
                </div>
              </div>
              {!marketplaceCollapsed && (
                <>
                  {marketplaceProviders.map((key) => {
                    const Icon = providerIconMap[key]
                    const isInstalling = installingProvider === key
                    return (
                      <div
                        key={key}
                        className="group flex cursor-pointer items-center gap-1 rounded-lg py-0.5 pr-0.5 pl-3 hover:bg-state-base-hover"
                      >
                        <div className="flex flex-1 items-center gap-2 py-0.5">
                          <Icon className="h-5 w-5 shrink-0 rounded-md" />
                          <span className="system-sm-regular text-text-secondary">{modelNameMap[key]}</span>
                        </div>
                        <Button
                          variant="secondary"
                          size="small"
                          className={cn(
                            'shrink-0 backdrop-blur-[5px]',
                            !isInstalling && 'hidden group-hover:flex',
                          )}
                          disabled={isInstalling || isMarketplacePluginsLoading}
                          onClick={() => handleInstallPlugin(key)}
                        >
                          {isInstalling && <span className="i-ri-loader-2-line h-3.5 w-3.5 animate-spin" />}
                          {isInstalling
                            ? t('installModal.installing', { ns: 'plugin' })
                            : t('modelProvider.selector.install', { ns: 'common' })}
                        </Button>
                      </div>
                    )
                  })}
                  <a
                    className="flex cursor-pointer items-center gap-0.5 px-3 pt-1.5"
                    href={getMarketplaceUrl('', { theme })}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span className="flex-1 system-xs-regular text-text-accent">
                      {t('modelProvider.selector.discoverMoreInMarketplace', { ns: 'common' })}
                    </span>
                    <span className="i-ri-arrow-right-up-line h-3! w-3! text-text-accent" />
                  </a>
                </>
              )}
            </div>
          </>
        )}
      </div>
      <div
        className="sticky bottom-0 flex cursor-pointer items-center gap-1 rounded-b-lg border-t border-divider-subtle bg-components-panel-bg px-3 py-2 text-text-tertiary hover:text-text-secondary"
        onClick={() => {
          onHide()
          setShowAccountSettingModal({ payload: ACCOUNT_SETTING_TAB.PROVIDER })
        }}
      >
        <span className="i-ri-equalizer-2-line h-4 w-4 shrink-0" />
        <span className="system-xs-medium">{t('modelProvider.selector.modelProviderSettings', { ns: 'common' })}</span>
      </div>
    </div>
  )
}

export default Popup

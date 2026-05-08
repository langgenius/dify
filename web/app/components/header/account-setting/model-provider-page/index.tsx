import type {
  ModelProvider,
} from './declarations'
import type { PluginDetail } from '@/app/components/plugins/types'
import { cn } from '@langgenius/dify-ui/cn'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SearchInput from '@/app/components/base/search-input'
import { usePluginsWithLatestVersion } from '@/app/components/plugins/hooks'
import useReferenceSetting from '@/app/components/plugins/plugin-page/use-reference-setting'
import ReferenceSettingModal from '@/app/components/plugins/reference-setting-modal'
import { IS_CLOUD_EDITION } from '@/config'
import { useProviderContext } from '@/context/provider-context'
import { consoleQuery } from '@/service/client'
import { systemFeaturesQueryOptions } from '@/service/system-features'
import {
  CustomConfigurationStatusEnum,
  ModelTypeEnum,
} from './declarations'
import {
  useDefaultModel,
} from './hooks'
import InstallFromMarketplace from './install-from-marketplace'
import ProviderAddedCard from './provider-added-card'
import QuotaPanel from './provider-added-card/quota-panel'
import { providerSupportsCredits } from './supports-credits'
import SystemModelSelector from './system-model-selector'
import { providerToPluginId } from './utils'

type SystemModelConfigStatus = 'no-provider' | 'none-configured' | 'partially-configured' | 'fully-configured'

type Props = {
  onSearchTextChange: (value: string) => void
  searchText: string
}

const FixedModelProvider = ['langgenius/openai/openai', 'langgenius/anthropic/anthropic']

const ModelProviderPage = ({ onSearchTextChange, searchText }: Props) => {
  const debouncedSearchText = useDebounce(searchText, { wait: 500 })
  const { t } = useTranslation()
  const [showUpdateSettingModal, setShowUpdateSettingModal] = useState(false)
  const { data: textGenerationDefaultModel, isLoading: isTextGenerationDefaultModelLoading } = useDefaultModel(ModelTypeEnum.textGeneration)
  const { data: embeddingsDefaultModel, isLoading: isEmbeddingsDefaultModelLoading } = useDefaultModel(ModelTypeEnum.textEmbedding)
  const { data: rerankDefaultModel, isLoading: isRerankDefaultModelLoading } = useDefaultModel(ModelTypeEnum.rerank)
  const { data: speech2textDefaultModel, isLoading: isSpeech2textDefaultModelLoading } = useDefaultModel(ModelTypeEnum.speech2text)
  const { data: ttsDefaultModel, isLoading: isTTSDefaultModelLoading } = useDefaultModel(ModelTypeEnum.tts)
  const { modelProviders: providers } = useProviderContext()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())
  const {
    referenceSetting,
    setReferenceSettings,
  } = useReferenceSetting()

  const allPluginIds = useMemo(() => {
    return [...new Set(providers.map(p => providerToPluginId(p.provider)).filter(Boolean))]
  }, [providers])
  const { data: installedPlugins } = useQuery(consoleQuery.plugins.checkInstalled.queryOptions({
    input: { body: { plugin_ids: allPluginIds } },
    enabled: allPluginIds.length > 0,
    staleTime: 0,
  }))
  const enrichedPlugins = usePluginsWithLatestVersion(installedPlugins?.plugins)
  const pluginDetailMap = useMemo(() => {
    const map = new Map<string, PluginDetail>()
    for (const plugin of enrichedPlugins)
      map.set(plugin.plugin_id, plugin)
    return map
  }, [enrichedPlugins])
  const enableMarketplace = systemFeatures.enable_marketplace
  const isDefaultModelLoading = isTextGenerationDefaultModelLoading
    || isEmbeddingsDefaultModelLoading
    || isRerankDefaultModelLoading
    || isSpeech2textDefaultModelLoading
    || isTTSDefaultModelLoading
  const [configuredProviders, notConfiguredProviders] = useMemo(() => {
    const configuredProviders: ModelProvider[] = []
    const notConfiguredProviders: ModelProvider[] = []

    providers.forEach((provider) => {
      if (
        provider.custom_configuration.status === CustomConfigurationStatusEnum.active
        || (
          provider.system_configuration.enabled === true
          && provider.system_configuration.quota_configurations.some(item => item.quota_type === provider.system_configuration.current_quota_type)
        )
      ) {
        configuredProviders.push(provider)
      }
      else {
        notConfiguredProviders.push(provider)
      }
    })

    configuredProviders.sort((a, b) => {
      if (FixedModelProvider.includes(a.provider) && FixedModelProvider.includes(b.provider))
        return FixedModelProvider.indexOf(a.provider) - FixedModelProvider.indexOf(b.provider) > 0 ? 1 : -1
      else if (FixedModelProvider.includes(a.provider))
        return -1
      else if (FixedModelProvider.includes(b.provider))
        return 1
      return 0
    })

    return [configuredProviders, notConfiguredProviders]
  }, [providers])

  const systemModelConfigStatus: SystemModelConfigStatus = useMemo(() => {
    const defaultModels = [textGenerationDefaultModel, embeddingsDefaultModel, rerankDefaultModel, speech2textDefaultModel, ttsDefaultModel]
    const configuredCount = defaultModels.filter(Boolean).length
    if (configuredCount === 0 && configuredProviders.length === 0)
      return 'no-provider'
    if (configuredCount === 0)
      return 'none-configured'
    if (configuredCount < defaultModels.length)
      return 'partially-configured'
    return 'fully-configured'
  }, [configuredProviders, textGenerationDefaultModel, embeddingsDefaultModel, rerankDefaultModel, speech2textDefaultModel, ttsDefaultModel])
  const warningTextKey
    = systemModelConfigStatus === 'none-configured'
      ? 'modelProvider.noneConfigured'
      : systemModelConfigStatus === 'partially-configured'
        ? 'modelProvider.notConfigured'
        : null
  const showWarning = !isDefaultModelLoading && !!warningTextKey

  const [filteredConfiguredProviders, filteredNotConfiguredProviders] = useMemo(() => {
    const filteredConfiguredProviders = configuredProviders.filter(
      provider => provider.provider.toLowerCase().includes(debouncedSearchText.toLowerCase())
        || Object.values(provider.label).some(text => text.toLowerCase().includes(debouncedSearchText.toLowerCase())),
    )
    const filteredNotConfiguredProviders = notConfiguredProviders.filter(
      provider => provider.provider.toLowerCase().includes(debouncedSearchText.toLowerCase())
        || Object.values(provider.label).some(text => text.toLowerCase().includes(debouncedSearchText.toLowerCase())),
    )

    return [filteredConfiguredProviders, filteredNotConfiguredProviders]
  }, [configuredProviders, debouncedSearchText, notConfiguredProviders])
  const [creditsBackedProviders, otherConfiguredProviders] = useMemo(() => {
    const creditsBackedProviders: ModelProvider[] = []
    const otherConfiguredProviders: ModelProvider[] = []

    filteredConfiguredProviders.forEach((provider) => {
      if (providerSupportsCredits(provider, systemFeatures.trial_models))
        creditsBackedProviders.push(provider)
      else
        otherConfiguredProviders.push(provider)
    })

    return [creditsBackedProviders, otherConfiguredProviders]
  }, [filteredConfiguredProviders, systemFeatures.trial_models])
  const hasConfiguredProviders = creditsBackedProviders.length > 0 || otherConfiguredProviders.length > 0

  return (
    <div className="relative -mt-2 pt-1">
      <div className="mb-2 flex h-8 items-center justify-between">
        <SearchInput
          className="w-[200px]"
          value={searchText}
          onChange={onSearchTextChange}
        />
        <div className="flex min-w-0 items-center justify-end gap-2">
          <button
            type="button"
            disabled={!referenceSetting}
            className="flex h-8 w-[208px] shrink-0 items-center justify-center gap-0.5 rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3 system-sm-medium text-components-button-secondary-text shadow-xs hover:bg-components-button-secondary-bg-hover disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => setShowUpdateSettingModal(true)}
          >
            <span aria-hidden className="i-ri-flashlight-line size-4 shrink-0" />
            <span className="truncate px-0.5">{t('autoUpdate.updateSettings', { ns: 'plugin' })}</span>
            <span className="inline-flex h-[18px] min-w-4 shrink-0 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 system-2xs-medium-uppercase text-text-tertiary">
              {t('autoUpdate.strategy.latest.name', { ns: 'plugin' })}
            </span>
            <span aria-hidden className="i-ri-arrow-down-s-line size-4 shrink-0" />
          </button>
          <div className={cn(
            'relative flex shrink-0 items-center justify-end gap-2 rounded-lg border border-transparent p-px',
            showWarning && 'border-components-panel-border bg-components-panel-bg-blur pl-2 shadow-xs',
          )}
          >
            {showWarning && <div className="absolute top-0 right-0 bottom-0 left-0 opacity-40" style={{ background: 'linear-gradient(92deg, rgba(247, 144, 9, 0.25) 0%, rgba(255, 255, 255, 0.00) 100%)' }} />}
            {showWarning && (
              <div className="flex items-center gap-1 system-xs-medium text-text-primary">
                <span className="i-ri-alert-fill h-4 w-4 text-text-warning-secondary" />
                <span className="max-w-[280px] truncate" title={t(warningTextKey, { ns: 'common' })}>{t(warningTextKey, { ns: 'common' })}</span>
              </div>
            )}
            <SystemModelSelector
              className="w-[188px]"
              notConfigured={showWarning}
              textGenerationDefaultModel={textGenerationDefaultModel}
              embeddingsDefaultModel={embeddingsDefaultModel}
              rerankDefaultModel={rerankDefaultModel}
              speech2textDefaultModel={speech2textDefaultModel}
              ttsDefaultModel={ttsDefaultModel}
              isLoading={isDefaultModelLoading}
            />
          </div>
        </div>
      </div>
      {IS_CLOUD_EDITION && <QuotaPanel providers={providers} />}
      {!hasConfiguredProviders && (
        <div className="mb-2 rounded-[10px] bg-workflow-process-bg p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg backdrop-blur-sm">
            <span className="i-ri-brain-line h-5 w-5 text-text-primary" />
          </div>
          <div className="mt-2 system-sm-medium text-text-secondary">{t('modelProvider.emptyProviderTitle', { ns: 'common' })}</div>
          <div className="mt-1 system-xs-regular text-text-tertiary">{t('modelProvider.emptyProviderTip', { ns: 'common' })}</div>
        </div>
      )}
      {!!creditsBackedProviders.length && (
        <section className="pt-2">
          <div className="mb-2">
            <div className="system-md-semibold text-text-primary">{t('modelProvider.creditsBackedProviders', { ns: 'common' })}</div>
            <div className="mt-0.5 system-xs-regular text-text-tertiary">{t('modelProvider.creditsBackedProvidersDesc', { ns: 'common' })}</div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {creditsBackedProviders.map(provider => (
              <ProviderAddedCard
                layout="grid"
                key={provider.provider}
                provider={provider}
                pluginDetail={pluginDetailMap.get(providerToPluginId(provider.provider))}
              />
            ))}
          </div>
        </section>
      )}
      {!!otherConfiguredProviders.length && (
        <section className="pt-4">
          <div className="mb-2 system-md-semibold text-text-primary">{t('modelProvider.configuredProviders', { ns: 'common' })}</div>
          <div className="grid grid-cols-3 gap-2">
            {otherConfiguredProviders.map(provider => (
              <ProviderAddedCard
                layout="grid"
                key={provider.provider}
                provider={provider}
                pluginDetail={pluginDetailMap.get(providerToPluginId(provider.provider))}
              />
            ))}
          </div>
        </section>
      )}
      {!!filteredNotConfiguredProviders?.length && (
        <section className="pt-4">
          <div className="mb-2 flex items-center system-md-semibold text-text-primary">{t('modelProvider.toBeConfigured', { ns: 'common' })}</div>
          <div className="grid grid-cols-3 gap-2">
            {filteredNotConfiguredProviders?.map(provider => (
              <ProviderAddedCard
                layout="grid"
                notConfigured
                key={provider.provider}
                provider={provider}
                pluginDetail={pluginDetailMap.get(providerToPluginId(provider.provider))}
              />
            ))}
          </div>
        </section>
      )}
      {
        enableMarketplace && (
          <InstallFromMarketplace
            providers={providers}
            searchText={searchText}
          />
        )
      }
      {showUpdateSettingModal && referenceSetting && (
        <ReferenceSettingModal
          payload={referenceSetting}
          onHide={() => setShowUpdateSettingModal(false)}
          onSave={setReferenceSettings}
        />
      )}
    </div>
  )
}

export default ModelProviderPage

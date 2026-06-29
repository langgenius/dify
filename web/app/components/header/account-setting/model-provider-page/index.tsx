import type { ReactNode } from 'react'
import type {
  ModelProvider,
} from './declarations'
import type { PluginDetail } from '@/app/components/plugins/types'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { noop } from 'es-toolkit/function'
import { useMemo } from 'react'
import { useTranslation } from '#i18n'
import { SearchInput } from '@/app/components/base/search-input'
import { usePluginsWithLatestVersion } from '@/app/components/plugins/hooks'
import { usePluginSettingsAccess } from '@/app/components/plugins/plugin-page/use-reference-setting'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { useProviderContext } from '@/context/provider-context'
import { systemFeaturesQueryOptions } from '@/features/system-features/client'
import { consoleQuery } from '@/service/client'
import UpdateSettingDialog from '../update-setting-dialog'
import {
  CustomConfigurationStatusEnum,
  ModelTypeEnum,
} from './declarations'
import {
  useDefaultModel,
} from './hooks'
import ModelProviderPageBody from './model-provider-page-body'
import SystemModelSelector from './system-model-selector'
import { providerToPluginId } from './utils'

type SystemModelConfigStatus = 'no-provider' | 'none-configured' | 'partially-configured' | 'fully-configured'

type Props = Readonly<{
  layout?: (parts: { body: ReactNode, toolbar: ReactNode }) => ReactNode
  onSearchTextChange?: (value: string) => void
  searchText: string
  stickyToolbar?: boolean
  hideSystemModelSelectorProviderSettingsFooter?: boolean
}>

const FixedModelProvider = ['langgenius/openai/openai', 'langgenius/anthropic/anthropic']

const ModelProviderPage = ({
  layout,
  onSearchTextChange,
  searchText,
  stickyToolbar,
  hideSystemModelSelectorProviderSettingsFooter,
}: Props) => {
  const debouncedSearchText = useDebounce(searchText, { wait: 500 })
  const { t } = useTranslation()
  const {
    canSetPluginPreferences,
  } = usePluginSettingsAccess()
  const { data: textGenerationDefaultModel, isLoading: isTextGenerationDefaultModelLoading } = useDefaultModel(ModelTypeEnum.textGeneration)
  const { data: embeddingsDefaultModel, isLoading: isEmbeddingsDefaultModelLoading } = useDefaultModel(ModelTypeEnum.textEmbedding)
  const { data: rerankDefaultModel, isLoading: isRerankDefaultModelLoading } = useDefaultModel(ModelTypeEnum.rerank)
  const { data: speech2textDefaultModel, isLoading: isSpeech2textDefaultModelLoading } = useDefaultModel(ModelTypeEnum.speech2text)
  const { data: ttsDefaultModel, isLoading: isTTSDefaultModelLoading } = useDefaultModel(ModelTypeEnum.tts)
  const { modelProviders: providers, isLoadingModelProviders } = useProviderContext()
  const { data: systemFeatures } = useSuspenseQuery(systemFeaturesQueryOptions())

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
    = systemModelConfigStatus === 'no-provider' || systemModelConfigStatus === 'none-configured'
      ? 'modelProvider.noneConfigured'
      : null
  const showWarning = !isLoadingModelProviders && !isDefaultModelLoading && !!warningTextKey
  const systemModelSelector = (className: string) => (
    <SystemModelSelector
      className={className}
      notConfigured={showWarning}
      textGenerationDefaultModel={textGenerationDefaultModel}
      embeddingsDefaultModel={embeddingsDefaultModel}
      rerankDefaultModel={rerankDefaultModel}
      speech2textDefaultModel={speech2textDefaultModel}
      ttsDefaultModel={ttsDefaultModel}
      isLoading={isDefaultModelLoading}
      hideProviderSettingsFooter={hideSystemModelSelectorProviderSettingsFooter}
    />
  )

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
  const showEmptyProvider = !isLoadingModelProviders && !configuredProviders.length
  const showConfiguredProviders = !isLoadingModelProviders && !!filteredConfiguredProviders?.length
  const showNotConfiguredProviders = !isLoadingModelProviders && !!filteredNotConfiguredProviders?.length
  const showMarketplace = !isLoadingModelProviders && enableMarketplace
  const toolbar = (
    <div className={stickyToolbar
      ? layout
        ? 'flex w-full items-center justify-between gap-3'
        : 'sticky top-0 z-10 -mx-6 mb-2 flex items-center justify-between gap-3 bg-components-panel-bg px-6 pb-2'
      : 'mb-2 flex items-center justify-between gap-3'}
    >
      <SearchInput
        className="w-50 shrink-0"
        placeholder={t('modelProvider.searchModels', { ns: 'common' })}
        value={searchText}
        onValueChange={onSearchTextChange ?? noop}
      />
      <div className="flex shrink-0 items-center justify-end gap-2">
        {showWarning
          ? (
              <div className="relative inline-flex shrink-0 items-center gap-2 overflow-hidden rounded-lg border-[0.5px] border-components-panel-border bg-components-panel-bg-blur py-1 pr-1 pl-2.5 shadow-xs backdrop-blur-[5px]">
                <div className="pointer-events-none absolute inset-[-1px] bg-[linear-gradient(119deg,rgba(247,144,9,0.25)_0%,rgba(255,255,255,0)_100%)] opacity-40" />
                <div className="relative flex shrink-0 items-center gap-1">
                  <span aria-hidden className="i-ri-alert-fill size-4 shrink-0 text-text-warning-secondary" />
                  <span className="shrink-0 system-sm-medium whitespace-nowrap text-text-primary" title={t(warningTextKey, { ns: 'common' })}>
                    {t(warningTextKey, { ns: 'common' })}
                  </span>
                </div>
                <div className="relative shrink-0">
                  {systemModelSelector('h-6 px-1.5 text-xs font-medium')}
                </div>
              </div>
            )
          : systemModelSelector('h-8 px-3 system-sm-medium')}
        {canSetPluginPreferences && (
          <UpdateSettingDialog
            category={PluginCategoryEnum.model}
          />
        )}
      </div>
    </div>
  )

  const body = (
    <ModelProviderPageBody
      providers={providers}
      filteredConfiguredProviders={filteredConfiguredProviders}
      filteredNotConfiguredProviders={filteredNotConfiguredProviders}
      isLoadingModelProviders={isLoadingModelProviders}
      showEmptyProvider={showEmptyProvider}
      showConfiguredProviders={showConfiguredProviders}
      showNotConfiguredProviders={showNotConfiguredProviders}
      showMarketplace={showMarketplace}
      enableMarketplace={enableMarketplace}
      searchText={searchText}
      pluginDetailMap={pluginDetailMap}
    />
  )

  if (layout)
    return <div className="relative flex min-h-0 flex-1 flex-col">{layout({ body, toolbar })}</div>

  return (
    <div className="relative">
      {toolbar}
      {body}
    </div>
  )
}

export default ModelProviderPage

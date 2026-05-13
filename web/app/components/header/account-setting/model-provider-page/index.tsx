import type {
  ModelProvider,
} from './declarations'
import type { PluginDetail } from '@/app/components/plugins/types'
import { Button } from '@langgenius/dify-ui/button'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useDebounce } from 'ahooks'
import { noop } from 'es-toolkit/function'
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
import SystemModelSelector from './system-model-selector'
import { providerToPluginId } from './utils'

type SystemModelConfigStatus = 'no-provider' | 'none-configured' | 'partially-configured' | 'fully-configured'

type Props = {
  onSearchTextChange?: (value: string) => void
  searchText: string
}

const FixedModelProvider = ['langgenius/openai/openai', 'langgenius/anthropic/anthropic']

const ModelProviderPage = ({
  onSearchTextChange,
  searchText,
}: Props) => {
  const debouncedSearchText = useDebounce(searchText, { wait: 500 })
  const { t } = useTranslation()
  const {
    referenceSetting,
    canSetPermissions,
    setReferenceSettings,
  } = useReferenceSetting()
  const [showPluginSettingModal, setShowPluginSettingModal] = useState(false)
  const [warningDismissed, setWarningDismissed] = useState(false)
  const { data: textGenerationDefaultModel, isLoading: isTextGenerationDefaultModelLoading } = useDefaultModel(ModelTypeEnum.textGeneration)
  const { data: embeddingsDefaultModel, isLoading: isEmbeddingsDefaultModelLoading } = useDefaultModel(ModelTypeEnum.textEmbedding)
  const { data: rerankDefaultModel, isLoading: isRerankDefaultModelLoading } = useDefaultModel(ModelTypeEnum.rerank)
  const { data: speech2textDefaultModel, isLoading: isSpeech2textDefaultModelLoading } = useDefaultModel(ModelTypeEnum.speech2text)
  const { data: ttsDefaultModel, isLoading: isTTSDefaultModelLoading } = useDefaultModel(ModelTypeEnum.tts)
  const { modelProviders: providers } = useProviderContext()
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

  return (
    <div className="relative">
      <div className="mb-2 flex items-center justify-between gap-3">
        <SearchInput
          className="w-[200px] shrink-0"
          placeholder={t('modelProvider.searchModels', { ns: 'common' })}
          value={searchText}
          onChange={onSearchTextChange ?? noop}
        />
        <div className="flex shrink-0 items-center justify-end gap-2">
          {canSetPermissions && referenceSetting && (
            <Button
              variant="secondary"
              className="h-8 gap-0.5 px-3 system-sm-medium"
              onClick={() => setShowPluginSettingModal(true)}
            >
              <span aria-hidden className="i-ri-flashlight-line size-4" />
              <span className="px-0.5">{t('modelProvider.updateSetting', { ns: 'common' })}</span>
              <span className="flex min-w-4 items-center justify-center rounded-[5px] border border-divider-deep bg-components-badge-bg-dimm px-1 py-0.5 system-2xs-medium-uppercase text-text-tertiary">
                {t('autoUpdate.strategy.latest.name', { ns: 'plugin' })}
              </span>
              <span aria-hidden className="i-ri-arrow-down-s-line size-4" />
            </Button>
          )}
          <SystemModelSelector
            className="h-8 px-3 system-sm-medium"
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
      {showWarning && !warningDismissed && (
        <div className="fixed top-2 right-2 z-50 p-2">
          <div className="flex items-center gap-2 rounded-lg border-[0.5px] border-components-button-secondary-border bg-components-button-secondary-bg px-3 py-2 shadow-xs backdrop-blur-[5px]">
            <span aria-hidden className="i-ri-alert-fill size-4 shrink-0 text-text-warning-secondary" />
            <span className="shrink-0 system-xs-medium whitespace-nowrap text-text-primary" title={t(warningTextKey, { ns: 'common' })}>
              {t(warningTextKey, { ns: 'common' })}
            </span>
            <button
              type="button"
              className="flex size-4 shrink-0 items-center justify-center text-text-tertiary hover:text-text-secondary"
              aria-label={t('operation.close', { ns: 'common' })}
              onClick={() => setWarningDismissed(true)}
            >
              <span aria-hidden className="i-ri-close-line size-4" />
            </button>
          </div>
        </div>
      )}
      {IS_CLOUD_EDITION && <QuotaPanel providers={providers} />}
      {!filteredConfiguredProviders?.length && (
        <div className="mb-2 rounded-[10px] bg-workflow-process-bg p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border-[0.5px] border-components-card-border bg-components-card-bg shadow-lg backdrop-blur-sm">
            <span className="i-ri-brain-line h-5 w-5 text-text-primary" />
          </div>
          <div className="mt-2 system-sm-medium text-text-secondary">{t('modelProvider.emptyProviderTitle', { ns: 'common' })}</div>
          <div className="mt-1 system-xs-regular text-text-tertiary">{t('modelProvider.emptyProviderTip', { ns: 'common' })}</div>
        </div>
      )}
      {!!filteredConfiguredProviders?.length && (
        <div className="relative">
          {filteredConfiguredProviders?.map(provider => (
            <ProviderAddedCard
              key={provider.provider}
              provider={provider}
              pluginDetail={pluginDetailMap.get(providerToPluginId(provider.provider))}
            />
          ))}
        </div>
      )}
      {!!filteredNotConfiguredProviders?.length && (
        <>
          <div className="mb-2 flex items-center pt-2 system-md-semibold text-text-primary">{t('modelProvider.toBeConfigured', { ns: 'common' })}</div>
          <div className="relative">
            {filteredNotConfiguredProviders?.map(provider => (
              <ProviderAddedCard
                notConfigured
                key={provider.provider}
                provider={provider}
                pluginDetail={pluginDetailMap.get(providerToPluginId(provider.provider))}
              />
            ))}
          </div>
        </>
      )}
      {
        enableMarketplace && (
          <InstallFromMarketplace
            providers={providers}
            searchText={searchText}
          />
        )
      }
      {showPluginSettingModal && referenceSetting && (
        <ReferenceSettingModal
          payload={referenceSetting}
          onHide={() => setShowPluginSettingModal(false)}
          onSave={setReferenceSettings}
        />
      )}
    </div>
  )
}

export default ModelProviderPage

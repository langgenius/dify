import type { FC } from 'react'
import type { ModelItem, ModelProvider } from '../declarations'
import type { WorkflowTranslate } from './status-indicators'
import { cn } from '@langgenius/dify-ui/cn'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Loading from '@/app/components/base/loading'
import { PluginCategoryEnum } from '@/app/components/plugins/types'
import { InstallPluginButton } from '@/app/components/workflow/nodes/_base/components/install-plugin-button'
import { useProviderContext } from '@/context/provider-context'
import {
  useInvalidateInstalledPluginList,
  useModelInList,
  usePluginInfo,
} from '@/service/use-plugins'
import { ConfigurationMethodEnum, ModelTypeEnum } from '../declarations'
import {
  useLazyModelProviderDetail,
  useModelModalHandler,
  useUpdateModelList,
  useUpdateModelProviders,
} from '../hooks'
import ModelIcon from '../model-icon'
import ConfigurationButton from './configuration-button'
import ModelDisplay from './model-display'
import StatusIndicators from './status-indicators'

type AgentModelTriggerProps = {
  open?: boolean
  disabled?: boolean
  currentProvider?: ModelProvider
  currentModel?: ModelItem
  providerName?: string
  modelId?: string
  hasDeprecated?: boolean
  scope?: string
}

const AgentModelTrigger: FC<AgentModelTriggerProps> = ({
  disabled,
  currentProvider,
  currentModel,
  providerName,
  modelId,
  hasDeprecated,
  scope,
}) => {
  const { t } = useTranslation()
  const translateWorkflow: WorkflowTranslate = (selector, options) => t(selector, options)
  const { modelProviders } = useProviderContext()
  const updateModelProviders = useUpdateModelProviders()
  const updateModelList = useUpdateModelList()
  const { modelProvider, needsConfiguration } = useMemo(() => {
    const modelProvider = modelProviders.find((item) => item.provider === providerName)
    const needsConfiguration = modelProvider ? !modelProvider.is_configured : false
    return {
      modelProvider,
      needsConfiguration,
    }
  }, [modelProviders, providerName])
  const [installed, setInstalled] = useState(false)
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()
  const handleOpenModal = useModelModalHandler()
  const { loadProviderDetail, isLoadingProviderDetail } = useLazyModelProviderDetail(
    providerName ?? '',
  )

  const { data: inModelList = false } = useModelInList(currentProvider, modelId)
  const { data: pluginInfo, isLoading: isPluginLoading } = usePluginInfo(providerName)

  const handleConfigure = async () => {
    if (!providerName) return

    const providerDetail = await loadProviderDetail()
    if (!providerDetail) return

    handleOpenModal(providerDetail, ConfigurationMethodEnum.predefinedModel, undefined)
  }

  if (modelId && isPluginLoading) return <Loading />

  return (
    <div
      className={cn(
        'group relative flex grow cursor-pointer items-center gap-0.5 rounded-lg bg-components-input-bg-normal p-1 hover:bg-state-base-hover-alt',
      )}
    >
      {modelId ? (
        <>
          <ModelIcon
            className="p-0.5"
            provider={currentProvider || modelProvider}
            modelName={currentModel?.model || modelId}
            isDeprecated={hasDeprecated}
          />
          <ModelDisplay currentModel={currentModel} modelId={modelId} />
          {needsConfiguration && (
            <ConfigurationButton loading={isLoadingProviderDetail} onConfigure={handleConfigure} />
          )}
          <StatusIndicators
            needsConfiguration={needsConfiguration}
            modelProvider={!!modelProvider}
            inModelList={inModelList}
            disabled={!!disabled}
            pluginInfo={pluginInfo}
            t={translateWorkflow}
          />
          {!installed && !modelProvider && pluginInfo?.latest_package_identifier && (
            <InstallPluginButton
              onClick={(e) => e.stopPropagation()}
              size="small"
              uniqueIdentifier={pluginInfo.latest_package_identifier}
              onSuccess={() => {
                ;[
                  ModelTypeEnum.textGeneration,
                  ModelTypeEnum.textEmbedding,
                  ModelTypeEnum.rerank,
                  ModelTypeEnum.moderation,
                  ModelTypeEnum.speech2text,
                  ModelTypeEnum.tts,
                ].forEach((type: ModelTypeEnum) => {
                  if (scope?.includes(type)) updateModelList(type)
                })
                updateModelProviders()
                invalidateInstalledPluginList(PluginCategoryEnum.model)
                setInstalled(true)
              }}
            />
          )}
          {modelProvider && !disabled && !needsConfiguration && (
            <div className="flex items-center pr-1">
              <span className="i-ri-equalizer-2-line size-4 text-text-tertiary group-hover:text-text-secondary" />
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex grow items-center gap-1 p-1 pl-2">
            <span className="truncate system-sm-regular text-components-input-text-placeholder">
              {t(($) => $['nodes.agent.configureModel'], { ns: 'workflow' })}
            </span>
          </div>
          <div className="flex items-center pr-1">
            <span className="i-ri-equalizer-2-line size-4 text-text-tertiary group-hover:text-text-secondary" />
          </div>
        </>
      )}
    </div>
  )
}

export default AgentModelTrigger

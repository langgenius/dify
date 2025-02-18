import type { FC } from 'react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  ModelItem,
  ModelProvider,
} from '../declarations'
import {
  CustomConfigurationStatusEnum,
  ModelTypeEnum,
} from '../declarations'
import { useInvalidateInstalledPluginList } from '@/service/use-plugins'
import ConfigurationButton from './configuration-button'
import Loading from '@/app/components/base/loading'
import {
  useModelModalHandler,
  useUpdateModelList,
  useUpdateModelProviders,
} from '../hooks'
import ModelIcon from '../model-icon'
import ModelDisplay from './model-display'
import { InstallPluginButton } from '@/app/components/workflow/nodes/_base/components/install-plugin-button'
import StatusIndicators from './status-indicators'
import cn from '@/utils/classnames'
import { useProviderContext } from '@/context/provider-context'
import { RiEqualizer2Line } from '@remixicon/react'
import { useModelInList, usePluginInfo } from '@/service/use-plugins'

export type AgentModelTriggerProps = {
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
  const { modelProviders } = useProviderContext()
  const updateModelProviders = useUpdateModelProviders()
  const updateModelList = useUpdateModelList()
  const { modelProvider, needsConfiguration } = useMemo(() => {
    const modelProvider = modelProviders.find(item => item.provider === providerName)
    const needsConfiguration = modelProvider?.custom_configuration.status === CustomConfigurationStatusEnum.noConfigure && !(
      modelProvider.system_configuration.enabled === true
      && modelProvider.system_configuration.quota_configurations.find(
        item => item.quota_type === modelProvider.system_configuration.current_quota_type,
      )
    )
    return {
      modelProvider,
      needsConfiguration,
    }
  }, [modelProviders, providerName])
  const [installed, setInstalled] = useState(false)
  const invalidateInstalledPluginList = useInvalidateInstalledPluginList()
  const handleOpenModal = useModelModalHandler()

  const { data: inModelList = false } = useModelInList(currentProvider, modelId)
  const { data: pluginInfo, isLoading: isPluginLoading } = usePluginInfo(providerName)

  if (modelId && isPluginLoading)
    return <Loading />

  return (
    <div
      className={cn(
        'bg-components-input-bg-normal hover:bg-state-base-hover-alt group relative flex grow cursor-pointer items-center gap-[2px] rounded-lg p-1',
      )}
    >
      {modelId ? (
        <>
          <ModelIcon
            className='p-0.5'
            provider={currentProvider || modelProvider}
            modelName={currentModel?.model || modelId}
            isDeprecated={hasDeprecated}
          />
          <ModelDisplay
            currentModel={currentModel}
            modelId={modelId}
          />
          {needsConfiguration && (
            <ConfigurationButton
              modelProvider={modelProvider}
              handleOpenModal={handleOpenModal}
            />
          )}
          <StatusIndicators
            needsConfiguration={needsConfiguration}
            modelProvider={!!modelProvider}
            inModelList={inModelList}
            disabled={!!disabled}
            pluginInfo={pluginInfo}
            t={t}
          />
          {!installed && !modelProvider && pluginInfo && (
            <InstallPluginButton
              onClick={e => e.stopPropagation()}
              size={'small'}
              uniqueIdentifier={pluginInfo.latest_package_identifier}
              onSuccess={() => {
                [
                  ModelTypeEnum.textGeneration,
                  ModelTypeEnum.textEmbedding,
                  ModelTypeEnum.rerank,
                  ModelTypeEnum.moderation,
                  ModelTypeEnum.speech2text,
                  ModelTypeEnum.tts,
                ].forEach((type: ModelTypeEnum) => {
                  if (scope?.includes(type))
                    updateModelList(type)
                },
                )
                updateModelProviders()
                invalidateInstalledPluginList()
                setInstalled(true)
              }}
            />
          )}
          {modelProvider && !disabled && !needsConfiguration && (
            <div className="flex items-center pr-1">
              <RiEqualizer2Line className="text-text-tertiary group-hover:text-text-secondary h-4 w-4" />
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex grow items-center gap-1 p-1 pl-2">
            <span className="system-sm-regular text-components-input-text-placeholder overflow-hidden text-ellipsis whitespace-nowrap">
              {t('workflow.nodes.agent.configureModel')}
            </span>
          </div>
          <div className="flex items-center pr-1">
            <RiEqualizer2Line className="text-text-tertiary group-hover:text-text-secondary h-4 w-4" />
          </div>
        </>
      )}
    </div>
  )
}

export default AgentModelTrigger

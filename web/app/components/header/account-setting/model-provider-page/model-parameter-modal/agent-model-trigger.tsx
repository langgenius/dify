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
        'relative group flex items-center p-1 gap-[2px] flex-grow rounded-lg bg-components-input-bg-normal cursor-pointer hover:bg-state-base-hover-alt',
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
            <div className="flex pr-1 items-center">
              <RiEqualizer2Line className="w-4 h-4 text-text-tertiary group-hover:text-text-secondary" />
            </div>
          )}
        </>
      ) : (
        <>
          <div className="flex p-1 pl-2 items-center gap-1 grow">
            <span className="overflow-hidden text-ellipsis whitespace-nowrap system-sm-regular text-components-input-text-placeholder">
              {t('workflow.nodes.agent.configureModel')}
            </span>
          </div>
          <div className="flex pr-1 items-center">
            <RiEqualizer2Line className="w-4 h-4 text-text-tertiary group-hover:text-text-secondary" />
          </div>
        </>
      )}
    </div>
  )
}

export default AgentModelTrigger

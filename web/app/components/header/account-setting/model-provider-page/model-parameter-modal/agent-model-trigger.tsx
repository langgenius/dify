import type { FC } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  CustomConfigurationModelFixedFields,
  ModelItem,
  ModelProvider,
} from '../declarations'
import {
  ConfigurationMethodEnum,
  CustomConfigurationStatusEnum,
} from '../declarations'
import { UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST } from '../provider-added-card'
import type { PluginInfoFromMarketPlace } from '@/app/components/plugins/types'
import { useInstallPackageFromMarketPlace } from '@/service/use-plugins'
import ConfigurationButton from './configuration-button'
import { PluginType } from '@/app/components/plugins/types'
import {
  useUpdateModelList,
  useUpdateModelProviders,
} from '../hooks'
import ModelIcon from '../model-icon'
import ModelDisplay from './model-display'
import InstallButton from '@/app/components/base/install-button'
import StatusIndicators from './status-indicators'
import cn from '@/utils/classnames'
import { useProviderContext } from '@/context/provider-context'
import { useModalContextSelector } from '@/context/modal-context'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import { RiEqualizer2Line } from '@remixicon/react'
import { fetchPluginInfoFromMarketPlace } from '@/service/plugins'

export type AgentModelTriggerProps = {
  open?: boolean
  disabled?: boolean
  currentProvider?: ModelProvider
  currentModel?: ModelItem
  providerName?: string
  modelId?: string
  hasDeprecated?: boolean
}

const AgentModelTrigger: FC<AgentModelTriggerProps> = ({
  disabled,
  currentProvider,
  currentModel,
  providerName,
  modelId,
  hasDeprecated,
}) => {
  const { t } = useTranslation()
  const { modelProviders } = useProviderContext()
  const setShowModelModal = useModalContextSelector(state => state.setShowModelModal)
  const updateModelProviders = useUpdateModelProviders()
  const updateModelList = useUpdateModelList()
  const { eventEmitter } = useEventEmitterContextContext()
  const modelProvider = modelProviders.find(item => item.provider === providerName)
  const needsConfiguration = modelProvider?.custom_configuration.status === CustomConfigurationStatusEnum.noConfigure && !(
    modelProvider.system_configuration.enabled === true
    && modelProvider.system_configuration.quota_configurations.find(
      item => item.quota_type === modelProvider.system_configuration.current_quota_type,
    )
  )
  const [pluginInfo, setPluginInfo] = useState<PluginInfoFromMarketPlace | null>(null)
  const [isPluginChecked, setIsPluginChecked] = useState(false)
  const [loading, setLoading] = useState(false)
  const [installed, setInstalled] = useState(false)
  const { mutateAsync: installPackageFromMarketPlace } = useInstallPackageFromMarketPlace()

  useEffect(() => {
    (async () => {
      if (providerName && !modelProvider) {
        const parts = providerName.split('/')
        const org = parts[0]
        const name = parts[1]
        try {
          const pluginInfo = await fetchPluginInfoFromMarketPlace({ org, name })
          if (pluginInfo.data.plugin.category === PluginType.model)
            setPluginInfo(pluginInfo.data.plugin)
        }
        catch (error) {
          // pass
        }
        setIsPluginChecked(true)
      }
      else {
        setIsPluginChecked(true)
      }
    })()
  }, [providerName, modelProvider])

  if (modelId && !isPluginChecked)
    return null

  const handleOpenModal = (
    provider: ModelProvider,
    configurationMethod: ConfigurationMethodEnum,
    CustomConfigurationModelFixedFields?: CustomConfigurationModelFixedFields,
  ) => {
    setShowModelModal({
      payload: {
        currentProvider: provider,
        currentConfigurationMethod: configurationMethod,
        currentCustomConfigurationModelFixedFields: CustomConfigurationModelFixedFields,
      },
      onSaveCallback: () => {
        updateModelProviders()

        provider.supported_model_types.forEach((type) => {
          updateModelList(type)
        })

        if (configurationMethod === ConfigurationMethodEnum.customizableModel
            && provider.custom_configuration.status === CustomConfigurationStatusEnum.active) {
          eventEmitter?.emit({
            type: UPDATE_MODEL_PROVIDER_CUSTOM_MODEL_LIST,
            payload: provider.provider,
          } as any)

          if (CustomConfigurationModelFixedFields?.__model_type)
            updateModelList(CustomConfigurationModelFixedFields.__model_type)
        }
      },
    })
  }

  return (
    <div
      className={cn(
        'relative group flex items-center p-1 gap-[2px] flex-grow rounded-lg bg-components-input-bg-normal cursor-pointer hover:bg-state-base-hover-alt',
      )}
    >
      {modelId ? (
        <>
          <ModelIcon
            className="m-0.5"
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
            disabled={!!disabled}
            pluginInfo={pluginInfo}
            t={t}
          />
          {!installed && !modelProvider && pluginInfo && (
            <InstallButton
              loading={loading}
              onInstall={async () => {
                setLoading(true)
                const { all_installed } = await installPackageFromMarketPlace(pluginInfo.latest_package_identifier)
                if (all_installed)
                  setInstalled(true)
              }}
              t={t}
            />
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

import type { FC } from 'react'
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
import { ModelStatusEnum } from '../declarations'
import {
  useUpdateModelList,
  useUpdateModelProviders,
} from '../hooks'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'
import Button from '@/app/components/base/button'
import cn from '@/utils/classnames'
import { useProviderContext } from '@/context/provider-context'
import { useModalContextSelector } from '@/context/modal-context'
import { useEventEmitterContextContext } from '@/context/event-emitter'
import Tooltip from '@/app/components/base/tooltip'
import { RiEqualizer2Line, RiErrorWarningFill } from '@remixicon/react'

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
          {currentProvider && (
            <ModelIcon
              className="m-0.5"
              provider={currentProvider}
              modelName={currentModel?.model}
              isDeprecated={hasDeprecated}
            />
          )}
          {!currentProvider && (
            <ModelIcon
              className="m-0.5"
              provider={modelProvider}
              modelName={modelId}
              isDeprecated={hasDeprecated}
            />
          )}
          {currentModel && (
            <ModelName
              className="flex px-1 py-[3px] items-center gap-1 grow"
              modelItem={currentModel}
              showMode
              showFeatures
            />
          )}
          {!currentModel && (
            <div className="flex py-[3px] px-1 items-center gap-1 grow opacity-50 truncate">
              <div className="text-components-input-text-filled text-ellipsis overflow-hidden system-sm-regular">
                {modelId}
              </div>
            </div>
          )}
          {needsConfiguration && (
            <Button
              size="small"
              className="z-[100]"
              onClick={(e) => {
                e.stopPropagation()
                handleOpenModal(modelProvider, ConfigurationMethodEnum.predefinedModel, undefined)
              }}
            >
              <div className="flex px-[3px] justify-center items-center gap-1">
                {t('workflow.nodes.agent.notAuthorized')}
              </div>
              <div className="flex w-[14px] h-[14px] justify-center items-center">
                <div className="w-2 h-2 shrink-0 rounded-[3px] border border-components-badge-status-light-warning-border-inner
                  bg-components-badge-status-light-warning-bg shadow-components-badge-status-light-warning-halo" />
              </div>
            </Button>
          )}
          {!needsConfiguration && disabled && (
            <Tooltip
              popupContent={t('workflow.nodes.agent.modelSelectorTooltips.deprecated')}
              asChild={false}
            >
              <RiErrorWarningFill className='w-4 h-4 text-text-destructive' />
            </Tooltip>
          )
          }
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
      {currentProvider && currentModel && currentModel.status === ModelStatusEnum.active && (
        <div className="flex pr-1 items-center">
          <RiEqualizer2Line className="w-4 h-4 text-text-tertiary group-hover:text-text-secondary" />
        </div>
      )}
    </div>
  )
}

export default AgentModelTrigger

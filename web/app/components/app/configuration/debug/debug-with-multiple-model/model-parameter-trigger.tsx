import type { ComponentPropsWithRef, FC } from 'react'
import type { ModelAndParameter } from '../types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useQuery } from '@tanstack/react-query'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  DERIVED_MODEL_STATUS_BADGE_I18N,
  DERIVED_MODEL_STATUS_TOOLTIP_I18N,
  deriveModelStatus,
} from '@/app/components/header/account-setting/model-provider-page/derive-model-status'
import { useTextGenerationCurrentProviderAndModelAndModelList } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelIcon from '@/app/components/header/account-setting/model-provider-page/model-icon'
import ModelName from '@/app/components/header/account-setting/model-provider-page/model-name'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { useCredentialPanelState } from '@/app/components/header/account-setting/model-provider-page/provider-added-card/use-credential-panel-state'
import { useDebugConfigurationContext } from '@/context/debug-configuration'
import { consoleQuery } from '@/service/client'
import { useDebugWithMultipleModelContext } from './context'

type ModelParameterTriggerProps = {
  modelAndParameter: ModelAndParameter
}

type DebugModelParameterTriggerProps = ComponentPropsWithRef<'button'> & ModelParameterTriggerProps

const DebugModelParameterTrigger: FC<DebugModelParameterTriggerProps> = ({
  modelAndParameter,
  className,
  ...triggerProps
}) => {
  const { t } = useTranslation()
  const { currentProvider, currentModel } = useTextGenerationCurrentProviderAndModelAndModelList({
    provider: modelAndParameter.provider,
    model: modelAndParameter.model,
  })
  const { data: providerMeta } = useQuery({
    ...consoleQuery.workspaces.current.modelProviders.summary.get.queryOptions(),
    enabled: !!modelAndParameter.provider,
    select: ({ data }) => data.find((provider) => provider.provider === modelAndParameter.provider),
  })
  const credentialPanel = useCredentialPanelState(providerMeta)
  const status = deriveModelStatus(
    modelAndParameter.model,
    modelAndParameter.provider,
    providerMeta,
    currentModel,
    credentialPanel,
  )
  const iconProvider = currentProvider || providerMeta
  const statusLabelKey =
    DERIVED_MODEL_STATUS_BADGE_I18N[status as keyof typeof DERIVED_MODEL_STATUS_BADGE_I18N]
  const statusTooltipKey =
    DERIVED_MODEL_STATUS_TOOLTIP_I18N[status as keyof typeof DERIVED_MODEL_STATUS_TOOLTIP_I18N]
  const isEmpty = status === 'empty'
  const isActive = status === 'active'
  const statusTooltipLabel =
    !isEmpty && !isActive && statusLabelKey
      ? t(($) => $[statusTooltipKey || statusLabelKey], { ns: 'common' })
      : undefined

  return (
    <Tooltip>
      <TooltipTrigger
        disabled={!statusTooltipLabel}
        render={
          <button
            {...triggerProps}
            type="button"
            className={cn(
              'flex h-8 max-w-50 cursor-pointer items-center rounded-lg px-2 data-popup-open:bg-state-base-hover',
              !isEmpty && !isActive && 'bg-[#FFFAEB]!',
              className,
            )}
          >
            {iconProvider && !isEmpty && (
              <ModelIcon
                className="mr-1 size-4!"
                provider={iconProvider}
                modelName={currentModel?.model || modelAndParameter.model}
              />
            )}
            {(!iconProvider || isEmpty) && (
              <span className="mr-1 flex size-4 items-center justify-center rounded-sm">
                <span
                  aria-hidden
                  className="i-custom-vender-line-shapes-cube-outline size-4 text-text-accent"
                />
              </span>
            )}
            {currentModel && (
              <ModelName className="mr-0.5 text-text-secondary" modelItem={currentModel} />
            )}
            {!currentModel && !isEmpty && (
              <span className="mr-0.5 truncate text-[13px] font-medium text-text-secondary">
                {modelAndParameter.model}
              </span>
            )}
            {isEmpty && (
              <span className="mr-0.5 truncate text-[13px] font-medium text-text-accent">
                {t(($) => $['modelProvider.selectModel'], { ns: 'common' })}
              </span>
            )}
            <span
              aria-hidden
              className={`i-ri-arrow-down-s-line size-3 ${isEmpty ? 'text-text-accent' : 'text-text-tertiary'}`}
            />
            {statusTooltipLabel && (
              <span
                aria-label={statusTooltipLabel}
                className="i-custom-vender-line-alertsAndFeedback-alert-triangle h-4 w-4 text-[#F79009]"
              />
            )}
          </button>
        }
      />
      {statusTooltipLabel && <TooltipContent>{statusTooltipLabel}</TooltipContent>}
    </Tooltip>
  )
}

const ModelParameterTrigger: FC<ModelParameterTriggerProps> = ({ modelAndParameter }) => {
  const { isAdvancedMode } = useDebugConfigurationContext()
  const { multipleModelConfigs, onMultipleModelConfigsChange, onDebugWithMultipleModelChange } =
    useDebugWithMultipleModelContext()
  const index = multipleModelConfigs.findIndex((v) => v.id === modelAndParameter.id)

  const handleSelectModel = ({ modelId, provider }: { modelId: string; provider: string }) => {
    const newModelConfigs = [...multipleModelConfigs]
    newModelConfigs[index] = {
      ...newModelConfigs[index]!,
      model: modelId,
      provider,
    }
    onMultipleModelConfigsChange(true, newModelConfigs)
  }
  const handleParamsChange = (params: FormValue) => {
    const newModelConfigs = [...multipleModelConfigs]
    newModelConfigs[index] = {
      ...newModelConfigs[index]!,
      parameters: params,
    }
    onMultipleModelConfigsChange(true, newModelConfigs)
  }

  return (
    <ModelParameterModal
      isAdvancedMode={isAdvancedMode}
      provider={modelAndParameter.provider}
      modelId={modelAndParameter.model}
      completionParams={modelAndParameter.parameters}
      onCompletionParamsChange={handleParamsChange}
      setModel={handleSelectModel}
      debugWithMultipleModel
      onDebugWithMultipleModelChange={() => onDebugWithMultipleModelChange(modelAndParameter)}
      trigger={<DebugModelParameterTrigger modelAndParameter={modelAndParameter} />}
    />
  )
}

export default memo(ModelParameterTrigger)

import type { FC } from 'react'
import type { ModelAndParameter } from '../types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import Tooltip from '@/app/components/base/tooltip'
import {
  DERIVED_MODEL_STATUS_BADGE_I18N,
  DERIVED_MODEL_STATUS_TOOLTIP_I18N,
  deriveModelStatus,
} from '@/app/components/header/account-setting/model-provider-page/derive-model-status'
import ModelIcon from '@/app/components/header/account-setting/model-provider-page/model-icon'
import ModelName from '@/app/components/header/account-setting/model-provider-page/model-name'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { useCredentialPanelState } from '@/app/components/header/account-setting/model-provider-page/provider-added-card/use-credential-panel-state'
import { useDebugConfigurationContext } from '@/context/debug-configuration'
import { useProviderContext } from '@/context/provider-context'
import { useDebugWithMultipleModelContext } from './context'

type ModelParameterTriggerProps = {
  modelAndParameter: ModelAndParameter
}
const ModelParameterTrigger: FC<ModelParameterTriggerProps> = ({
  modelAndParameter,
}) => {
  const { t } = useTranslation()
  const {
    isAdvancedMode,
  } = useDebugConfigurationContext()
  const {
    multipleModelConfigs,
    onMultipleModelConfigsChange,
    onDebugWithMultipleModelChange,
  } = useDebugWithMultipleModelContext()
  const { modelProviders } = useProviderContext()
  const index = multipleModelConfigs.findIndex(v => v.id === modelAndParameter.id)
  const providerMeta = modelProviders.find(provider => provider.provider === modelAndParameter.provider)
  const credentialState = useCredentialPanelState(providerMeta)

  const handleSelectModel = ({ modelId, provider }: { modelId: string, provider: string }) => {
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
      renderTrigger={({
        open,
        currentProvider,
        currentModel,
      }) => {
        const status = deriveModelStatus(
          modelAndParameter.model,
          modelAndParameter.provider,
          providerMeta,
          currentModel ?? undefined,
          credentialState,
        )
        const iconProvider = currentProvider || providerMeta
        const statusLabelKey = DERIVED_MODEL_STATUS_BADGE_I18N[status as keyof typeof DERIVED_MODEL_STATUS_BADGE_I18N]
        const statusTooltipKey = DERIVED_MODEL_STATUS_TOOLTIP_I18N[status as keyof typeof DERIVED_MODEL_STATUS_TOOLTIP_I18N]
        const isEmpty = status === 'empty'
        const isActive = status === 'active'

        return (
          <div
            className={`
              flex h-8 max-w-[200px] cursor-pointer items-center rounded-lg px-2
              ${open && 'bg-state-base-hover'}
              ${!isEmpty && !isActive && 'bg-[#FFFAEB]!'}
            `}
          >
            {
              iconProvider && !isEmpty && (
                <ModelIcon
                  className="mr-1 h-4! w-4!"
                  provider={iconProvider}
                  modelName={currentModel?.model || modelAndParameter.model}
                />
              )
            }
            {
              (!iconProvider || isEmpty) && (
                <div className="mr-1 flex h-4 w-4 items-center justify-center rounded-sm">
                  <span className="i-custom-vender-line-shapes-cube-outline h-4 w-4 text-text-accent" />
                </div>
              )
            }
            {
              currentModel && (
                <ModelName
                  className="mr-0.5 text-text-secondary"
                  modelItem={currentModel}
                />
              )
            }
            {
              !currentModel && !isEmpty && (
                <div className="mr-0.5 truncate text-[13px] font-medium text-text-secondary">
                  {modelAndParameter.model}
                </div>
              )
            }
            {
              isEmpty && (
                <div className="mr-0.5 truncate text-[13px] font-medium text-text-accent">
                  {t('modelProvider.selectModel', { ns: 'common' })}
                </div>
              )
            }
            <span className={`i-ri-arrow-down-s-line h-3 w-3 ${isEmpty ? 'text-text-accent' : 'text-text-tertiary'}`} />
            {
              !isEmpty && !isActive && statusLabelKey && (
                <Tooltip popupContent={t((statusTooltipKey || statusLabelKey) as 'modelProvider.selector.incompatible', { ns: 'common' })}>
                  <span className="i-custom-vender-line-alertsAndFeedback-alert-triangle h-4 w-4 text-[#F79009]" />
                </Tooltip>
              )
            }
          </div>
        )
      }}
    />
  )
}

export default memo(ModelParameterTrigger)

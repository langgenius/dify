import type { FC } from 'react'
import type { ModelAndParameter } from '../types'
import type { FormValue } from '@/app/components/header/account-setting/model-provider-page/declarations'
import { RiArrowDownSLine } from '@remixicon/react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import { CubeOutline } from '@/app/components/base/icons/src/vender/line/shapes'
import Tooltip from '@/app/components/base/tooltip'
import {

  MODEL_STATUS_TEXT,
  ModelStatusEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import ModelIcon from '@/app/components/header/account-setting/model-provider-page/model-icon'
import ModelName from '@/app/components/header/account-setting/model-provider-page/model-name'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import { useDebugConfigurationContext } from '@/context/debug-configuration'
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
  const language = useLanguage()
  const index = multipleModelConfigs.findIndex(v => v.id === modelAndParameter.id)

  const handleSelectModel = ({ modelId, provider }: { modelId: string, provider: string }) => {
    const newModelConfigs = [...multipleModelConfigs]
    newModelConfigs[index] = {
      ...newModelConfigs[index],
      model: modelId,
      provider,
    }
    onMultipleModelConfigsChange(true, newModelConfigs)
  }
  const handleParamsChange = (params: FormValue) => {
    const newModelConfigs = [...multipleModelConfigs]
    newModelConfigs[index] = {
      ...newModelConfigs[index],
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
      }) => (
        <div
          className={`
            flex h-8 max-w-[200px] cursor-pointer items-center rounded-lg px-2
            ${open && 'bg-state-base-hover'}
            ${currentModel && currentModel.status !== ModelStatusEnum.active && '!bg-[#FFFAEB]'}
          `}
        >
          {
            currentProvider && (
              <ModelIcon
                className="mr-1 !h-4 !w-4"
                provider={currentProvider}
                modelName={currentModel?.model}
              />
            )
          }
          {
            !currentProvider && (
              <div className="mr-1 flex h-4 w-4 items-center justify-center rounded">
                <CubeOutline className="h-4 w-4 text-text-accent" />
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
            !currentModel && (
              <div className="mr-0.5 truncate text-[13px] font-medium text-text-accent">
                {t('modelProvider.selectModel', { ns: 'common' })}
              </div>
            )
          }
          <RiArrowDownSLine className={`h-3 w-3 ${(currentModel && currentProvider) ? 'text-text-tertiary' : 'text-text-accent'}`} />
          {
            currentModel && currentModel.status !== ModelStatusEnum.active && (
              <Tooltip popupContent={MODEL_STATUS_TEXT[currentModel.status][language]}>
                <AlertTriangle className="h-4 w-4 text-[#F79009]" />
              </Tooltip>
            )
          }
        </div>
      )}
    />
  )
}

export default memo(ModelParameterTrigger)

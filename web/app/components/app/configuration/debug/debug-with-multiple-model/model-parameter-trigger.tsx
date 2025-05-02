import type { FC } from 'react'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine } from '@remixicon/react'
import type { ModelAndParameter } from '../types'
import { useDebugWithMultipleModelContext } from './context'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import ModelIcon from '@/app/components/header/account-setting/model-provider-page/model-icon'
import ModelName from '@/app/components/header/account-setting/model-provider-page/model-name'
import {
  MODEL_STATUS_TEXT,
  ModelStatusEnum,
} from '@/app/components/header/account-setting/model-provider-page/declarations'
import { useDebugConfigurationContext } from '@/context/debug-configuration'
import { CubeOutline } from '@/app/components/base/icons/src/vender/line/shapes'
import Tooltip from '@/app/components/base/tooltip'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'

type ModelParameterTriggerProps = {
  modelAndParameter: ModelAndParameter
}
const ModelParameterTrigger: FC<ModelParameterTriggerProps> = ({
  modelAndParameter,
}) => {
  const { t } = useTranslation()
  const {
    mode,
    isAdvancedMode,
  } = useDebugConfigurationContext()
  const {
    multipleModelConfigs,
    onMultipleModelConfigsChange,
    onDebugWithMultipleModelChange,
  } = useDebugWithMultipleModelContext()
  const language = useLanguage()
  const index = multipleModelConfigs.findIndex(v => v.id === modelAndParameter.id)

  const handleSelectModel = ({ modelId, provider }: { modelId: string; provider: string }) => {
    const newModelConfigs = [...multipleModelConfigs]
    newModelConfigs[index] = {
      ...newModelConfigs[index],
      model: modelId,
      provider,
    }
    onMultipleModelConfigsChange(true, newModelConfigs)
  }
  const handleParamsChange = (params: any) => {
    const newModelConfigs = [...multipleModelConfigs]
    newModelConfigs[index] = {
      ...newModelConfigs[index],
      parameters: params,
    }
    onMultipleModelConfigsChange(true, newModelConfigs)
  }

  return (
    <ModelParameterModal
      mode={mode}
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
            flex items-center max-w-[200px] h-8 px-2 rounded-lg cursor-pointer
            ${open && 'bg-state-base-hover'}
            ${currentModel && currentModel.status !== ModelStatusEnum.active && '!bg-[#FFFAEB]'}
          `}
        >
          {
            currentProvider && (
              <ModelIcon
                className='mr-1 !w-4 !h-4'
                provider={currentProvider}
                modelName={currentModel?.model}
              />
            )
          }
          {
            !currentProvider && (
              <div className='flex items-center justify-center mr-1 w-4 h-4 rounded'>
                <CubeOutline className='w-4 h-4 text-text-accent' />
              </div>
            )
          }
          {
            currentModel && (
              <ModelName
                className='mr-0.5 text-text-secondary'
                modelItem={currentModel}
              />
            )
          }
          {
            !currentModel && (
              <div className='mr-0.5 text-[13px] font-medium text-text-accent truncate'>
                {t('common.modelProvider.selectModel')}
              </div>
            )
          }
          <RiArrowDownSLine className={`w-3 h-3 ${(currentModel && currentProvider) ? 'text-text-tertiary' : 'text-text-accent'}`} />
          {
            currentModel && currentModel.status !== ModelStatusEnum.active && (
              <Tooltip popupContent={MODEL_STATUS_TEXT[currentModel.status][language]}>
                <AlertTriangle className='w-4 h-4 text-[#F79009]' />
              </Tooltip>
            )
          }
        </div>
      )}
    />
  )
}

export default memo(ModelParameterTrigger)

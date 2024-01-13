import type { FC } from 'react'
import { memo } from 'react'
import type { ModelAndParameter } from '../types'
import { useDebugWithMultipleModelContext } from './context'
import ModelParameterModal from '@/app/components/header/account-setting/model-provider-page/model-parameter-modal'
import ModelIcon from '@/app/components/header/account-setting/model-provider-page/model-icon'
import ModelName from '@/app/components/header/account-setting/model-provider-page/model-name'
import { useDebugConfigurationContext } from '@/context/debug-configuration'
import { ChevronDown } from '@/app/components/base/icons/src/vender/line/arrows'
import { CubeOutline } from '@/app/components/base/icons/src/vender/line/shapes'

type ModelParameterTriggerProps = {
  modelAndParameter: ModelAndParameter
  index: number
}
const ModelParameterTrigger: FC<ModelParameterTriggerProps> = ({
  modelAndParameter,
  index,
}) => {
  const {
    mode,
    isAdvancedMode,
  } = useDebugConfigurationContext()
  const {
    multipleModelConfigs,
    onMultipleModelConfigsChange,
  } = useDebugWithMultipleModelContext()
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
      onDebugWithMultipleModelChange={() => {}}
      renderTrigger={({
        open,
        currentProvider,
        currentModel,
      }) => (
        <div
          className={`
            flex items-center max-w-[200px] h-8 px-2 rounded-lg cursor-pointer
            ${open && 'bg-gray-100'}
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
              <div className='flex items-center justify-center mr-1 w-4 h-4 rounded border border-dashed border-primary-100'>
                <CubeOutline className='w-[11px] h-[11px] text-primary-600' />
              </div>
            )
          }
          {
            currentModel && (
              <ModelName
                className='mr-0.5 text-gray-800'
                modelItem={currentModel}
              />
            )
          }
          {
            !currentModel && (
              <div className='mr-0.5 text-[13px] font-medium text-primary-600 truncate'>
                Select Model
              </div>
            )
          }
          <ChevronDown className={`w-3 h-3 ${(currentModel && currentProvider) ? 'text-gray-800' : 'text-primary-600'}`} />
        </div>
      )}
    />
  )
}

export default memo(ModelParameterTrigger)

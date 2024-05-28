import type { FC } from 'react'
import type {
  Model,
  ModelItem,
} from '../declarations'
import {
  MODEL_STATUS_TEXT,
  ModelStatusEnum,
} from '../declarations'
import { useLanguage } from '../hooks'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import { ChevronDown } from '@/app/components/base/icons/src/vender/line/arrows'
import TooltipPlus from '@/app/components/base/tooltip-plus'

type ModelTriggerProps = {
  open: boolean
  provider: Model
  model: ModelItem
  className?: string
  readonly?: boolean
}
const ModelTrigger: FC<ModelTriggerProps> = ({
  open,
  provider,
  model,
  className,
  readonly,
}) => {
  const language = useLanguage()

  return (
    <div
      className={`
        group flex items-center px-2 h-8 rounded-lg bg-gray-100 
        ${!readonly && 'hover:bg-gray-200 cursor-pointer'}
        ${className}
        ${open && '!bg-gray-200'}
        ${model.status !== ModelStatusEnum.active && '!bg-[#FFFAEB]'}
      `}
    >
      <ModelIcon
        className='shrink-0 mr-1.5'
        provider={provider}
        modelName={model.model}
      />
      <ModelName
        className='grow'
        modelItem={model}
        showMode
        showFeatures
      />
      {!readonly && (
        <div className='shrink-0 flex items-center justify-center w-4 h-4'>
          {
            model.status !== ModelStatusEnum.active
              ? (
                <TooltipPlus popupContent={MODEL_STATUS_TEXT[model.status][language]}>
                  <AlertTriangle className='w-4 h-4 text-[#F79009]' />
                </TooltipPlus>
              )
              : (
                <ChevronDown
                  className='w-3.5 h-3.5 text-gray-500'
                />
              )
          }
        </div>
      )}

    </div>
  )
}

export default ModelTrigger

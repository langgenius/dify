import type { FC } from 'react'
import type {
  Model,
  ModelItem,
} from '../declarations'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'
// import { AlertTriangle } from '@/app/components/base/icons/src/vender/solid/alertsAndFeedback'
import { ChevronDown } from '@/app/components/base/icons/src/vender/line/arrows'

type ModelTriggerProps = {
  open: boolean
  provider: Model
  model: ModelItem
  className?: string
}
const ModelTrigger: FC<ModelTriggerProps> = ({
  open,
  provider,
  model,
  className,
}) => {
  return (
    <div
      className={`
        group flex items-center px-2 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 cursor-pointer
        ${className}
        ${open && '!bg-gray-200'}
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
      <div className='shrink-0 flex items-center justify-center w-4 h-4'>
        <ChevronDown
          className='w-3.5 h-3.5 text-gray-500'
        />
      </div>
    </div>
  )
}

export default ModelTrigger

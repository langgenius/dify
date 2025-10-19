import type { FC } from 'react'
import { RiArrowDownSLine } from '@remixicon/react'
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
import Tooltip from '@/app/components/base/tooltip'
import cn from '@/utils/classnames'

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
      className={cn(
        'group flex h-8 items-center gap-0.5 rounded-lg bg-components-input-bg-normal p-1',
        !readonly && 'cursor-pointer hover:bg-components-input-bg-hover',
        open && 'bg-components-input-bg-hover',
        model.status !== ModelStatusEnum.active && 'bg-components-input-bg-disabled hover:bg-components-input-bg-disabled',
        className,
      )}
    >
      <ModelIcon
        className='p-0.5'
        provider={provider}
        modelName={model.model}
      />
      <div className='flex grow items-center gap-1 truncate px-1 py-[3px]'>
        <ModelName
          className='grow'
          modelItem={model}
          showMode
          showFeatures
        />
        {!readonly && (
          <div className='flex h-4 w-4 shrink-0 items-center justify-center'>
            {
              model.status !== ModelStatusEnum.active
                ? (
                  <Tooltip popupContent={MODEL_STATUS_TEXT[model.status][language]}>
                    <AlertTriangle className='h-4 w-4 text-text-warning-secondary' />
                  </Tooltip>
                )
                : (
                  <RiArrowDownSLine
                    className='h-3.5 w-3.5 text-text-tertiary'
                  />
                )
            }
          </div>
        )}
      </div>
    </div>
  )
}

export default ModelTrigger

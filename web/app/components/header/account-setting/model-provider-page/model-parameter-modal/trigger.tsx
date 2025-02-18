import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { RiArrowDownSLine } from '@remixicon/react'
import type {
  Model,
  ModelItem,
  ModelProvider,
} from '../declarations'
import { MODEL_STATUS_TEXT } from '../declarations'
import { useLanguage } from '../hooks'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'
import cn from '@/utils/classnames'
import { useProviderContext } from '@/context/provider-context'
import { SlidersH } from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import Tooltip from '@/app/components/base/tooltip'

export type TriggerProps = {
  open?: boolean
  disabled?: boolean
  currentProvider?: ModelProvider | Model
  currentModel?: ModelItem
  providerName?: string
  modelId?: string
  hasDeprecated?: boolean
  modelDisabled?: boolean
  isInWorkflow?: boolean
}
const Trigger: FC<TriggerProps> = ({
  disabled,
  currentProvider,
  currentModel,
  providerName,
  modelId,
  hasDeprecated,
  modelDisabled,
  isInWorkflow,
}) => {
  const { t } = useTranslation()
  const language = useLanguage()
  const { modelProviders } = useProviderContext()

  return (
    <div
      className={cn(
        'relative flex h-8 cursor-pointer items-center rounded-lg  px-2',
        !isInWorkflow && 'border ring-inset hover:ring-[0.5px]',
        !isInWorkflow && (disabled ? 'border-text-warning ring-text-warning bg-state-warning-hover' : 'border-util-colors-indigo-indigo-600 ring-util-colors-indigo-indigo-600 bg-state-accent-hover'),
        isInWorkflow && 'bg-workflow-block-parma-bg border-workflow-block-parma-bg border pr-[30px]  hover:border-gray-200',
      )}
    >
      {
        currentProvider && (
          <ModelIcon
            className='mr-1.5 !h-5 !w-5'
            provider={currentProvider}
            modelName={currentModel?.model}
          />
        )
      }
      {
        !currentProvider && (
          <ModelIcon
            className='mr-1.5 !h-5 !w-5'
            provider={modelProviders.find(item => item.provider === providerName)}
            modelName={modelId}
          />
        )
      }
      {
        currentModel && (
          <ModelName
            className='text-text-primary mr-1.5'
            modelItem={currentModel}
            showMode
            showFeatures
          />
        )
      }
      {
        !currentModel && (
          <div className='text-text-primary mr-1 truncate text-[13px] font-medium'>
            {modelId}
          </div>
        )
      }
      {
        disabled
          ? (
            <Tooltip
              popupContent={
                hasDeprecated
                  ? t('common.modelProvider.deprecated')
                  : (modelDisabled && currentModel)
                    ? MODEL_STATUS_TEXT[currentModel.status as string][language]
                    : ''
              }
            >
              <AlertTriangle className='h-4 w-4 text-[#F79009]' />
            </Tooltip>
          )
          : (
            <SlidersH className={cn(!isInWorkflow ? 'text-indigo-600' : 'text-text-tertiary', 'h-4 w-4 shrink-0')} />
          )
      }
      {isInWorkflow && (<RiArrowDownSLine className='text-text-tertiary absolute right-2 top-[9px] h-3.5 w-3.5' />)}
    </div>
  )
}

export default Trigger

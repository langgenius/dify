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
        'relative flex items-center px-2 h-8 rounded-lg  cursor-pointer',
        !isInWorkflow && 'border ring-inset hover:ring-[0.5px]',
        !isInWorkflow && (disabled ? 'border-text-warning ring-text-warning bg-state-warning-hover' : 'border-util-colors-indigo-indigo-600 ring-util-colors-indigo-indigo-600 bg-state-accent-hover'),
        isInWorkflow && 'pr-[30px] bg-workflow-block-parma-bg border border-workflow-block-parma-bg  hover:border-gray-200',
      )}
    >
      {
        currentProvider && (
          <ModelIcon
            className='mr-1.5 !w-5 !h-5'
            provider={currentProvider}
            modelName={currentModel?.model}
          />
        )
      }
      {
        !currentProvider && (
          <ModelIcon
            className='mr-1.5 !w-5 !h-5'
            provider={modelProviders.find(item => item.provider === providerName)}
            modelName={modelId}
          />
        )
      }
      {
        currentModel && (
          <ModelName
            className='mr-1.5 text-text-primary'
            modelItem={currentModel}
            showMode
            showFeatures
          />
        )
      }
      {
        !currentModel && (
          <div className='mr-1 text-[13px] font-medium text-text-primary truncate'>
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
              <AlertTriangle className='w-4 h-4 text-[#F79009]' />
            </Tooltip>
          )
          : (
            <SlidersH className={cn(!isInWorkflow ? 'text-indigo-600' : 'text-text-tertiary', 'shrink-0 w-4 h-4')} />
          )
      }
      {isInWorkflow && (<RiArrowDownSLine className='absolute top-[9px] right-2 w-3.5 h-3.5 text-text-tertiary' />)}
    </div>
  )
}

export default Trigger

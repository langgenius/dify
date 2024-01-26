import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  Model,
  ModelItem,
  ModelProvider,
} from '../declarations'
import { MODEL_STATUS_TEXT } from '../declarations'
import { useLanguage } from '../hooks'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'
import { useProviderContext } from '@/context/provider-context'
import { SlidersH } from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import TooltipPlus from '@/app/components/base/tooltip-plus'

export type TriggerProps = {
  open?: boolean
  disabled?: boolean
  currentProvider?: ModelProvider | Model
  currentModel?: ModelItem
  providerName?: string
  modelId?: string
  hasDeprecated?: boolean
  modelDisabled?: boolean
}
const Trigger: FC<TriggerProps> = ({
  disabled,
  currentProvider,
  currentModel,
  providerName,
  modelId,
  hasDeprecated,
  modelDisabled,
}) => {
  const { t } = useTranslation()
  const language = useLanguage()
  const { modelProviders } = useProviderContext()

  return (
    <div
      className={`
        flex items-center px-2 h-8 rounded-lg border cursor-pointer hover:border-[1.5px]
        ${disabled ? 'border-[#F79009] bg-[#FFFAEB]' : 'border-[#444CE7] bg-primary-50'}
      `}
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
            className='mr-1.5 text-gray-900'
            modelItem={currentModel}
            showMode
            modeClassName='!text-[#444CE7] !border-[#A4BCFD]'
            showFeatures
            featuresClassName='!text-[#444CE7] !border-[#A4BCFD]'
          />
        )
      }
      {
        !currentModel && (
          <div className='mr-1 text-[13px] font-medium text-gray-900 truncate'>
            {modelId}
          </div>
        )
      }
      {
        disabled
          ? (
            <TooltipPlus
              popupContent={
                hasDeprecated
                  ? t('common.modelProvider.deprecated')
                  : (modelDisabled && currentModel)
                    ? MODEL_STATUS_TEXT[currentModel.status as string][language]
                    : ''
              }
            >
              <AlertTriangle className='w-4 h-4 text-[#F79009]' />
            </TooltipPlus>
          )
          : (
            <SlidersH className='w-4 h-4 text-indigo-600' />
          )
      }
    </div>
  )
}

export default Trigger

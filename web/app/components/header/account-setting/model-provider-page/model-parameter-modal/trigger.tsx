import type { FC } from 'react'
import type {
  Model,
  ModelItem,
  ModelProvider,
} from '../declarations'
import { RiArrowDownSLine } from '@remixicon/react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from '@/app/components/base/icons/src/vender/line/alertsAndFeedback'
import { SlidersH } from '@/app/components/base/icons/src/vender/line/mediaAndDevices'
import Tooltip from '@/app/components/base/tooltip'
import { useProviderContext } from '@/context/provider-context'
import { cn } from '@/utils/classnames'
import { MODEL_STATUS_TEXT } from '../declarations'
import { useLanguage } from '../hooks'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'

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
        !isInWorkflow && (disabled ? 'border-text-warning bg-state-warning-hover ring-text-warning' : 'border-util-colors-indigo-indigo-600 bg-state-accent-hover ring-util-colors-indigo-indigo-600'),
        isInWorkflow && 'border border-workflow-block-parma-bg bg-workflow-block-parma-bg pr-[30px]  hover:border-components-input-border-active',
      )}
    >
      {
        currentProvider && (
          <ModelIcon
            className="mr-1.5 !h-5 !w-5"
            provider={currentProvider}
            modelName={currentModel?.model}
          />
        )
      }
      {
        !currentProvider && (
          <ModelIcon
            className="mr-1.5 !h-5 !w-5"
            provider={modelProviders.find(item => item.provider === providerName)}
            modelName={modelId}
          />
        )
      }
      {
        currentModel && (
          <ModelName
            className="mr-1.5 text-text-primary"
            modelItem={currentModel}
            showMode
            showFeatures
          />
        )
      }
      {
        !currentModel && (
          <div className="mr-1 truncate text-[13px] font-medium text-text-primary">
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
                    ? t('modelProvider.deprecated', { ns: 'common' })
                    : (modelDisabled && currentModel)
                        ? MODEL_STATUS_TEXT[currentModel.status as string][language]
                        : ''
                }
              >
                <AlertTriangle className="h-4 w-4 text-[#F79009]" />
              </Tooltip>
            )
          : (
              <SlidersH className={cn(!isInWorkflow ? 'text-indigo-600' : 'text-text-tertiary', 'h-4 w-4 shrink-0')} />
            )
      }
      {isInWorkflow && (<RiArrowDownSLine className="absolute right-2 top-[9px] h-3.5 w-3.5 text-text-tertiary" />)}
    </div>
  )
}

export default Trigger

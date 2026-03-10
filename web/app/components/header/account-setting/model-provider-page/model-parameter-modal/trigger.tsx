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
import { useCredentialPanelState } from '../provider-added-card/use-credential-panel-state'

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
  const isEmpty = !modelId || !providerName
  const currentModelProvider = modelProviders.find(p => p.provider === providerName)
  const state = useCredentialPanelState(currentModelProvider)
  const hasCredits = !state.isCreditsExhausted
  const showCreditsExhausted = !isEmpty && !hasCredits && state.supportsCredits
  const showApiKeyUnavailable = !isEmpty && state.variant === 'api-unavailable'

  // Non-workflow status error: split layout with badge + settings button
  if ((showCreditsExhausted || showApiKeyUnavailable) && !isInWorkflow) {
    return (
      <div className="flex h-8 min-w-[296px] cursor-pointer items-center gap-px overflow-hidden rounded-lg">
        <div className="flex flex-1 items-center gap-0.5 rounded-l-lg bg-components-input-bg-normal p-1">
          <ModelIcon
            className="p-0.5"
            provider={currentProvider || modelProviders.find(item => item.provider === providerName)}
            modelName={currentModel?.model}
          />
          <div className="flex flex-1 items-center truncate px-1 py-[3px]">
            {currentModel
              ? <ModelName className="grow" modelItem={currentModel} showMode showFeatures />
              : <div className="truncate text-[13px] font-normal text-components-input-text-filled">{modelId}</div>}
          </div>
          <div className="flex shrink-0 items-center pr-0.5">
            <div className="flex min-w-[20px] shrink-0 items-center justify-center gap-[3px] rounded-md border border-text-warning bg-components-badge-bg-dimm px-[5px] py-0.5">
              <span className="i-ri-alert-fill h-3 w-3 text-text-warning" />
              <span className="whitespace-nowrap text-text-warning system-xs-medium">
                {t(showCreditsExhausted ? 'modelProvider.selector.creditsExhausted' : 'modelProvider.selector.apiKeyUnavailable', { ns: 'common' })}
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-center rounded-r-lg bg-components-button-tertiary-bg p-2">
          <SlidersH className="h-4 w-4 text-text-tertiary" />
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'relative flex h-8 cursor-pointer items-center rounded-lg px-2',
        !isInWorkflow && 'min-w-[296px]',
        !isInWorkflow && 'border ring-inset hover:ring-[0.5px]',
        !isInWorkflow && (disabled ? 'border-text-warning bg-state-warning-hover ring-text-warning' : 'border-util-colors-indigo-indigo-600 bg-state-accent-hover ring-util-colors-indigo-indigo-600'),
        isInWorkflow && 'pr-[30px]',
        isInWorkflow && !isEmpty && 'border border-workflow-block-parma-bg bg-workflow-block-parma-bg hover:border-components-input-border-active',
        isInWorkflow && isEmpty && 'border border-text-warning bg-state-warning-hover',
      )}
    >
      {
        isEmpty && (
          <div className="mr-2 flex h-6 w-6 shrink-0 items-center justify-center">
            <div className="flex h-5 w-5 items-center justify-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-subtle">
              <span className="i-ri-brain-2-line h-3.5 w-3.5 text-text-quaternary" />
            </div>
          </div>
        )
      }
      {
        !isEmpty && currentProvider && (
          <ModelIcon
            className="mr-1.5 !h-5 !w-5"
            provider={currentProvider}
            modelName={currentModel?.model}
          />
        )
      }
      {
        !isEmpty && !currentProvider && (
          <ModelIcon
            className="mr-1.5 !h-5 !w-5"
            provider={modelProviders.find(item => item.provider === providerName)}
            modelName={modelId}
          />
        )
      }
      {
        !isEmpty && currentModel && (
          <ModelName
            className="mr-1.5 text-text-primary"
            modelItem={currentModel}
            showMode
            showFeatures
          />
        )
      }
      {
        !isEmpty && !currentModel && (
          <div className="mr-1 truncate text-[13px] font-medium text-text-primary">
            {modelId}
          </div>
        )
      }
      {
        isEmpty && (
          <div className="mr-1 flex-1 truncate text-[13px] font-normal text-text-secondary">
            {t('workflow:errorMsg.configureModel')}
          </div>
        )
      }
      {
        !isEmpty && (
          disabled
            ? (
                hasDeprecated
                  ? (
                      <Tooltip popupContent={t('modelProvider.selector.incompatibleTip', { ns: 'common' })}>
                        <div className="ml-auto flex min-w-[20px] shrink-0 items-center justify-center gap-[3px] rounded-md border border-text-warning bg-components-badge-bg-dimm px-[5px] py-0.5">
                          <span className="i-ri-alert-fill h-3 w-3 text-text-warning" />
                          <span className="whitespace-nowrap text-text-warning system-xs-medium">
                            {t('modelProvider.selector.incompatible', { ns: 'common' })}
                          </span>
                        </div>
                      </Tooltip>
                    )
                  : (
                      <Tooltip
                        popupContent={
                          (modelDisabled && currentModel)
                            ? MODEL_STATUS_TEXT[currentModel.status as string][language]
                            : ''
                        }
                      >
                        <AlertTriangle className="h-4 w-4 text-[#F79009]" />
                      </Tooltip>
                    )
              )
            : (
                <SlidersH className={cn(!isInWorkflow ? 'text-indigo-600' : 'text-text-tertiary', 'h-4 w-4 shrink-0')} />
              )
        )
      }
      {
        isEmpty && (
          <RiArrowDownSLine className={cn('h-4 w-4 shrink-0 text-text-tertiary', isInWorkflow && 'absolute right-2 top-[9px] h-3.5 w-3.5')} />
        )
      }
      {!isEmpty && isInWorkflow && (<RiArrowDownSLine className="absolute right-2 top-[9px] h-3.5 w-3.5 text-text-tertiary" />)}
    </div>
  )
}

export default Trigger

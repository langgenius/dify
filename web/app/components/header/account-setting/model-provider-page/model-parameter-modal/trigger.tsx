import type { FC, Ref } from 'react'
import type {
  Model,
  ModelItem,
  ModelProvider,
} from '../declarations'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { useProviderContext } from '@/context/provider-context'
import { cn } from '@/utils/classnames'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'
import { useCredentialPanelState } from '../provider-added-card/use-credential-panel-state'
import {
  deriveTriggerStatus,
  TRIGGER_STATUS_BADGE_I18N,
  TRIGGER_STATUS_TOOLTIP_I18N,
} from './derive-trigger-status'

export type TriggerProps = {
  open?: boolean
  currentProvider?: ModelProvider | Model
  currentModel?: ModelItem
  providerName?: string
  modelId?: string
  isInWorkflow?: boolean
  settingsRef?: Ref<HTMLDivElement>
}

const Trigger: FC<TriggerProps> = ({
  currentProvider,
  currentModel,
  providerName,
  modelId,
  isInWorkflow,
  settingsRef,
}) => {
  const { t } = useTranslation()
  const { modelProviders } = useProviderContext()
  const currentModelProvider = modelProviders.find(p => p.provider === providerName)
  const credentialState = useCredentialPanelState(currentModelProvider)
  const status = deriveTriggerStatus(modelId, providerName, currentModelProvider, currentModel, credentialState)
  const badgeKey = TRIGGER_STATUS_BADGE_I18N[status as keyof typeof TRIGGER_STATUS_BADGE_I18N]
  const tooltipKey = TRIGGER_STATUS_TOOLTIP_I18N[status as keyof typeof TRIGGER_STATUS_TOOLTIP_I18N]
  const badgeLabel = badgeKey ? t(badgeKey, { ns: 'common' }) : null
  const tooltipLabel = tooltipKey ? t(tooltipKey, { ns: 'common' }) : null
  const isActive = status === 'active'
  const iconProvider = currentProvider || modelProviders.find(item => item.provider === providerName)

  if (status === 'empty') {
    return (
      <div
        className={cn(
          'relative flex h-8 min-w-[296px] cursor-pointer items-center rounded-lg px-2',
          isInWorkflow
            ? 'border border-text-warning bg-state-warning-hover pr-[30px]'
            : 'border border-text-warning bg-state-warning-hover ring-inset ring-text-warning hover:ring-[0.5px]',
        )}
      >
        <div className="mr-2 flex h-6 w-6 shrink-0 items-center justify-center">
          <div className="flex h-5 w-5 items-center justify-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-subtle">
            <span className="i-ri-brain-2-line h-3.5 w-3.5 text-text-quaternary" />
          </div>
        </div>
        <div className="mr-1 flex-1 truncate text-[13px] font-normal text-text-secondary">
          {t('workflow:errorMsg.configureModel')}
        </div>
        <span className={cn('i-ri-arrow-down-s-line h-4 w-4 shrink-0 text-text-tertiary', isInWorkflow && 'absolute right-2 top-[9px] h-3.5 w-3.5')} />
      </div>
    )
  }

  return (
    <div className="flex h-8 min-w-[296px] cursor-pointer items-center gap-px overflow-hidden rounded-lg">
      <div className={cn('flex flex-1 items-center gap-0.5 rounded-l-lg p-1', isInWorkflow ? 'border border-workflow-block-parma-bg bg-workflow-block-parma-bg' : 'bg-components-input-bg-normal')}>
        <ModelIcon
          className="p-0.5"
          provider={iconProvider}
          modelName={currentModel?.model || modelId}
        />
        <div className="flex flex-1 items-center truncate px-1 py-[3px]">
          {currentModel
            ? (
                <ModelName
                  className="grow"
                  modelItem={currentModel}
                  showMode={isActive}
                  showFeatures={isActive}
                />
              )
            : <div className="truncate text-[13px] font-normal text-components-input-text-filled">{modelId}</div>}
        </div>
        {badgeKey && (
          tooltipLabel
            ? (
                <Tooltip>
                  <TooltipTrigger
                    render={(
                      <div className="flex shrink-0 items-center pr-0.5">
                        <div className="flex min-w-[20px] shrink-0 items-center justify-center gap-[3px] rounded-md border border-text-warning bg-components-badge-bg-dimm px-[5px] py-0.5">
                          <span className="i-ri-alert-fill h-3 w-3 text-text-warning" />
                          <span className="whitespace-nowrap text-text-warning system-xs-medium">
                            {badgeLabel}
                          </span>
                        </div>
                      </div>
                    )}
                  />
                  <TooltipContent placement="top">
                    {tooltipLabel}
                  </TooltipContent>
                </Tooltip>
              )
            : (
                <div className="flex shrink-0 items-center pr-0.5">
                  <div className="flex min-w-[20px] shrink-0 items-center justify-center gap-[3px] rounded-md border border-text-warning bg-components-badge-bg-dimm px-[5px] py-0.5">
                    <span className="i-ri-alert-fill h-3 w-3 text-text-warning" />
                    <span className="whitespace-nowrap text-text-warning system-xs-medium">
                      {badgeLabel}
                    </span>
                  </div>
                </div>
              )
        )}
        {!badgeKey && (
          <div className="flex shrink-0 items-center pr-1">
            <span className="i-ri-arrow-down-s-line h-4 w-4 text-text-tertiary" />
          </div>
        )}
      </div>
      <div ref={settingsRef} className={cn('flex shrink-0 items-center justify-center rounded-r-lg p-2', isInWorkflow ? 'border border-workflow-block-parma-bg bg-workflow-block-parma-bg' : 'bg-components-button-tertiary-bg')}>
        <span className="i-ri-equalizer-2-line h-4 w-4 text-text-tertiary" />
      </div>
    </div>
  )
}

export default Trigger

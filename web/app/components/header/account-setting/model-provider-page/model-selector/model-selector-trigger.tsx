import type { FC } from 'react'
import type {
  DefaultModel,
  Model,
  ModelItem,
} from '../declarations'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/app/components/base/ui/tooltip'
import { useProviderContext } from '@/context/provider-context'
import { cn } from '@/utils/classnames'
import { ModelStatusEnum } from '../declarations'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'
import { useCredentialPanelState } from '../provider-added-card/use-credential-panel-state'
import { MODEL_STATUS_I18N_KEY } from '../status-mapping'

type ModelSelectorTriggerProps = {
  currentProvider?: Model
  currentModel?: ModelItem
  defaultModel?: DefaultModel
  open?: boolean
  readonly?: boolean
  className?: string
  deprecatedClassName?: string
  showDeprecatedWarnIcon?: boolean
}

const ModelSelectorTrigger: FC<ModelSelectorTriggerProps> = ({
  currentProvider,
  currentModel,
  defaultModel,
  open,
  readonly,
  className,
  deprecatedClassName,
  showDeprecatedWarnIcon = true,
}) => {
  const { t } = useTranslation()
  const { modelProviders } = useProviderContext()

  const isSelected = !!currentProvider && !!currentModel
  const isDeprecated = !isSelected && !!defaultModel
  const isEmpty = !isSelected && !defaultModel
  const selectedProvider = isSelected
    ? modelProviders.find(provider => provider.provider === currentProvider.provider)
    : undefined
  const selectedProviderState = useCredentialPanelState(selectedProvider)
  const shouldShowCreditsExhausted = isSelected
    && selectedProviderState.priority === 'credits'
    && selectedProviderState.supportsCredits
    && selectedProviderState.isCreditsExhausted
  const shouldShowApiKeyUnavailable = isSelected && selectedProviderState.variant === 'api-unavailable'
  const effectiveStatus = shouldShowCreditsExhausted
    ? ModelStatusEnum.quotaExceeded
    : shouldShowApiKeyUnavailable
      ? ModelStatusEnum.credentialRemoved
      : currentModel?.status

  const isActive = isSelected && effectiveStatus === ModelStatusEnum.active
  const isDisabled = isDeprecated || (isSelected && !isActive)
  const statusI18nKey = isSelected && effectiveStatus ? MODEL_STATUS_I18N_KEY[effectiveStatus] : undefined
  const isCreditsExhausted = isSelected && effectiveStatus === ModelStatusEnum.quotaExceeded
  const shouldShowModelMeta = effectiveStatus === ModelStatusEnum.active

  const deprecatedProvider = isDeprecated
    ? modelProviders.find(p => p.provider === defaultModel.provider)
    : undefined

  return (
    <div
      className={cn(
        'group flex h-8 items-center gap-0.5 rounded-lg p-1',
        isDisabled
          ? 'bg-components-input-bg-disabled'
          : 'bg-components-input-bg-normal',
        !readonly && !isDisabled && 'cursor-pointer hover:bg-components-input-bg-hover',
        open && !isDisabled && 'bg-components-input-bg-hover',
        className,
      )}
    >
      {isEmpty
        ? (
            <div className="flex h-6 w-6 items-center justify-center">
              <div className="flex h-5 w-5 items-center justify-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-subtle">
                <span className="i-ri-brain-2-line h-3.5 w-3.5 text-text-quaternary" />
              </div>
            </div>
          )
        : (
            <ModelIcon
              className="p-0.5"
              provider={isSelected ? currentProvider : deprecatedProvider}
              modelName={isSelected ? currentModel.model : defaultModel?.model}
            />
          )}

      <div className={cn('flex grow items-center gap-1 truncate px-1 py-[3px]', isDeprecated && deprecatedClassName)}>
        {isSelected && (
          <ModelName
            className="grow"
            modelItem={currentModel}
            showMode={shouldShowModelMeta}
            showFeatures={shouldShowModelMeta}
          />
        )}
        {isDeprecated && (
          <div className="grow truncate text-components-input-text-filled system-sm-regular">
            {defaultModel.model}
          </div>
        )}
        {isEmpty && (
          <div className="grow truncate text-[13px] text-text-quaternary">
            {t('detailPanel.configureModel', { ns: 'plugin' })}
          </div>
        )}

        {isSelected && !readonly && !isActive && statusI18nKey && (
          <Tooltip>
            <TooltipTrigger
              disabled={effectiveStatus !== ModelStatusEnum.noPermission}
              render={(
                <div
                  className={cn(
                    'flex shrink-0 items-center gap-[3px] rounded-md border border-text-warning px-[5px] py-0.5',
                    isCreditsExhausted && 'min-w-[20px] justify-center bg-components-badge-bg-dimm',
                  )}
                >
                  <span className="i-ri-alert-fill h-3 w-3 text-text-warning" />
                  <span className="whitespace-nowrap text-text-warning system-xs-medium">
                    {t(statusI18nKey as 'modelProvider.selector.creditsExhausted', { ns: 'common' })}
                  </span>
                </div>
              )}
            />
            <TooltipContent placement="top">
              {t('modelProvider.selector.incompatibleTip', { ns: 'common' })}
            </TooltipContent>
          </Tooltip>
        )}

        {isDeprecated && showDeprecatedWarnIcon && (
          <Tooltip>
            <TooltipTrigger
              render={(
                <div className="flex shrink-0 items-center gap-[3px] rounded-md border border-text-warning bg-components-badge-bg-dimm px-[5px] py-0.5">
                  <span className="i-ri-alert-fill h-3 w-3 text-text-warning" />
                  <span className="whitespace-nowrap text-text-warning system-xs-medium">
                    {t('modelProvider.selector.incompatible', { ns: 'common' })}
                  </span>
                </div>
              )}
            />
            <TooltipContent placement="top">
              {t('modelProvider.selector.incompatibleTip', { ns: 'common' })}
            </TooltipContent>
          </Tooltip>
        )}

        {!readonly && (isActive || isEmpty) && (
          <span className="i-ri-arrow-down-s-line h-3.5 w-3.5 shrink-0 text-text-tertiary" />
        )}
      </div>
    </div>
  )
}

export default ModelSelectorTrigger

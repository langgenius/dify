import type { DefaultModel, Model, ModelItem } from '../declarations'
import { cn } from '@langgenius/dify-ui/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useTranslation } from 'react-i18next'
import { useProviderContext } from '@/context/provider-context'
import { DERIVED_MODEL_STATUS_BADGE_I18N, DERIVED_MODEL_STATUS_TOOLTIP_I18N, deriveModelStatus } from '../derive-model-status'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'
import { useCredentialPanelState } from '../provider-added-card/use-credential-panel-state'

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

function ModelSelectorTrigger({
  currentProvider,
  currentModel,
  defaultModel,
  open,
  readonly,
  className,
  deprecatedClassName,
  showDeprecatedWarnIcon = true,
}: ModelSelectorTriggerProps) {
  const { t } = useTranslation()
  const { modelProviders } = useProviderContext()

  const isSelected = !!currentProvider && !!currentModel
  const isDeprecated = !isSelected && !!defaultModel
  const isEmpty = !isSelected && !defaultModel
  const selectedProvider = isSelected
    ? modelProviders.find(provider => provider.provider === currentProvider.provider)
    : undefined
  const deprecatedProvider = isDeprecated
    ? modelProviders.find(p => p.provider === defaultModel.provider)
    : undefined
  const resolvedProvider = isSelected ? selectedProvider : deprecatedProvider
  const selectedProviderState = useCredentialPanelState(resolvedProvider)

  const status = deriveModelStatus(
    isSelected ? currentModel?.model : defaultModel?.model,
    isSelected ? currentProvider?.provider : defaultModel?.provider,
    resolvedProvider,
    currentModel,
    selectedProviderState,
  )

  const isActive = status === 'active'
  const isDisabled = status !== 'active' && status !== 'empty'
  const statusI18nKey = DERIVED_MODEL_STATUS_BADGE_I18N[status as keyof typeof DERIVED_MODEL_STATUS_BADGE_I18N]
  const tooltipI18nKey = DERIVED_MODEL_STATUS_TOOLTIP_I18N[status as keyof typeof DERIVED_MODEL_STATUS_TOOLTIP_I18N]
  const statusLabel = statusI18nKey ? t(statusI18nKey, { ns: 'common' }) : null
  const tooltipLabel = tooltipI18nKey ? t(tooltipI18nKey, { ns: 'common' }) : null
  const isCreditsExhausted = status === 'credits-exhausted'
  const shouldShowModelMeta = status === 'active'
  const deprecatedStatusLabel = statusLabel || t('modelProvider.selector.incompatible', { ns: 'common' })
  const deprecatedTooltipLabel = tooltipLabel || t('modelProvider.selector.incompatibleTip', { ns: 'common' })

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

      <div className={cn('flex grow items-center gap-1 truncate px-1 py-0.75', isDeprecated && deprecatedClassName)}>
        {isSelected && (
          <ModelName
            className="grow"
            modelItem={currentModel}
            showMode={shouldShowModelMeta}
            showFeatures={shouldShowModelMeta}
          />
        )}
        {isDeprecated && (
          <div className="grow truncate system-sm-regular text-components-input-text-filled">
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
              disabled={!tooltipLabel}
              render={(
                <div
                  className={cn(
                    'flex shrink-0 items-center gap-0.75 rounded-md border border-text-warning px-1.25 py-0.5',
                    isCreditsExhausted && 'min-w-5 justify-center bg-components-badge-bg-dimm',
                  )}
                >
                  <span className="i-ri-alert-fill h-3 w-3 text-text-warning" />
                  <span className="system-xs-medium whitespace-nowrap text-text-warning">
                    {statusLabel}
                  </span>
                </div>
              )}
            />
            {tooltipLabel && (
              <TooltipContent placement="top">
                {tooltipLabel}
              </TooltipContent>
            )}
          </Tooltip>
        )}

        {isDeprecated && showDeprecatedWarnIcon && (
          <Tooltip>
            <TooltipTrigger
              render={(
                <div className="flex shrink-0 items-center gap-0.75 rounded-md border border-text-warning bg-components-badge-bg-dimm px-1.25 py-0.5">
                  <span className="i-ri-alert-fill h-3 w-3 text-text-warning" />
                  <span className="system-xs-medium whitespace-nowrap text-text-warning">
                    {deprecatedStatusLabel}
                  </span>
                </div>
              )}
            />
            <TooltipContent placement="top">
              {deprecatedTooltipLabel}
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

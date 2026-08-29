import type { ModelSelectorModel, ModelSelectorProvider, ModelSelectorValue } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/client'
import {
  DERIVED_MODEL_STATUS_BADGE_I18N,
  DERIVED_MODEL_STATUS_TOOLTIP_I18N,
  deriveModelStatus,
} from '../derive-model-status'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'
import { useCredentialPanelState as useCredentialPanelInfo } from '../provider-added-card/use-credential-panel-state'

type ModelSelectorTriggerProps = {
  currentProvider?: ModelSelectorProvider
  currentModel?: ModelSelectorModel
  defaultModel?: ModelSelectorValue
  disabled?: boolean
  size?: 'small' | 'medium'
  surface?: 'default' | 'workflow'
  shape?: 'standalone' | 'split'
  className?: string
  showDeprecatedWarnIcon?: boolean
  showModelMeta?: boolean
  isModelCompatible?: boolean
}

function ModelSelectorTrigger({
  currentProvider,
  currentModel,
  defaultModel,
  disabled,
  size = 'medium',
  surface = 'default',
  shape = 'standalone',
  className,
  showDeprecatedWarnIcon = true,
  showModelMeta = true,
  isModelCompatible = true,
}: ModelSelectorTriggerProps) {
  const { t } = useTranslation()

  const isSelected = !!currentProvider && !!currentModel
  const isDeprecated = !isSelected && !!defaultModel
  const isEmpty = !isSelected && !defaultModel
  const providerId = isSelected ? currentProvider.provider : defaultModel?.provider
  const { data: resolvedProvider } = useQuery({
    ...consoleQuery.workspaces.current.modelProviders.summary.get.queryOptions(),
    enabled: !!providerId,
    select: ({ data }) => data.find((provider) => provider.provider === providerId),
  })
  const credentialPanel = useCredentialPanelInfo(resolvedProvider)

  const status = deriveModelStatus(
    isSelected ? currentModel?.model : defaultModel?.model,
    isSelected ? currentProvider?.provider : defaultModel?.provider,
    resolvedProvider,
    currentModel,
    credentialPanel,
  )

  const isActive = status === 'active'
  const statusI18nKey =
    DERIVED_MODEL_STATUS_BADGE_I18N[status as keyof typeof DERIVED_MODEL_STATUS_BADGE_I18N]
  const tooltipI18nKey =
    DERIVED_MODEL_STATUS_TOOLTIP_I18N[status as keyof typeof DERIVED_MODEL_STATUS_TOOLTIP_I18N]
  const statusLabel =
    isModelCompatible && statusI18nKey
      ? t(($) => $[statusI18nKey], { ns: 'common' })
      : t(($) => $['modelProvider.selector.incompatible'], { ns: 'common' })
  const tooltipLabel =
    isModelCompatible && tooltipI18nKey
      ? t(($) => $[tooltipI18nKey], { ns: 'common' })
      : t(($) => $['modelProvider.selector.incompatibleTip'], { ns: 'common' })
  const isCreditsExhausted = status === 'credits-exhausted'
  const shouldShowModelMeta = showModelMeta && status === 'active' && isModelCompatible
  const deprecatedStatusLabel =
    statusLabel || t(($) => $['modelProvider.selector.incompatible'], { ns: 'common' })
  const deprecatedTooltipLabel =
    tooltipLabel || t(($) => $['modelProvider.selector.incompatibleTip'], { ns: 'common' })
  const triggerTooltipLabel =
    isDeprecated && showDeprecatedWarnIcon
      ? deprecatedTooltipLabel
      : isSelected && ((!isActive && statusI18nKey) || !isModelCompatible)
        ? tooltipLabel
        : undefined

  return (
    <Tooltip>
      <TooltipTrigger
        disabled={!triggerTooltipLabel || disabled}
        render={
          <PopoverTrigger
            disabled={disabled}
            render={
              <button
                type="button"
                aria-label={t(($) => $['detailPanel.configureModel'], { ns: 'plugin' })}
                data-deprecated={isDeprecated ? '' : undefined}
                data-model-status={status}
                data-shape={shape}
                data-size={size}
                data-surface={surface}
                disabled={disabled}
                className={cn(
                  'group/model-selector-trigger flex w-full min-w-0 items-center border-0 bg-components-input-bg-normal text-left text-components-input-text-filled outline-hidden transition-colors',
                  'hover:bg-state-base-hover-alt focus-visible:bg-state-base-hover-alt focus-visible:ring-2 focus-visible:ring-state-accent-solid data-popup-open:bg-state-base-hover-alt',
                  'disabled:cursor-not-allowed disabled:text-components-input-text-filled-disabled motion-reduce:transition-none',
                  'data-[size=small]:h-6 data-[size=small]:gap-px data-[size=small]:rounded-md data-[size=small]:p-0.5',
                  'data-[size=medium]:h-8 data-[size=medium]:gap-0.5 data-[size=medium]:rounded-lg data-[size=medium]:p-1',
                  'data-[surface=workflow]:bg-workflow-block-parma-bg data-[surface=workflow]:hover:bg-workflow-block-parma-bg data-[surface=workflow]:data-popup-open:bg-workflow-block-parma-bg',
                  'data-[model-status=api-key-unavailable]:bg-components-input-bg-disabled data-[model-status=configure-required]:bg-components-input-bg-disabled data-[model-status=credits-exhausted]:bg-components-input-bg-disabled data-[model-status=disabled]:bg-components-input-bg-disabled data-[model-status=incompatible]:bg-components-input-bg-disabled',
                  'disabled:data-[model-status=active]:bg-components-input-bg-normal! disabled:data-[model-status=empty]:bg-components-input-bg-normal! disabled:data-[surface=workflow]:bg-workflow-block-parma-bg!',
                  'data-[shape=split]:relative data-[shape=split]:min-w-0 data-[shape=split]:flex-1 data-[shape=split]:rounded-l-lg! data-[shape=split]:rounded-r-none! data-[shape=split]:focus-visible:z-1',
                  'data-[surface=workflow]:data-deprecated:[&>span]:opacity-50',
                  className,
                )}
              />
            }
          >
            <span className="flex min-w-0 grow items-center gap-0.5">
              {isEmpty ? (
                <span
                  className={cn(
                    'flex items-center justify-center',
                    size === 'small' ? 'size-5' : 'size-6',
                  )}
                >
                  <span className="flex h-5 w-5 items-center justify-center rounded-md border-[0.5px] border-components-panel-border-subtle bg-background-default-subtle">
                    <span
                      aria-hidden="true"
                      className="i-ri-brain-2-line size-3.5 text-text-quaternary"
                    />
                  </span>
                </span>
              ) : (
                <ModelIcon
                  className="p-0.5"
                  provider={isSelected ? currentProvider : resolvedProvider}
                  modelName={isSelected ? currentModel.model : defaultModel?.model}
                />
              )}

              <span
                className={cn(
                  'flex grow items-center gap-1 truncate',
                  size === 'small' ? 'px-0.5' : 'px-1 py-0.75',
                )}
              >
                {isSelected && (
                  <ModelName
                    className="grow"
                    modelItem={currentModel}
                    nameClassName={currentModel?.deprecated ? 'line-through' : undefined}
                    showMode={shouldShowModelMeta}
                    showFeatures={shouldShowModelMeta}
                  />
                )}
                {isDeprecated && (
                  <span className="grow truncate system-sm-regular text-components-input-text-filled line-through">
                    {defaultModel.model}
                  </span>
                )}
                {isEmpty && (
                  <span className="grow truncate text-[13px] text-components-input-text-placeholder">
                    {t(($) => $['detailPanel.configureModel'], { ns: 'plugin' })}
                  </span>
                )}

                {isSelected &&
                  !disabled &&
                  ((!isActive && statusI18nKey) || !isModelCompatible) && (
                    <span
                      className={cn(
                        'flex shrink-0 items-center gap-0.75 rounded-md border border-text-warning px-1.25 py-0.5',
                        isCreditsExhausted && 'min-w-5 justify-center bg-components-badge-bg-dimm',
                      )}
                    >
                      <span aria-hidden className="i-ri-alert-fill size-3 text-text-warning" />
                      <span className="system-xs-medium whitespace-nowrap text-text-warning">
                        {statusLabel}
                      </span>
                    </span>
                  )}

                {isDeprecated && showDeprecatedWarnIcon && (
                  <span className="flex shrink-0 items-center gap-0.75 rounded-md border border-text-warning bg-components-badge-bg-dimm px-1.25 py-0.5">
                    <span aria-hidden className="i-ri-alert-fill size-3 text-text-warning" />
                    <span className="system-xs-medium whitespace-nowrap text-text-warning">
                      {deprecatedStatusLabel}
                    </span>
                  </span>
                )}
              </span>
            </span>
            {!disabled && shape !== 'split' && (isActive || isEmpty) && (
              <span
                aria-hidden="true"
                className="i-ri-arrow-down-s-line size-4 shrink-0 text-text-quaternary transition-colors group-hover/model-selector-trigger:text-text-secondary group-data-popup-open/model-selector-trigger:text-text-secondary"
              />
            )}
          </PopoverTrigger>
        }
      />
      {triggerTooltipLabel && (
        <TooltipContent placement="top">{triggerTooltipLabel}</TooltipContent>
      )}
    </Tooltip>
  )
}

export { ModelSelectorTrigger }

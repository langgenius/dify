import type { ModelSelectorModel, ModelSelectorProvider, ModelSelectorValue } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { PopoverTrigger } from '@langgenius/dify-ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { consoleQuery } from '@/service/console'
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
  onClear?: () => void
  clearLabel?: string
  disabled?: boolean
  loading?: boolean
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
  onClear,
  clearLabel,
  disabled,
  loading = false,
  size = 'medium',
  surface = 'default',
  shape = 'standalone',
  className,
  showDeprecatedWarnIcon = true,
  showModelMeta = true,
  isModelCompatible = true,
}: ModelSelectorTriggerProps) {
  const { t } = useTranslation()

  const showClear = !!defaultModel && !!onClear
  const isSelected = !!currentProvider && !!currentModel
  const isDeprecated = !isSelected && !!defaultModel
  const isEmpty = !isSelected && !defaultModel
  const providerId = isSelected ? currentProvider.provider : defaultModel?.provider
  const { data: providerSummary } = useQuery({
    ...consoleQuery.workspaces.current.modelProviders.summary.get.queryOptions(),
    enabled: !!providerId,
  })
  const resolvedProvider = providerSummary?.data.find(
    (provider) => provider.provider === providerId,
  )
  const isStatusUnavailable = loading || (!!providerId && providerSummary === undefined)
  const isDisabled = disabled || loading
  const credentialPanel = useCredentialPanelInfo(resolvedProvider)

  const status = isStatusUnavailable
    ? undefined
    : deriveModelStatus(
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
  const statusLabel = !isModelCompatible
    ? t(($) => $['modelProvider.selector.incompatible'], { ns: 'common' })
    : statusI18nKey
      ? t(($) => $[statusI18nKey], { ns: 'common' })
      : undefined
  const tooltipLabel = !isModelCompatible
    ? t(($) => $['modelProvider.selector.incompatibleTip'], { ns: 'common' })
    : tooltipI18nKey
      ? t(($) => $[tooltipI18nKey], { ns: 'common' })
      : statusLabel
  const isCreditsExhausted = status === 'credits-exhausted'
  const shouldShowModelMeta = showModelMeta && status === 'active' && isModelCompatible
  const triggerTooltipLabel =
    isDeprecated && !isStatusUnavailable && showDeprecatedWarnIcon
      ? tooltipLabel
      : isSelected && !isStatusUnavailable && ((!isActive && statusI18nKey) || !isModelCompatible)
        ? tooltipLabel
        : undefined

  const trigger = (
    <Tooltip>
      <TooltipTrigger
        disabled={!triggerTooltipLabel || isDisabled}
        render={
          <PopoverTrigger
            disabled={isDisabled}
            render={
              <button
                type="button"
                data-deprecated={isDeprecated && !isStatusUnavailable ? '' : undefined}
                data-model-status={status}
                data-shape={shape}
                data-size={size}
                data-surface={surface}
                disabled={isDisabled}
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
            <span
              className={cn(
                'flex min-w-0 grow items-center gap-0.5',
                showClear &&
                  'group-focus-within/model-selector-clearable:mr-6 group-hover/model-selector-clearable:mr-6',
              )}
            >
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
                    nameClassName={
                      currentModel?.deprecated && !isStatusUnavailable ? 'line-through' : undefined
                    }
                    showMode={shouldShowModelMeta}
                    showFeatures={shouldShowModelMeta}
                  />
                )}
                {isDeprecated && (
                  <span
                    className={cn(
                      'grow truncate system-sm-regular text-components-input-text-filled',
                      !isStatusUnavailable && 'line-through',
                    )}
                    title={defaultModel.model}
                  >
                    {defaultModel.model}
                  </span>
                )}
                {isEmpty && (
                  <span className="grow truncate text-[13px] text-components-input-text-placeholder">
                    {t(($) => $['detailPanel.configureModel'], { ns: 'plugin' })}
                  </span>
                )}

                {isSelected &&
                  !isDisabled &&
                  !isStatusUnavailable &&
                  ((!isActive && statusI18nKey) || !isModelCompatible) && (
                    <span
                      className={cn(
                        'flex shrink-0 items-center gap-0.75 rounded-md border border-text-warning px-1.25 py-0.5',
                        showClear &&
                          'group-focus-within/model-selector-clearable:hidden group-focus-within/model-selector-trigger:hidden group-hover/model-selector-clearable:hidden group-hover/model-selector-trigger:hidden',
                        isCreditsExhausted && 'min-w-5 justify-center bg-components-badge-bg-dimm',
                      )}
                    >
                      <span aria-hidden className="i-ri-alert-fill size-3 text-text-warning" />
                      <span className="system-xs-medium whitespace-nowrap text-text-warning">
                        {statusLabel}
                      </span>
                    </span>
                  )}

                {isDeprecated && !isStatusUnavailable && showDeprecatedWarnIcon && (
                  <span
                    className={cn(
                      'flex shrink-0 items-center gap-0.75 rounded-md border border-text-warning bg-components-badge-bg-dimm px-1.25 py-0.5',
                      showClear &&
                        'group-focus-within/model-selector-clearable:hidden group-focus-within/model-selector-trigger:hidden group-hover/model-selector-clearable:hidden group-hover/model-selector-trigger:hidden',
                    )}
                  >
                    <span aria-hidden className="i-ri-alert-fill size-3 text-text-warning" />
                    <span className="system-xs-medium whitespace-nowrap text-text-warning">
                      {statusLabel}
                    </span>
                  </span>
                )}
              </span>
            </span>
            {!isDisabled && shape !== 'split' && (
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

  if (!showClear) return trigger

  return (
    <div
      className={cn(
        'group/model-selector-clearable relative min-w-0',
        shape === 'split' ? 'flex-1' : 'w-full',
      )}
    >
      {trigger}
      <IconButton
        aria-label={clearLabel ?? t(($) => $['operation.reset'], { ns: 'common' })}
        size="sm"
        disabled={isDisabled}
        onClick={onClear}
        className={cn(
          'pointer-events-none absolute top-1/2 -translate-y-1/2 opacity-0 group-focus-within/model-selector-clearable:pointer-events-auto group-focus-within/model-selector-clearable:opacity-100 group-hover/model-selector-clearable:pointer-events-auto group-hover/model-selector-clearable:opacity-100',
          'text-text-quaternary hover:bg-transparent hover:text-text-tertiary focus-visible:bg-components-input-bg-hover focus-visible:ring-inset',
          shape === 'split' ? 'right-1' : size === 'small' ? 'right-4.5' : 'right-5',
        )}
      >
        <span aria-hidden="true" className="i-ri-close-circle-fill size-4" />
      </IconButton>
    </div>
  )
}

export { ModelSelectorTrigger }

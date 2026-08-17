import type { ModelType } from '@dify/contracts/api/console/workspaces/types.gen'
import type { ComponentProps } from 'react'
import type {
  ModelSelectorModel,
  ModelSelectorModelPredicate,
  ModelSelectorProvider,
  ModelSelectorValue,
} from './types'
import { Button } from '@langgenius/dify-ui/button'
import { cn } from '@langgenius/dify-ui/cn'
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '@langgenius/dify-ui/collapsible'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { PreviewCardTrigger } from '@langgenius/dify-ui/preview-card'
import { StatusDot } from '@langgenius/dify-ui/status-dot'
import { Tooltip, TooltipContent, TooltipTrigger } from '@langgenius/dify-ui/tooltip'
import { useCallback, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { useCredentialPermissions } from '@/hooks/use-credential-permissions'
import { renderI18nObject } from '@/i18n-config'
import { ConfigurationMethodEnum, ModelStatusEnum } from '../declarations'
import {
  useLanguage,
  useLazyModelProviderDetail,
  useUpdateModelList,
  useUpdateModelProviders,
} from '../hooks'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'
import DropdownContent from '../provider-added-card/model-auth-dropdown/dropdown-content'
import { useChangeProviderPriority } from '../provider-added-card/use-change-provider-priority'
import { useCredentialPanelState as useCredentialPanelInfo } from '../provider-added-card/use-credential-panel-state'

export type ModelSelectorPreviewPayload = {
  provider: ModelSelectorProvider
  modelItem: ModelSelectorModel
}

type PreviewCardHandle = NonNullable<ComponentProps<typeof PreviewCardTrigger>['handle']>

type PopupItemProps = {
  defaultModel?: ModelSelectorValue
  model: ModelSelectorProvider
  modelPredicate?: ModelSelectorModelPredicate
  modelSuggestionPredicate?: ModelSelectorModelPredicate
  previewCardHandle: PreviewCardHandle
  onPreviewCardClose: () => void
  onSelect: (provider: string, model: ModelSelectorModel) => void
  onHide: () => void
}

function PopupItem({
  defaultModel,
  model,
  modelPredicate,
  modelSuggestionPredicate,
  previewCardHandle,
  onPreviewCardClose,
  onSelect,
  onHide,
}: PopupItemProps) {
  const [modelsOpen, setModelsOpen] = useState(true)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const providerHeadingId = useId()
  const { t } = useTranslation()
  const language = useLanguage()
  const providerLabel = renderI18nObject(model.label, language)
  const suggestionTip = t(($) => $['modelProvider.selector.suggestionTip'], { ns: 'common' })
  const { setShowModelModal } = useModalContext()
  const { modelProviders } = useProviderContext()
  const updateModelList = useUpdateModelList()
  const updateModelProviders = useUpdateModelProviders()
  const currentProvider = modelProviders.find((provider) => provider.provider === model.provider)
  const { providerDetail, loadProviderDetail } = useLazyModelProviderDetail(model.provider)
  const { canUseCredential, canCreateCredential, canManageCredential } = useCredentialPermissions()
  const canOpenCredentialDropdown = canUseCredential || canCreateCredential || canManageCredential
  const state = useCredentialPanelInfo(currentProvider)
  const { isChangingPriority, handleChangePriority } = useChangeProviderPriority(currentProvider)
  const isUsingCredits = state.priority === 'credits'
  const hasCredits = !state.isCreditsExhausted
  const isApiKeyActive = state.variant === 'api-active' || state.variant === 'api-fallback'
  const { credentialName } = state

  const handleOpenModelModal = async () => {
    if (!canCreateCredential || !currentProvider) return

    const detail = await loadProviderDetail()
    if (!detail) return
    setShowModelModal({
      payload: {
        currentProvider: detail,
        currentConfigurationMethod: ConfigurationMethodEnum.predefinedModel,
      },
      onSaveCallback: () => {
        updateModelProviders()

        const modelType = model.models[0]!.model_type
        if (modelType) updateModelList(modelType as ModelType)
      },
    })
  }

  const handleCloseDropdown = useCallback(() => {
    setDropdownOpen(false)
    onHide()
  }, [onHide])

  const handleDropdownOpenChange = async (nextOpen: boolean) => {
    if (!nextOpen) {
      setDropdownOpen(false)
      return
    }
    const detail = await loadProviderDetail()
    if (detail) setDropdownOpen(true)
  }

  if (!currentProvider) return null

  return (
    <Collapsible
      open={modelsOpen}
      onOpenChange={setModelsOpen}
      className="mb-1"
      render={<section aria-labelledby={providerHeadingId} />}
    >
      <div className="sticky top-0 z-1 flex min-h-5.5 min-w-0 items-center justify-between gap-2 bg-components-panel-bg px-3 text-xs font-medium text-text-tertiary">
        <CollapsibleTrigger
          id={providerHeadingId}
          className="group/provider min-h-0 w-auto min-w-0 justify-start gap-0 rounded-none p-0 text-xs font-medium text-text-tertiary hover:not-data-disabled:bg-transparent hover:not-data-disabled:text-text-tertiary data-panel-open:text-text-tertiary"
        >
          <span className="truncate">{providerLabel}</span>
          <span
            aria-hidden="true"
            className={cn(
              'i-custom-vender-solid-general-arrow-down-round-fill size-4 shrink-0 -rotate-90 text-text-quaternary transition-transform group-data-panel-open/provider:rotate-0 motion-reduce:transition-none',
            )}
          />
        </CollapsibleTrigger>
        <Popover open={dropdownOpen} onOpenChange={handleDropdownOpenChange}>
          <PopoverTrigger
            disabled={!canOpenCredentialDropdown}
            render={
              <Button
                variant="ghost"
                size="small"
                className="max-w-[50%] min-w-0 shrink-0 gap-0 px-1.5 py-1 system-xs-medium text-text-tertiary"
              >
                {isUsingCredits ? (
                  hasCredits ? (
                    <>
                      <span
                        aria-hidden="true"
                        className="i-custom-vender-line-financeandecommerce-credits-coin size-3"
                      />
                      <span className="ml-1 truncate">
                        {t(($) => $['modelProvider.selector.aiCredits'], { ns: 'common' })}
                      </span>
                    </>
                  ) : (
                    <>
                      <span
                        aria-hidden="true"
                        className="i-ri-alert-fill size-3 shrink-0 text-text-warning-secondary"
                      />
                      <span className="ml-1 truncate text-text-warning">
                        {t(($) => $['modelProvider.selector.creditsExhausted'], { ns: 'common' })}
                      </span>
                    </>
                  )
                ) : credentialName ? (
                  <>
                    <StatusDot size="small" status={isApiKeyActive ? 'success' : 'error'} />
                    <span className="ml-1 truncate text-text-tertiary">{credentialName}</span>
                  </>
                ) : (
                  <>
                    <StatusDot size="small" status="disabled" />
                    <span className="ml-1 truncate text-text-tertiary">
                      {t(($) => $['modelProvider.selector.configureRequired'], { ns: 'common' })}
                    </span>
                  </>
                )}
                {canOpenCredentialDropdown && (
                  <span
                    aria-hidden="true"
                    className="i-ri-arrow-down-s-line size-3.5! shrink-0 translate-y-px text-text-tertiary"
                  />
                )}
              </Button>
            }
          />
          <PopoverContent placement="bottom-end">
            <PopoverTitle className="sr-only">{providerLabel}</PopoverTitle>
            {providerDetail && (
              <DropdownContent
                provider={providerDetail}
                state={state}
                isChangingPriority={isChangingPriority}
                onChangePriority={handleChangePriority}
                onClose={handleCloseDropdown}
              />
            )}
          </PopoverContent>
        </Popover>
      </div>
      <CollapsiblePanel>
        <ul className="pb-1">
          {model.models.map((modelItem) => {
            const isModelCompatible = modelPredicate?.(model, modelItem) ?? true
            const isModelSuggested = modelSuggestionPredicate?.(model, modelItem) ?? false
            const isSelected =
              defaultModel?.model === modelItem.model &&
              defaultModel.provider === currentProvider.provider
            const needsConfiguration = modelItem.status === ModelStatusEnum.noConfigure
            const isSelectable = modelItem.status === ModelStatusEnum.active
            const rowClassName = cn(
              'group relative mx-1 flex h-8 min-w-0 items-center gap-1 rounded-lg px-3 py-1.5 text-left',
              isSelectable
                ? 'cursor-pointer hover:bg-state-base-hover'
                : 'cursor-not-allowed hover:bg-state-base-hover-alt',
            )
            const rowContent = (
              <>
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <ModelIcon
                    className="size-5 shrink-0"
                    provider={model}
                    modelName={modelItem.model}
                  />
                  <ModelName
                    className={cn(
                      'system-sm-medium text-text-secondary',
                      !isModelCompatible && 'text-text-quaternary',
                      !isSelectable && 'opacity-60',
                    )}
                    modelItem={modelItem}
                    nameClassName={modelItem.deprecated ? 'line-through' : undefined}
                  >
                    {isModelSuggested && (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <span
                              aria-label={suggestionTip}
                              className="i-ri-shield-star-line size-3.5 shrink-0 text-text-accent-secondary"
                            />
                          }
                        />
                        <TooltipContent placement="top">{suggestionTip}</TooltipContent>
                      </Tooltip>
                    )}
                  </ModelName>
                </div>
                {isSelected && (
                  <span
                    aria-hidden="true"
                    className="i-custom-vender-line-general-check size-4 shrink-0 text-text-accent"
                  />
                )}
              </>
            )
            const row = needsConfiguration ? (
              <div className={rowClassName} onPointerDown={onPreviewCardClose}>
                {rowContent}
                {canCreateCredential && (
                  <Button
                    variant="ghost-accent"
                    size="small"
                    className="h-auto shrink-0 p-0 text-xs opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-transparent focus-visible:opacity-100"
                    onClick={() => void handleOpenModelModal()}
                  >
                    {t(($) => $['operation.add'], { ns: 'common' }).toLocaleUpperCase()}
                  </Button>
                )}
              </div>
            ) : (
              <Button
                variant="ghost"
                size="medium"
                aria-current={isSelected ? 'true' : undefined}
                disabled={!isSelectable}
                className={cn(rowClassName, 'w-[calc(100%-0.5rem)] justify-start')}
                onPointerDown={onPreviewCardClose}
                onClick={() => onSelect(model.provider, modelItem)}
              >
                {rowContent}
              </Button>
            )

            return (
              <li key={modelItem.model}>
                <PreviewCardTrigger
                  delay={150}
                  closeDelay={150}
                  handle={previewCardHandle}
                  payload={{ provider: model, modelItem }}
                  render={row}
                />
              </li>
            )
          })}
        </ul>
      </CollapsiblePanel>
    </Collapsible>
  )
}

export default PopupItem

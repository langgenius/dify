import type { ComponentProps } from 'react'
import type { DefaultModel, Model, ModelItem } from '../declarations'
import { cn } from '@langgenius/dify-ui/cn'
import { ComboboxGroup, ComboboxItem, ComboboxItemIndicator } from '@langgenius/dify-ui/combobox'
import { Popover, PopoverContent, PopoverTrigger } from '@langgenius/dify-ui/popover'
import { PreviewCardTrigger } from '@langgenius/dify-ui/preview-card'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CreditsCoin } from '@/app/components/base/icons/src/vender/line/financeAndECommerce'
import { useModalContext } from '@/context/modal-context'
import { useProviderContext } from '@/context/provider-context'
import { ConfigurationMethodEnum, ModelStatusEnum } from '../declarations'
import { useLanguage, useUpdateModelList, useUpdateModelProviders } from '../hooks'
import ModelIcon from '../model-icon'
import ModelName from '../model-name'
import DropdownContent from '../provider-added-card/model-auth-dropdown/dropdown-content'
import { useChangeProviderPriority } from '../provider-added-card/use-change-provider-priority'
import { useCredentialPanelState } from '../provider-added-card/use-credential-panel-state'

export type ModelSelectorPreviewPayload = {
  provider: Model
  modelItem: ModelItem
}

type PreviewCardHandle = NonNullable<ComponentProps<typeof PreviewCardTrigger>['handle']>

type PopupItemProps = {
  defaultModel?: DefaultModel
  model: Model
  previewCardHandle: PreviewCardHandle
  onPreviewCardClose: () => void
  onHide: () => void
}
function PopupItem({
  defaultModel,
  model,
  previewCardHandle,
  onPreviewCardClose,
  onHide,
}: PopupItemProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const { t } = useTranslation()
  const language = useLanguage()
  const { setShowModelModal } = useModalContext()
  const { modelProviders } = useProviderContext()
  const updateModelList = useUpdateModelList()
  const updateModelProviders = useUpdateModelProviders()
  const currentProvider = modelProviders.find(provider => provider.provider === model.provider)
  const handleOpenModelModal = () => {
    if (!currentProvider)
      return
    setShowModelModal({
      payload: {
        currentProvider,
        currentConfigurationMethod: ConfigurationMethodEnum.predefinedModel,
      },
      onSaveCallback: () => {
        updateModelProviders()

        const modelType = model.models[0]!.model_type

        if (modelType)
          updateModelList(modelType)
      },
    })
  }

  const state = useCredentialPanelState(currentProvider)
  const { isChangingPriority, handleChangePriority } = useChangeProviderPriority(currentProvider)
  const groupItems = useMemo(() => model.models
    .filter(modelItem => modelItem.status !== ModelStatusEnum.noConfigure)
    .map(modelItem => ({
      provider: model.provider,
      model: modelItem.model,
    })), [model.models, model.provider])

  const isUsingCredits = state.priority === 'credits'
  const hasCredits = !state.isCreditsExhausted
  const isApiKeyActive = state.variant === 'api-active' || state.variant === 'api-fallback'
  const { credentialName } = state

  const handleCloseDropdown = useCallback(() => {
    setDropdownOpen(false)
    onHide()
  }, [onHide])

  if (!currentProvider)
    return null

  return (
    <ComboboxGroup className="mb-1" items={groupItems}>
      <div className="sticky top-0 z-1 flex h-5.5 min-w-0 items-center justify-between gap-2 bg-components-panel-bg px-3 text-xs font-medium text-text-tertiary">
        <button
          type="button"
          className="flex min-w-0 cursor-pointer items-center border-0 bg-transparent p-0 text-left"
          onClick={() => setCollapsed(prev => !prev)}
        >
          <span className="truncate">{model.label[language] || model.label.en_US}</span>
          <span className={cn('i-custom-vender-solid-general-arrow-down-round-fill h-4 w-4 shrink-0 text-text-quaternary', collapsed && '-rotate-90')} />
        </button>
        <Popover open={dropdownOpen} onOpenChange={setDropdownOpen}>
          <PopoverTrigger
            render={(
              <button type="button" className="flex max-w-[50%] min-w-0 shrink-0 cursor-pointer items-center rounded-md px-1.5 py-1 system-xs-medium text-text-tertiary hover:bg-components-button-ghost-bg-hover">
                {isUsingCredits
                  ? (
                      hasCredits
                        ? (
                            <>
                              <CreditsCoin className="h-3 w-3" />
                              <span className="ml-1 truncate">{t('modelProvider.selector.aiCredits', { ns: 'common' })}</span>
                            </>
                          )
                        : (
                            <>
                              <span className="i-ri-alert-fill h-3 w-3 shrink-0 text-text-warning-secondary" />
                              <span className="ml-1 truncate text-text-warning">{t('modelProvider.selector.creditsExhausted', { ns: 'common' })}</span>
                            </>
                          )
                    )
                  : credentialName
                    ? (
                        <>
                          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-xs border', isApiKeyActive ? 'border-components-badge-status-light-success-border-inner bg-components-badge-status-light-success-bg' : 'border-components-badge-status-light-error-border-inner bg-components-badge-status-light-error-bg')} />
                          <span className="ml-1 truncate text-text-tertiary">{credentialName}</span>
                        </>
                      )
                    : (
                        <>
                          <span className="h-1.5 w-1.5 shrink-0 rounded-xs border border-components-badge-status-light-disabled-border-inner bg-components-badge-status-light-disabled-bg" />
                          <span className="ml-1 truncate text-text-tertiary">{t('modelProvider.selector.configureRequired', { ns: 'common' })}</span>
                        </>
                      )}
                <span className="i-ri-arrow-down-s-line h-3.5! w-3.5! shrink-0 translate-y-px text-text-tertiary" />
              </button>
            )}
          />
          <PopoverContent placement="bottom-end">
            <DropdownContent
              provider={currentProvider}
              state={state}
              isChangingPriority={isChangingPriority}
              onChangePriority={handleChangePriority}
              onClose={handleCloseDropdown}
            />
          </PopoverContent>
        </Popover>
      </div>
      {!collapsed && model.models.map((modelItem) => {
        const rowClassName = cn(
          'group relative mx-1 flex h-8 min-w-0 items-center gap-1 rounded-lg px-3 py-1.5 text-left',
          modelItem.status === ModelStatusEnum.active ? 'cursor-pointer hover:bg-state-base-hover' : 'cursor-not-allowed hover:bg-state-base-hover-alt',
        )
        const rowContent = (
          <>
            <div className="flex min-w-0 items-center gap-2">
              <ModelIcon
                className={cn('h-5 w-5 shrink-0')}
                provider={model}
                modelName={modelItem.model}
              />
              <ModelName
                className={cn('system-sm-medium text-text-secondary', modelItem.status !== ModelStatusEnum.active && 'opacity-60')}
                modelItem={modelItem}
              />
            </div>
            {
              defaultModel?.model === modelItem.model && defaultModel.provider === currentProvider.provider && (
                <ComboboxItemIndicator className="shrink-0 text-text-accent">
                  <span className="i-custom-vender-line-general-check h-4 w-4" aria-hidden="true" />
                </ComboboxItemIndicator>
              )
            }
          </>
        )
        const itemRender = modelItem.status === ModelStatusEnum.noConfigure
          ? (
              <div
                className={rowClassName}
                aria-disabled="true"
                onPointerDown={onPreviewCardClose}
              >
                {rowContent}
                <button
                  type="button"
                  className="hidden cursor-pointer text-xs font-medium text-text-accent group-hover:block"
                  onClick={handleOpenModelModal}
                >
                  {t('operation.add', { ns: 'common' }).toLocaleUpperCase()}
                </button>
              </div>
            )
          : (
              <ComboboxItem
                value={{
                  provider: model.provider,
                  model: modelItem.model,
                }}
                disabled={modelItem.status !== ModelStatusEnum.active}
                className={rowClassName}
                onPointerDown={onPreviewCardClose}
              >
                {rowContent}
              </ComboboxItem>
            )

        return (
          <PreviewCardTrigger
            key={modelItem.model}
            delay={150}
            closeDelay={150}
            handle={previewCardHandle}
            payload={{ provider: model, modelItem }}
            render={itemRender}
          />
        )
      })}
    </ComboboxGroup>
  )
}

export default PopupItem

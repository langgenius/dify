import type { ComboboxChangeEventDetails } from '@langgenius/dify-ui/combobox'
import type {
  ModelSelectorModel,
  ModelSelectorModelPredicate,
  ModelSelectorProvider,
  ModelSelectorValue,
} from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { Combobox, ComboboxContent } from '@langgenius/dify-ui/combobox'
import { useQueryState } from 'nuqs'
import { useCallback, useMemo, useState } from 'react'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import { ModelStatusEnum } from '../declarations'
import { getCurrentProviderAndModel } from '../hooks'
import { ModelSelectorTrigger } from './model-selector-trigger'
import Popup from './popup'
import { getModelSelectorValueLabel, isSameModelSelectorValue } from './types'

const getModelProviderPluginId = (provider: string) => {
  const [organization, pluginName] = provider.split('/').filter(Boolean)

  if (organization && pluginName) return `${organization}/${pluginName}`

  return provider ? `langgenius/${provider}` : ''
}

type ModelSelectorBaseProps = {
  value?: ModelSelectorValue
  models: ModelSelectorProvider[]
  className?: string
  popupClassName?: string
  onValueChange?: (model: ModelSelectorValue) => void
  onHide?: () => void
  disabled?: boolean
  scopeFeatures?: readonly string[]
  showDeprecatedWarnIcon?: boolean
  hideProviderSettingsFooter?: boolean
  onConfigureEmptyState?: () => void
  onOpenMarketplace?: () => void
  showModelMeta?: boolean
  modelPredicate?: ModelSelectorModelPredicate
  modelSuggestionPredicate?: ModelSelectorModelPredicate
}
type ModelSelectorProps = ModelSelectorBaseProps & {
  size?: 'small' | 'medium'
  surface?: 'default' | 'workflow'
}
type SplitModelSelectorProps = ModelSelectorBaseProps & {
  surface?: 'default' | 'workflow'
}

function ModelSelectorRoot({
  value,
  models,
  className,
  popupClassName,
  onValueChange,
  onHide,
  disabled,
  size,
  surface,
  shape,
  scopeFeatures = [],
  showDeprecatedWarnIcon = true,
  hideProviderSettingsFooter,
  onConfigureEmptyState,
  onOpenMarketplace,
  showModelMeta,
  modelPredicate,
  modelSuggestionPredicate,
}: ModelSelectorBaseProps & {
  size: 'small' | 'medium'
  surface: 'default' | 'workflow'
  shape: 'standalone' | 'split'
}) {
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [settingsDestination, setSettingsDestination] = useQueryState(
    settingsQueryParamName,
    settingsQueryParser,
  )
  const { currentProvider, currentModel } = getCurrentProviderAndModel(models, value)
  const currentValue = useMemo<ModelSelectorValue | null>(() => {
    if (!currentProvider || !currentModel) return null

    return {
      provider: currentProvider.provider,
      model: currentModel.model,
    }
  }, [currentModel, currentProvider])

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (disabled && newOpen) return

      setOpen(newOpen)
      if (!newOpen) setInputValue('')
    },
    [disabled],
  )

  const handleSelect = useCallback(
    (provider: string, model: ModelSelectorModel) => {
      setOpen(false)
      setInputValue('')

      if (onValueChange) {
        onValueChange({
          provider,
          model: model.model,
          plugin_id: getModelProviderPluginId(provider),
        })
      }
    },
    [onValueChange],
  )

  const handleHide = useCallback(() => {
    setOpen(false)
    setInputValue('')
    onHide?.()
  }, [onHide])

  const handleOpenSettings = useCallback(() => {
    handleHide()
    setSettingsDestination('provider')
  }, [handleHide, setSettingsDestination])

  const handleValueChange = useCallback(
    (value: ModelSelectorValue | null) => {
      if (!value) return

      const provider = models.find((model) => model.provider === value.provider)
      const model = provider?.models.find((model) => model.model === value.model)

      if (!provider || !model) return
      if (model.status !== ModelStatusEnum.active) return

      handleSelect(provider.provider, model)
    },
    [handleSelect, models],
  )

  const handleInputValueChange = useCallback(
    (inputValue: string, details: ComboboxChangeEventDetails) => {
      if (details.reason !== 'item-press') setInputValue(inputValue)
    },
    [],
  )

  const handleConfigureEmptyState = useCallback(() => {
    if (onConfigureEmptyState) {
      handleHide()
      onConfigureEmptyState()
      return
    }
    if (settingsDestination === 'provider') {
      handleHide()
      return
    }

    handleOpenSettings()
  }, [handleHide, handleOpenSettings, onConfigureEmptyState, settingsDestination])

  return (
    <Combobox<ModelSelectorValue>
      disabled={disabled}
      filter={null}
      inputValue={inputValue}
      isItemEqualToValue={isSameModelSelectorValue}
      itemToStringLabel={getModelSelectorValueLabel}
      open={open}
      value={currentValue}
      onInputValueChange={handleInputValueChange}
      onOpenChange={handleOpenChange}
      onValueChange={handleValueChange}
    >
      <ModelSelectorTrigger
        currentProvider={currentProvider}
        currentModel={currentModel}
        defaultModel={value}
        disabled={disabled}
        size={size}
        surface={surface}
        shape={shape}
        className={className}
        showDeprecatedWarnIcon={showDeprecatedWarnIcon}
        showModelMeta={showModelMeta}
        isModelCompatible={
          currentProvider && currentModel
            ? modelPredicate?.(currentProvider, currentModel)
            : undefined
        }
      />
      <ComboboxContent
        popupClassName={cn(
          'flex max-h-[min(624px,var(--available-height,624px))] flex-col',
          popupClassName,
        )}
      >
        <Popup
          defaultModel={value}
          inputValue={inputValue}
          modelList={models}
          scopeFeatures={scopeFeatures}
          modelPredicate={modelPredicate}
          modelSuggestionPredicate={modelSuggestionPredicate}
          onOpenProviderSettings={
            !hideProviderSettingsFooter && settingsDestination !== 'provider'
              ? handleOpenSettings
              : undefined
          }
          onConfigureEmptyState={handleConfigureEmptyState}
          onOpenMarketplace={onOpenMarketplace}
          onInputValueChange={setInputValue}
          onHide={handleHide}
        />
      </ComboboxContent>
    </Combobox>
  )
}

function ModelSelector({ size = 'medium', surface = 'default', ...props }: ModelSelectorProps) {
  return <ModelSelectorRoot {...props} shape="standalone" size={size} surface={surface} />
}

function SplitModelSelector({ surface = 'default', ...props }: SplitModelSelectorProps) {
  return <ModelSelectorRoot {...props} shape="split" size="medium" surface={surface} />
}

export { ModelSelector, SplitModelSelector }

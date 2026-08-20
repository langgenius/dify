import type {
  ModelSelectorModel,
  ModelSelectorModelPredicate,
  ModelSelectorProvider,
  ModelSelectorValue,
} from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTitle } from '@langgenius/dify-ui/popover'
import { useQueryState } from 'nuqs'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import { getCurrentProviderAndModel } from '../hooks'
import { ModelSelectorTrigger } from './model-selector-trigger'
import Popup from './popup'

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
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [settingsDestination, setSettingsDestination] = useQueryState(
    settingsQueryParamName,
    settingsQueryParser,
  )
  const { currentProvider, currentModel } = getCurrentProviderAndModel(models, value)

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
    <Popover open={open} onOpenChange={handleOpenChange}>
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
      <PopoverContent
        placement="bottom-start"
        className={cn(
          'flex max-h-[min(624px,var(--available-height,624px))] w-(--anchor-width) max-w-[min(28rem,var(--available-width))] flex-col overflow-hidden rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg',
          popupClassName,
        )}
      >
        <PopoverTitle className="sr-only">
          {t(($) => $['detailPanel.configureModel'], { ns: 'plugin' })}
        </PopoverTitle>
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
          onSelect={handleSelect}
          onHide={handleHide}
        />
      </PopoverContent>
    </Popover>
  )
}

function ModelSelector({ size = 'medium', surface = 'default', ...props }: ModelSelectorProps) {
  return <ModelSelectorRoot {...props} shape="standalone" size={size} surface={surface} />
}

function SplitModelSelector({ surface = 'default', ...props }: SplitModelSelectorProps) {
  return <ModelSelectorRoot {...props} shape="split" size="medium" surface={surface} />
}

export { ModelSelector, SplitModelSelector }

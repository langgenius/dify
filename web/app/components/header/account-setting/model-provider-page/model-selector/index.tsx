import type { ComponentProps, ReactNode } from 'react'
import type {
  ModelSelectorModel,
  ModelSelectorModelPredicate,
  ModelSelectorProvider,
  ModelSelectorValue,
} from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { Popover, PopoverContent, PopoverTitle } from '@langgenius/dify-ui/popover'
import { useQueryState } from 'nuqs'
import { createContext, use, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  settingsQueryParamName,
  settingsQueryParser,
} from '@/app/components/header/account-setting/query-params'
import { getCurrentProviderAndModel } from '../hooks'
import { ModelSelectorTrigger as ModelSelectorTriggerView } from './model-selector-trigger'
import Popup from './popup'

const getModelProviderPluginId = (provider: string) => {
  const [organization, pluginName] = provider.split('/').filter(Boolean)

  if (organization && pluginName) return `${organization}/${pluginName}`

  return provider ? `langgenius/${provider}` : ''
}

type ModelSelectorBaseProps = {
  'aria-labelledby'?: string
  value?: ModelSelectorValue
  models: ModelSelectorProvider[]
  className?: string
  popupClassName?: string
  onValueChange?: (model: ModelSelectorValue) => void
  onClear?: () => void
  clearLabel?: string
  onHide?: () => void
  disabled?: boolean
  loading?: boolean
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

type ModelSelectorContextValue = {
  triggerProps: ComponentProps<typeof ModelSelectorTriggerView>
  popupProps: ComponentProps<typeof Popup>
  popupClassName?: string
}

const ModelSelectorContext = createContext<ModelSelectorContextValue | null>(null)

function useModelSelectorContext() {
  const context = use(ModelSelectorContext)
  if (!context) throw new Error('Model selector parts must be used within ModelSelectorRoot')
  return context
}

function ModelSelectorRoot({
  children,
  'aria-labelledby': labelledBy,
  value,
  models,
  className,
  popupClassName,
  onValueChange,
  onClear,
  clearLabel,
  onHide,
  disabled,
  loading,
  size = 'medium',
  surface = 'default',
  shape = 'standalone',
  scopeFeatures = [],
  showDeprecatedWarnIcon = true,
  hideProviderSettingsFooter,
  onConfigureEmptyState,
  onOpenMarketplace,
  showModelMeta,
  modelPredicate,
  modelSuggestionPredicate,
}: ModelSelectorBaseProps & {
  children: ReactNode
  size?: 'small' | 'medium'
  surface?: 'default' | 'workflow'
  shape?: 'standalone' | 'split'
}) {
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const [settingsDestination, setSettingsDestination] = useQueryState(
    settingsQueryParamName,
    settingsQueryParser,
  )
  const { currentProvider, currentModel } = getCurrentProviderAndModel(models, value)

  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if ((disabled || loading) && newOpen) return

      setOpen(newOpen)
      if (!newOpen) setInputValue('')
    },
    [disabled, loading],
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
      <ModelSelectorContext
        value={{
          triggerProps: {
            'aria-labelledby': labelledBy,
            currentProvider,
            currentModel,
            defaultModel: value,
            onClear,
            clearLabel,
            disabled: disabled || loading,
            loading,
            size,
            surface,
            shape,
            className,
            showDeprecatedWarnIcon,
            showModelMeta,
            isModelCompatible:
              currentProvider && currentModel
                ? modelPredicate?.(currentProvider, currentModel)
                : undefined,
          },
          popupProps: {
            defaultModel: value,
            inputValue,
            modelList: models,
            scopeFeatures,
            modelPredicate,
            modelSuggestionPredicate,
            onOpenProviderSettings:
              !hideProviderSettingsFooter && settingsDestination !== 'provider'
                ? handleOpenSettings
                : undefined,
            onConfigureEmptyState: handleConfigureEmptyState,
            onOpenMarketplace,
            onInputValueChange: setInputValue,
            onSelect: handleSelect,
            onHide: handleHide,
          },
          popupClassName,
        }}
      >
        {children}
      </ModelSelectorContext>
    </Popover>
  )
}

function ModelSelectorTrigger({
  ref,
}: Pick<ComponentProps<typeof ModelSelectorTriggerView>, 'ref'>) {
  const { triggerProps } = useModelSelectorContext()
  return <ModelSelectorTriggerView {...triggerProps} ref={ref} />
}

function ModelSelectorContent() {
  const { t } = useTranslation(['plugin'])
  const { popupProps, popupClassName } = useModelSelectorContext()
  return (
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
      <Popup {...popupProps} />
    </PopoverContent>
  )
}

function ModelSelector({ size = 'medium', surface = 'default', ...props }: ModelSelectorProps) {
  return (
    <ModelSelectorRoot {...props} shape="standalone" size={size} surface={surface}>
      <ModelSelectorTrigger />
      <ModelSelectorContent />
    </ModelSelectorRoot>
  )
}

function SplitModelSelector({ surface = 'default', ...props }: SplitModelSelectorProps) {
  return (
    <ModelSelectorRoot {...props} shape="split" size="medium" surface={surface}>
      <ModelSelectorTrigger />
      <ModelSelectorContent />
    </ModelSelectorRoot>
  )
}

export {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorRoot,
  ModelSelectorTrigger,
  SplitModelSelector,
}

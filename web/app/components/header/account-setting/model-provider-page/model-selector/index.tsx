import type { ComboboxRootChangeEventDetails } from '@langgenius/dify-ui/combobox'
import type { DefaultModel, Model, ModelFeatureEnum, ModelItem } from '../declarations'
import type { ModelSelectorValue } from './types'
import { cn } from '@langgenius/dify-ui/cn'
import { Combobox, ComboboxContent, ComboboxTrigger } from '@langgenius/dify-ui/combobox'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ModelStatusEnum } from '../declarations'
import { useCurrentProviderAndModel } from '../hooks'
import ModelSelectorTrigger from './model-selector-trigger'
import Popup from './popup'
import { getModelSelectorValueLabel, isSameModelSelectorValue } from './types'

type ModelSelectorProps = {
  defaultModel?: DefaultModel
  modelList: Model[]
  triggerClassName?: string
  popupClassName?: string
  onSelect?: (model: DefaultModel) => void
  onHide?: () => void
  readonly?: boolean
  scopeFeatures?: ModelFeatureEnum[]
  deprecatedClassName?: string
  showDeprecatedWarnIcon?: boolean
}
function ModelSelector({
  defaultModel,
  modelList,
  triggerClassName,
  popupClassName,
  onSelect,
  onHide,
  readonly,
  scopeFeatures = [],
  deprecatedClassName,
  showDeprecatedWarnIcon = true,
}: ModelSelectorProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const {
    currentProvider,
    currentModel,
  } = useCurrentProviderAndModel(
    modelList,
    defaultModel,
  )
  const currentValue = useMemo<ModelSelectorValue | null>(() => {
    if (!currentProvider || !currentModel)
      return null

    return {
      provider: currentProvider.provider,
      model: currentModel.model,
    }
  }, [currentModel, currentProvider])

  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (readonly)
      return

    setOpen(newOpen)
    if (!newOpen)
      setInputValue('')
  }, [readonly])

  const handleSelect = useCallback((provider: string, model: ModelItem) => {
    setOpen(false)
    setInputValue('')

    if (onSelect)
      onSelect({ provider, model: model.model })
  }, [onSelect])

  const handleValueChange = useCallback((value: ModelSelectorValue | null) => {
    if (!value)
      return

    const provider = modelList.find(model => model.provider === value.provider)
    const model = provider?.models.find(model => model.model === value.model)

    if (!provider || !model)
      return
    if (model.status !== ModelStatusEnum.active)
      return

    handleSelect(provider.provider, model)
  }, [handleSelect, modelList])

  const handleInputValueChange = useCallback((inputValue: string, details: ComboboxRootChangeEventDetails) => {
    if (details.reason !== 'item-press')
      setInputValue(inputValue)
  }, [])

  const handleHide = useCallback(() => {
    setOpen(false)
    setInputValue('')
    onHide?.()
  }, [onHide])

  return (
    <Combobox<ModelSelectorValue>
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
      <ComboboxTrigger
        aria-label={t('detailPanel.configureModel', { ns: 'plugin' })}
        icon={false}
        className="block h-auto w-full border-0 bg-transparent p-0 text-left hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-0 data-open:bg-transparent"
        disabled={readonly}
      >
        <ModelSelectorTrigger
          currentProvider={currentProvider}
          currentModel={currentModel}
          defaultModel={defaultModel}
          open={open}
          readonly={readonly}
          className={triggerClassName}
          deprecatedClassName={deprecatedClassName}
          showDeprecatedWarnIcon={showDeprecatedWarnIcon}
        />
      </ComboboxTrigger>
      <ComboboxContent
        placement="bottom-start"
        sideOffset={4}
        popupClassName={cn('w-[432px] max-w-[432px] overflow-hidden rounded-xl', popupClassName)}
      >
        <Popup
          defaultModel={defaultModel}
          inputValue={inputValue}
          modelList={modelList}
          scopeFeatures={scopeFeatures}
          onInputValueChange={setInputValue}
          onHide={handleHide}
        />
      </ComboboxContent>
    </Combobox>
  )
}

export default ModelSelector

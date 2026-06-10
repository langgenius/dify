import type { ComponentProps, FC } from 'react'
import type {
  DefaultModel,
  Model,
  ModelFeatureEnum,
  ModelItem,
} from '../declarations'
import type { Placement } from '@/app/components/base/ui/placement'
import { useState } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/app/components/base/ui/popover'
import { useCurrentProviderAndModel } from '../hooks'
import ModelSelectorTrigger from './model-selector-trigger'
import Popup from './popup'

type ModelSelectorProps = {
  defaultModel?: DefaultModel
  modelList: Model[]
  triggerClassName?: string
  popupClassName?: string
  popupPlacement?: Placement
  positionerProps?: ComponentProps<typeof PopoverContent>['positionerProps']
  onSelect?: (model: DefaultModel) => void
  onHide?: () => void
  readonly?: boolean
  scopeFeatures?: ModelFeatureEnum[]
  deprecatedClassName?: string
  showDeprecatedWarnIcon?: boolean
}
const ModelSelector: FC<ModelSelectorProps> = ({
  defaultModel,
  modelList,
  triggerClassName,
  popupClassName,
  popupPlacement = 'bottom-start',
  positionerProps,
  onSelect,
  onHide,
  readonly,
  scopeFeatures = [],
  deprecatedClassName,
  showDeprecatedWarnIcon = true,
}) => {
  const [open, setOpen] = useState(false)
  const {
    currentProvider,
    currentModel,
  } = useCurrentProviderAndModel(
    modelList,
    defaultModel,
  )

  const handleSelect = (provider: string, model: ModelItem) => {
    setOpen(false)

    if (onSelect)
      onSelect({ provider, model: model.model })
  }

  return (
    <Popover
      open={open}
      onOpenChange={(newOpen) => {
        if (readonly)
          return
        setOpen(newOpen)
      }}
    >
      <PopoverTrigger
        render={(
          <button
            type="button"
            className="block w-full border-0 bg-transparent p-0 text-left"
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
          </button>
        )}
      />
      <PopoverContent
        placement={popupPlacement}
        sideOffset={4}
        positionerProps={positionerProps}
        className={popupClassName}
        popupClassName="overflow-hidden rounded-lg"
        popupProps={{ style: { minWidth: '320px', width: 'var(--anchor-width, auto)' } }}
      >
        <Popup
          defaultModel={defaultModel}
          modelList={modelList}
          onSelect={handleSelect}
          scopeFeatures={scopeFeatures}
          onHide={() => {
            setOpen(false)
            onHide?.()
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export default ModelSelector

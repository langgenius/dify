import type { FC } from 'react'
import { useState } from 'react'
import type {
  DefaultModel,
  Model,
  ModelItem,
} from '../declarations'
import type { ModelFeatureEnum } from '../declarations'
import { useCurrentProviderAndModel } from '../hooks'
import ModelTrigger from './model-trigger'
import EmptyTrigger from './empty-trigger'
import DeprecatedModelTrigger from './deprecated-model-trigger'
import Popup from './popup'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import classNames from '@/utils/classnames'

type ModelSelectorProps = {
  defaultModel?: DefaultModel
  modelList: Model[]
  triggerClassName?: string
  popupClassName?: string
  onSelect?: (model: DefaultModel) => void
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
  onSelect,
  readonly,
  scopeFeatures = [],
  deprecatedClassName,
  showDeprecatedWarnIcon = false,
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

  const handleToggle = () => {
    if (readonly)
      return

    setOpen(v => !v)
  }

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={4}
    >
      <div className={classNames('relative')}>
        <PortalToFollowElemTrigger
          onClick={handleToggle}
          className='block'
        >
          {
            currentModel && currentProvider && (
              <ModelTrigger
                open={open}
                provider={currentProvider}
                model={currentModel}
                className={triggerClassName}
                readonly={readonly}
              />
            )
          }
          {
            !currentModel && defaultModel && (
              <DeprecatedModelTrigger
                modelName={defaultModel?.model || ''}
                providerName={defaultModel?.provider || ''}
                className={triggerClassName}
                showWarnIcon={showDeprecatedWarnIcon}
                contentClassName={deprecatedClassName}
              />
            )
          }
          {
            !defaultModel && (
              <EmptyTrigger
                open={open}
                className={triggerClassName}
              />
            )
          }
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className={`z-[1002] ${popupClassName}`}>
          <Popup
            defaultModel={defaultModel}
            modelList={modelList}
            onSelect={handleSelect}
            scopeFeatures={scopeFeatures}
            onHide={() => setOpen(false)}
          />
        </PortalToFollowElemContent>
      </div>
    </PortalToFollowElem>
  )
}

export default ModelSelector

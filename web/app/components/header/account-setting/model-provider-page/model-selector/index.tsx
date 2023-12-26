import type { FC } from 'react'
import { useState } from 'react'
import type {
  DefaultModel,
  Model,
  ModelItem,
} from '../declarations'
import { useCurrentProviderAndModel } from '../hooks'
import ModelTrigger from './model-trigger'
import EmptyTrigger from './empty-trigger'
import Popup from './popup'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

type ModelSelectorProps = {
  defaultModel?: DefaultModel
  modelList: Model[]
  popupClassName?: string
  onSelect?: (model: DefaultModel) => void
  readonly?: boolean
}
const ModelSelector: FC<ModelSelectorProps> = ({
  defaultModel,
  modelList,
  popupClassName,
  onSelect,
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
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement='bottom-start'
      offset={4}
    >
      <div className='relative'>
        <PortalToFollowElemTrigger
          onClick={() => setOpen(v => !v)}
          className='block'
        >
          {
            currentModel && currentProvider && (
              <ModelTrigger
                open={open}
                provider={currentProvider}
                model={currentModel}
              />
            )
          }
          {
            !currentModel && (
              <EmptyTrigger
                open={open}
              />
            )
          }
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className={`z-[60] ${popupClassName}`}>
          <Popup
            defaultModel={defaultModel}
            modelList={modelList}
            onSelect={handleSelect}
          />
        </PortalToFollowElemContent>
      </div>
    </PortalToFollowElem>
  )
}

export default ModelSelector

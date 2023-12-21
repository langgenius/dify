import type { FC } from 'react'
import { useState } from 'react'
import type {
  Model,
  ModelItem,
} from '../declarations'
import ModelTrigger from './model-trigger'
import EmptyTrigger from './empty-trigger'
import Popup from './popup'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'

type ModelSelectorProps = {
  defaultModel?: ModelItem
  modelList: Model[]
  popupClassName?: string
  onSelect: (model: ModelItem) => void
}
const ModelSelector: FC<ModelSelectorProps> = ({
  defaultModel,
  modelList,
  popupClassName,
  onSelect,
}) => {
  const [open, setOpen] = useState(false)

  const handleSelect = (model: ModelItem) => {
    setOpen(false)
    onSelect(model)
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
            defaultModel && (
              <ModelTrigger
                open={open}
                model={defaultModel}
              />
            )
          }
          {
            !defaultModel && (
              <EmptyTrigger
                open={open}
              />
            )
          }
        </PortalToFollowElemTrigger>
        <PortalToFollowElemContent className={popupClassName}>
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

import { useState } from 'react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'
import type { ChunkStructureEnum } from '../../types'
import OptionCard from '../option-card'
import type { Option } from './type'

type SelectorProps = {
  options: Option[]
  value: ChunkStructureEnum
  onChange: (key: ChunkStructureEnum) => void
  readonly?: boolean
}
const Selector = ({
  options,
  value,
  onChange,
  readonly,
}: SelectorProps) => {
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      placement='bottom-end'
      offset={{
        mainAxis: 0,
        crossAxis: -8,
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger onClick={() => {
        if (readonly)
          return
        setOpen(!open)
      }}>
        <Button
          size='small'
          variant='ghost-accent'
        >
          change
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className='z-10'>
        <div className='w-[404px] rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur shadow-xl backdrop-blur-[5px]'>
          <div className='system-sm-semibold px-3 pt-3.5 text-text-primary'>
            change Chunk Structure
          </div>
          <div className='space-y-1 p-3 pt-2'>
            {
              options.map(option => (
                <OptionCard
                  key={option.id}
                  id={option.id}
                  icon={option.icon}
                  title={option.title}
                  description={option.description}
                  onClick={() => {
                    if (readonly)
                      return
                    onChange(option.id)
                    setOpen(false)
                  }}
                  showHighlightBorder={value === option.id}
                ></OptionCard>
              ))
            }
          </div>
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default Selector

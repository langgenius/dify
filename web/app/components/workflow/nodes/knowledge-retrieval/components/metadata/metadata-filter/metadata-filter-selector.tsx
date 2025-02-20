import { useState } from 'react'
import {
  RiArrowDownSLine,
  RiCheckLine,
} from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import Button from '@/app/components/base/button'
import { MetadataFilteringModeEnum } from '@/app/components/workflow/nodes/knowledge-retrieval/types'

type MetadataFilterSelectorProps = {
  value: MetadataFilteringModeEnum
  onSelect: (value: MetadataFilteringModeEnum) => void
}
const MetadataFilterSelector = ({
  value,
  onSelect,
}: MetadataFilterSelectorProps) => {
  const [open, setOpen] = useState(false)
  const options = [
    {
      key: MetadataFilteringModeEnum.disabled,
      value: 'Disabled',
      desc: 'Not enabling metadata filtering',
    },
    {
      key: MetadataFilteringModeEnum.automatic,
      value: 'Automatic',
      desc: 'Automatically generate metadata filtering conditions based on user query',
    },
    {
      key: MetadataFilteringModeEnum.manual,
      value: 'Manual',
      desc: 'Manually add metadata filtering conditions',
    },
  ]

  const selectedOption = options.find(option => option.key === value)!

  return (
    <PortalToFollowElem
      placement='bottom-end'
      offset={{
        mainAxis: 4,
        crossAxis: 0,
      }}
      open={open}
      onOpenChange={setOpen}
    >
      <PortalToFollowElemTrigger onClick={() => setOpen(!open)}>
        <Button
          variant='secondary'
          size='small'
        >
          {selectedOption.value}
          <RiArrowDownSLine className='w-3.5 h-3.5' />
        </Button>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent>
        <div className='p-1 bg-components-panel-bg-blur border-[0.5px] border-components-panel-border rounded-xl shadow-lg'>
          {
            options.map(option => (
              <div
                key={option.key}
                className='flex p-2 pr-3 rounded-lg cursor-pointer hover:bg-state-base-hover'
                onClick={() => {
                  onSelect(option.key)
                  setOpen(false)
                }}
              >
                <div className='shrink-0 w-4'>
                  {
                    option.key === value && (
                      <RiCheckLine className='w-4 h-4 text-text-accent' />
                    )
                  }
                </div>
                <div className='grow'>
                  <div className='system-sm-semibold text-text-secondary'>
                    {option.value}
                  </div>
                  <div className='system-xs-regular text-text-tertiary'>
                    {option.desc}
                  </div>
                </div>
              </div>
            ))
          }
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default MetadataFilterSelector

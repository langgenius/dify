'use client'
import React, { useState } from 'react'
import { RiArrowDownSLine, RiCheckLine } from '@remixicon/react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import cn from '@/utils/classnames'

type Props = {
  inCell?: boolean
  value?: any
  list: any
  onSelect: (value: any) => void
  popupClassName?: string
}

const VariableTypeSelector = ({
  inCell = false,
  value,
  list,
  onSelect,
  popupClassName,
}: Props) => {
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={() => setOpen(v => !v)}
      placement='bottom'
    >
      <PortalToFollowElemTrigger className='w-full' onClick={() => setOpen(v => !v)}>
        <div className={cn(
          'flex w-full cursor-pointer items-center px-2',
          !inCell && 'bg-components-input-bg-normal hover:bg-state-base-hover-alt radius-md py-1',
          inCell && 'hover:bg-state-base-hover py-0.5',
          open && !inCell && 'bg-state-base-hover-alt hover:bg-state-base-hover-alt',
          open && inCell && 'bg-state-base-hover hover:bg-state-base-hover',
        )}>
          <div className={cn(
            'system-sm-regular text-components-input-text-filled grow truncate p-1',
            inCell && 'system-xs-regular text-text-secondary',
          )}>{value}</div>
          <RiArrowDownSLine className='text-text-quaternary ml-0.5 h-4 w-4' />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className={cn('z-[11] w-full', popupClassName)}>
        <div className='bg-components-panel-bg-blur border-components-panel-border radius-xl border-[0.5px] p-1 shadow-lg'>
          {list.map((item: any) => (
            <div key={item} className='radius-md hover:bg-state-base-hover flex cursor-pointer items-center gap-2 py-[6px] pl-3 pr-2' onClick={() => {
              onSelect(item)
              setOpen(false)
            }}>
              <div className='system-md-regular text-text-secondary grow truncate'>{item}</div>
              {value === item && <RiCheckLine className='text-text-accent h-4 w-4' />}
            </div>
          ))}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default VariableTypeSelector

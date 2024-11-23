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
          'flex items-center w-full px-2 cursor-pointer',
          !inCell && 'py-1 bg-components-input-bg-normal hover:bg-state-base-hover-alt radius-md',
          inCell && 'py-0.5 hover:bg-state-base-hover',
          open && !inCell && 'bg-state-base-hover-alt hover:bg-state-base-hover-alt',
          open && inCell && 'bg-state-base-hover hover:bg-state-base-hover',
        )}>
          <div className={cn(
            'grow p-1 system-sm-regular text-components-input-text-filled truncate',
            inCell && 'system-xs-regular text-text-secondary',
          )}>{value}</div>
          <RiArrowDownSLine className='ml-0.5 w-4 h-4 text-text-quaternary' />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className={cn('w-full z-[11]', popupClassName)}>
        <div className='p-1 bg-components-panel-bg-blur border-[0.5px] border-components-panel-border radius-xl shadow-lg'>
          {list.map((item: any) => (
            <div key={item} className='flex items-center gap-2 pl-3 pr-2 py-[6px] radius-md cursor-pointer hover:bg-state-base-hover' onClick={() => {
              onSelect(item)
              setOpen(false)
            }}>
              <div className='grow system-md-regular text-text-secondary truncate'>{item}</div>
              {value === item && <RiCheckLine className='w-4 h-4 text-text-accent' />}
            </div>
          ))}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default VariableTypeSelector

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
          !inCell && 'radius-md bg-components-input-bg-normal py-1 hover:bg-state-base-hover-alt',
          inCell && 'py-0.5 hover:bg-state-base-hover',
          open && !inCell && 'bg-state-base-hover-alt hover:bg-state-base-hover-alt',
          open && inCell && 'bg-state-base-hover hover:bg-state-base-hover',
        )}>
          <div className={cn(
            'system-sm-regular grow truncate p-1 text-components-input-text-filled',
            inCell && 'system-xs-regular text-text-secondary',
          )}>{value}</div>
          <RiArrowDownSLine className='ml-0.5 h-4 w-4 text-text-quaternary' />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className={cn('z-[11] w-full', popupClassName)}>
        <div className='radius-xl border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg'>
          {list.map((item: any) => (
            <div key={item} className='radius-md flex cursor-pointer items-center gap-2 py-[6px] pl-3 pr-2 hover:bg-state-base-hover' onClick={() => {
              onSelect(item)
              setOpen(false)
            }}>
              <div className='system-md-regular grow truncate text-text-secondary'>{item}</div>
              {value === item && <RiCheckLine className='h-4 w-4 text-text-accent' />}
            </div>
          ))}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default VariableTypeSelector

'use client'
import { RiArrowDownSLine, RiCheckLine } from '@remixicon/react'
import * as React from 'react'
import { useState } from 'react'
import {
  PortalToFollowElem,
  PortalToFollowElemContent,
  PortalToFollowElemTrigger,
} from '@/app/components/base/portal-to-follow-elem'
import { cn } from '@/utils/classnames'

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
      placement="bottom"
    >
      <PortalToFollowElemTrigger className="w-full" onClick={() => setOpen(v => !v)}>
        <div className={cn(
          'flex w-full cursor-pointer items-center px-2',
          !inCell && 'bg-components-input-bg-normal py-1 radius-md hover:bg-state-base-hover-alt',
          inCell && 'py-0.5 hover:bg-state-base-hover',
          open && !inCell && 'bg-state-base-hover-alt hover:bg-state-base-hover-alt',
          open && inCell && 'bg-state-base-hover hover:bg-state-base-hover',
        )}
        >
          <div className={cn(
            'grow truncate p-1 text-components-input-text-filled system-sm-regular',
            inCell && 'text-text-secondary system-xs-regular',
          )}
          >
            {value}
          </div>
          <RiArrowDownSLine className="ml-0.5 h-4 w-4 text-text-quaternary" />
        </div>
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent className={cn('z-[11] w-full', popupClassName)}>
        <div className="border-[0.5px] border-components-panel-border bg-components-panel-bg-blur p-1 shadow-lg radius-xl">
          {list.map((item: any) => (
            <div
              key={item}
              className="flex cursor-pointer items-center gap-2 py-[6px] pl-3 pr-2 radius-md hover:bg-state-base-hover"
              onClick={() => {
                onSelect(item)
                setOpen(false)
              }}
            >
              <div className="grow truncate text-text-secondary system-md-regular">{item}</div>
              {value === item && <RiCheckLine className="h-4 w-4 text-text-accent" />}
            </div>
          ))}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default VariableTypeSelector

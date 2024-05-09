'use client'
import type { FC } from 'react'
import React, { useState } from 'react'
import cn from 'classnames'
import type { OffsetOptions, Placement } from '@floating-ui/react'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
export type TooltipProps = {
  position?: Placement
  triggerMethod?: 'hover' | 'click'
  popupContent: React.ReactNode
  children: React.ReactNode
  hideArrow?: boolean
  popupClassName?: string
  offset?: OffsetOptions
}

const arrow = (
  <svg className="absolute text-white h-2 w-full left-0 top-full" x="0px" y="0px" viewBox="0 0 255 255"><polygon className="fill-current" points="0,0 127.5,127.5 255,0"></polygon></svg>
)

const Tooltip: FC<TooltipProps> = ({
  position = 'top',
  triggerMethod = 'hover',
  popupContent,
  children,
  hideArrow,
  popupClassName,
  offset,
}) => {
  const [open, setOpen] = useState(false)

  return (
    <PortalToFollowElem
      open={open}
      onOpenChange={setOpen}
      placement={position}
      offset={offset ?? 10}
    >
      <PortalToFollowElemTrigger
        onClick={() => triggerMethod === 'click' && setOpen(v => !v)}
        onMouseEnter={() => triggerMethod === 'hover' && setOpen(true)}
        onMouseLeave={() => triggerMethod === 'hover' && setOpen(false)}
      >
        {children}
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent
        className="z-[9999]"
      >
        <div className={cn(
          'relative px-3 py-2 text-xs font-normal text-gray-700 bg-white rounded-md shadow-lg',
          popupClassName,
        )}>
          {popupContent}
          {!hideArrow && arrow}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default React.memo(Tooltip)

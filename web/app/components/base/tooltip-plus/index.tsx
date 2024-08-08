'use client'
import type { FC } from 'react'
import React, { useEffect, useRef, useState } from 'react'
import { useBoolean } from 'ahooks'
import type { OffsetOptions, Placement } from '@floating-ui/react'
import { RiQuestionLine } from '@remixicon/react'
import cn from '@/utils/classnames'
import { PortalToFollowElem, PortalToFollowElemContent, PortalToFollowElemTrigger } from '@/app/components/base/portal-to-follow-elem'
export type TooltipProps = {
  position?: Placement
  triggerMethod?: 'hover' | 'click'
  iconStyle?: string
  disabled?: boolean
  popupContent?: React.ReactNode
  children?: React.ReactNode
  hideArrow?: boolean
  popupClassName?: string
  offset?: OffsetOptions
  asChild?: boolean
  needsDelay?: boolean
}

const getArrow = (position: Placement) => {
  switch (position) {
    case 'top':
      return (
        <svg className="absolute text-components-tooltip-bg h-2 w-full left-0 top-full" x="0px" y="0px" viewBox="0 0 255 255">
          <polygon className="fill-current" points="0,0 127.5,127.5 255,0"></polygon>
        </svg>
      )
    case 'bottom':
      return (
        <svg className="absolute text-components-tooltip-bg h-2 w-full left-0 bottom-full" x="0px" y="0px" viewBox="0 0 255 255">
          <polygon className="fill-current" points="0,255 127.5,127.5 255,255"></polygon>
        </svg>
      )
    case 'right':
      return (
        <svg className="absolute text-components-tooltip-bg h-2 w-2 left-[-0.5rem] top-1/2 transform -translate-y-1/2" x="0px" y="0px" viewBox="0 0 255 255">
          <polygon className="fill-current" points="255,0 127.5,127.5 255,255"></polygon>
        </svg>
      )
    case 'left':
      return (
        <svg className="absolute text-components-tooltip-bg h-2 w-2 right-[-0.5rem] top-1/2 transform -translate-y-1/2" x="0px" y="0px" viewBox="0 0 255 255">
          <polygon className="fill-current" points="0,0 127.5,127.5 0,255"></polygon>
        </svg>
      )
    default:
      return null
  }
}

const Tooltip: FC<TooltipProps> = ({
  position = 'top',
  triggerMethod = 'hover',
  iconStyle = 'w-3.5 h-3.5',
  disabled = false,
  popupContent,
  children,
  hideArrow,
  popupClassName,
  offset,
  asChild,
  needsDelay = true,
}) => {
  const [open, setOpen] = useState(false)
  const [isHoverPopup, {
    setTrue: setHoverPopup,
    setFalse: setNotHoverPopup,
  }] = useBoolean(false)

  const isHoverPopupRef = useRef(isHoverPopup)
  useEffect(() => {
    isHoverPopupRef.current = isHoverPopup
  }, [isHoverPopup])

  const [isHoverTrigger, {
    setTrue: setHoverTrigger,
    setFalse: setNotHoverTrigger,
  }] = useBoolean(false)

  const isHoverTriggerRef = useRef(isHoverTrigger)
  useEffect(() => {
    isHoverTriggerRef.current = isHoverTrigger
  }, [isHoverTrigger])

  const handleLeave = (isTrigger: boolean) => {
    if (isTrigger)
      setNotHoverTrigger()

    else
      setNotHoverPopup()

    // give time to move to the popup
    if (needsDelay) {
      setTimeout(() => {
        if (!isHoverPopupRef.current && !isHoverTriggerRef.current)
          setOpen(false)
      }, 500)
    }
    else {
      setOpen(false)
    }
  }

  return (
    <PortalToFollowElem
      open={disabled ? false : open}
      onOpenChange={setOpen}
      placement={position}
      offset={offset ?? 10}
    >
      <PortalToFollowElemTrigger
        onClick={() => triggerMethod === 'click' && setOpen(v => !v)}
        onMouseEnter={() => {
          if (triggerMethod === 'hover') {
            setHoverTrigger()
            setOpen(true)
          }
        }}
        onMouseLeave={() => triggerMethod === 'hover' && handleLeave(true)}
        asChild={asChild}
      >
        {children || <div className='p-[1px]'><RiQuestionLine className={cn('text-text-quaternary hover:text-text-tertiary', iconStyle)} /></div>}
      </PortalToFollowElemTrigger>
      <PortalToFollowElemContent
        className="z-[9999]"
      >
        <div
          className={cn(
            'relative px-3 py-2 text-xs font-normal text-gray-700 bg-white rounded-md shadow-lg',
            popupClassName,
          )}
          onMouseEnter={() => triggerMethod === 'hover' && setHoverPopup()}
          onMouseLeave={() => triggerMethod === 'hover' && handleLeave(false)}
        >
          {popupContent}
          {!hideArrow && getArrow(position)}
        </div>
      </PortalToFollowElemContent>
    </PortalToFollowElem>
  )
}

export default React.memo(Tooltip)

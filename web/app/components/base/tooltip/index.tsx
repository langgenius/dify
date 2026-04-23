'use client'
import type { Placement } from '@langgenius/dify-ui/popover'
/**
 * @deprecated Use `@langgenius/dify-ui/tooltip` instead.
 * This component will be removed after migration is complete.
 * See: https://github.com/langgenius/dify/issues/32767
 */
import type { FC } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@langgenius/dify-ui/popover'
import { RiQuestionLine } from '@remixicon/react'
import { useBoolean } from 'ahooks'
import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { tooltipManager } from './TooltipManager'

type TooltipOffset = number | {
  mainAxis?: number
  crossAxis?: number
}

type TooltipProps = {
  position?: Placement
  triggerMethod?: 'hover' | 'click'
  triggerClassName?: string
  triggerTestId?: string
  disabled?: boolean
  popupContent?: React.ReactNode
  children?: React.ReactNode
  popupClassName?: string
  portalContentClassName?: string
  noDecoration?: boolean
  offset?: TooltipOffset
  needsDelay?: boolean
  asChild?: boolean
}

const Tooltip: FC<TooltipProps> = ({
  position = 'top',
  triggerMethod = 'hover',
  triggerClassName,
  triggerTestId,
  disabled = false,
  popupContent,
  children,
  popupClassName,
  portalContentClassName,
  noDecoration,
  offset,
  asChild = true,
  needsDelay = true,
}) => {
  const [open, setOpen] = useState(false)
  const resolvedOffset = offset ?? 8
  const sideOffset = typeof resolvedOffset === 'number' ? resolvedOffset : (resolvedOffset.mainAxis ?? 0)
  const alignOffset = typeof resolvedOffset === 'number' ? 0 : (resolvedOffset.crossAxis ?? 0)
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

  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearCloseTimeout = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current)
      closeTimeoutRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      clearCloseTimeout()
    }
  }, [clearCloseTimeout])

  const close = () => setOpen(false)
  const handleOpenChange = (nextOpen: boolean) => {
    if (disabled) {
      setOpen(false)
      return
    }
    if (triggerMethod === 'click')
      setOpen(nextOpen)
    else if (!nextOpen)
      setOpen(false)
  }

  const handleLeave = (isTrigger: boolean) => {
    if (isTrigger)
      setNotHoverTrigger()
    else
      setNotHoverPopup()

    // give time to move to the popup
    if (needsDelay) {
      clearCloseTimeout()
      closeTimeoutRef.current = setTimeout(() => {
        closeTimeoutRef.current = null
        if (!isHoverPopupRef.current && !isHoverTriggerRef.current) {
          setOpen(false)
          tooltipManager.clear(close)
        }
      }, 300)
    }
    else {
      clearCloseTimeout()
      setOpen(false)
      tooltipManager.clear(close)
    }
  }
  const handleTriggerMouseEnter = () => {
    if (triggerMethod === 'hover') {
      clearCloseTimeout()
      setHoverTrigger()
      tooltipManager.register(close)
      setOpen(true)
    }
  }
  const handleTriggerMouseLeave = () => {
    if (triggerMethod === 'hover')
      handleLeave(true)
  }
  const handlePopupMouseEnter = () => {
    if (triggerMethod === 'hover') {
      clearCloseTimeout()
      setHoverPopup()
    }
  }
  const handlePopupMouseLeave = () => {
    if (triggerMethod === 'hover')
      handleLeave(false)
  }

  const fallbackTrigger = (
    <div data-testid={triggerTestId} className={triggerClassName || 'h-3.5 w-3.5 shrink-0 p-px'}>
      <RiQuestionLine className="h-full w-full text-text-quaternary hover:text-text-tertiary" />
    </div>
  )
  const triggerContent = children || fallbackTrigger
  const childElement = React.isValidElement<React.HTMLAttributes<HTMLElement>>(triggerContent)
    ? triggerContent
    : fallbackTrigger
  const nativeButton = typeof childElement.type !== 'string' || childElement.type === 'button'

  const renderAsChildTrigger = () => {
    const childProps = childElement.props
    return React.cloneElement(childElement, {
      onMouseEnter: (event: React.MouseEvent<HTMLElement>) => {
        childProps.onMouseEnter?.(event)
        handleTriggerMouseEnter()
      },
      onMouseLeave: (event: React.MouseEvent<HTMLElement>) => {
        childProps.onMouseLeave?.(event)
        handleTriggerMouseLeave()
      },
    })
  }
  const effectiveOpen = !disabled && open

  return (
    <Popover
      open={effectiveOpen}
      onOpenChange={handleOpenChange}
    >
      {asChild
        ? (
            <PopoverTrigger
              nativeButton={nativeButton}
              disabled={disabled}
              render={renderAsChildTrigger()}
            />
          )
        : (
            <PopoverTrigger
              nativeButton={false}
              disabled={disabled}
              render={(
                <div
                  className={triggerClassName}
                  onMouseEnter={handleTriggerMouseEnter}
                  onMouseLeave={handleTriggerMouseLeave}
                />
              )}
            >
              {triggerContent}
            </PopoverTrigger>
          )}
      {effectiveOpen && !!popupContent && (
        <PopoverContent
          placement={position}
          sideOffset={sideOffset}
          alignOffset={alignOffset}
          className={portalContentClassName}
          popupClassName={cn(
            noDecoration
              ? 'border-0 bg-transparent p-0 shadow-none'
              : 'relative max-w-[300px] rounded-md border-0 bg-components-panel-bg px-3 py-2 text-left system-xs-regular wrap-break-word text-text-tertiary shadow-lg',
            popupClassName,
          )}
          popupProps={{
            onMouseEnter: handlePopupMouseEnter,
            onMouseLeave: handlePopupMouseLeave,
          }}
        >
          {popupContent}
        </PopoverContent>
      )}
    </Popover>
  )
}

export default React.memo(Tooltip)

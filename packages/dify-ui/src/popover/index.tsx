'use client'

import type * as React from 'react'
import type { Placement } from '../placement'
import { Popover as BasePopover } from '@base-ui/react/popover'
import { cn } from '../cn'
import { floatingPopupAnimationClassName } from '../overlay-shared'
import { parsePlacement } from '../placement'

const Popover = BasePopover.Root
const PopoverTrigger = BasePopover.Trigger
const PopoverClose = BasePopover.Close
const PopoverTitle = BasePopover.Title
const PopoverDescription = BasePopover.Description
const createPopoverHandle = BasePopover.createHandle

type PopoverProps<Payload = unknown> = BasePopover.Root.Props<Payload>
type PopoverHandle<Payload = unknown> = BasePopover.Handle<Payload>
type PopoverTriggerProps<Payload = unknown> = BasePopover.Trigger.Props<Payload>
type PopoverCloseProps = BasePopover.Close.Props
type PopoverTitleProps = BasePopover.Title.Props
type PopoverDescriptionProps = BasePopover.Description.Props

type PopoverContentProps = {
  children: React.ReactNode
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  className?: string
  popupClassName?: string
  positionerProps?: Omit<
    BasePopover.Positioner.Props,
    'children' | 'className' | 'side' | 'align' | 'sideOffset' | 'alignOffset'
  >
  popupProps?: Omit<BasePopover.Popup.Props, 'children' | 'className'>
}

function PopoverContent({
  children,
  placement = 'bottom',
  sideOffset = 8,
  alignOffset = 0,
  className,
  popupClassName,
  positionerProps,
  popupProps,
}: PopoverContentProps) {
  const { side, align } = parsePlacement(placement)

  return (
    <BasePopover.Portal>
      <BasePopover.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={cn('z-50 outline-hidden', className)}
        {...positionerProps}
      >
        <BasePopover.Popup
          className={cn(
            'rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg',
            'outline-hidden focus:outline-hidden focus-visible:outline-hidden',
            floatingPopupAnimationClassName,
            popupClassName,
          )}
          {...popupProps}
        >
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  )
}

export {
  createPopoverHandle,
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
}
export type {
  Placement,
  PopoverCloseProps,
  PopoverContentProps,
  PopoverDescriptionProps,
  PopoverHandle,
  PopoverProps,
  PopoverTitleProps,
  PopoverTriggerProps,
}

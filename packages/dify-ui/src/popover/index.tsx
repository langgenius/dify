'use client'

import type { ReactNode } from 'react'
import type { Placement } from '../placement'
import { Popover as BasePopover } from '@base-ui/react/popover'
import { cn } from '../cn'
import { parsePlacement } from '../placement'

export type { Placement }

export const Popover = BasePopover.Root
export const PopoverTrigger = BasePopover.Trigger
export const PopoverClose = BasePopover.Close
export const PopoverTitle = BasePopover.Title
export const PopoverDescription = BasePopover.Description
export const createPopoverHandle = BasePopover.createHandle

type PopoverContentProps = {
  children: ReactNode
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  className?: string
  popupClassName?: string
  positionerProps?: Omit<
    BasePopover.Positioner.Props,
    'children' | 'className' | 'side' | 'align' | 'sideOffset' | 'alignOffset'
  >
  popupProps?: Omit<
    BasePopover.Popup.Props,
    'children' | 'className'
  >
}

export function PopoverContent({
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
            'origin-(--transform-origin) transition-[transform,scale,opacity] data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none',
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

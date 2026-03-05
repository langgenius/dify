'use client'

import type { Placement } from '@/app/components/base/ui/placement'
import { Popover as BasePopover } from '@base-ui/react/popover'
import * as React from 'react'
import { parsePlacement } from '@/app/components/base/ui/placement'
import { cn } from '@/utils/classnames'

export const Popover = BasePopover.Root
export const PopoverTrigger = BasePopover.Trigger
export const PopoverClose = BasePopover.Close
export const PopoverTitle = BasePopover.Title
export const PopoverDescription = BasePopover.Description

type PopoverContentProps = {
  children: React.ReactNode
  placement?: Placement
  sideOffset?: number
  alignOffset?: number
  className?: string
  popupClassName?: string
  positionerProps?: Omit<
    React.ComponentPropsWithoutRef<typeof BasePopover.Positioner>,
    'children' | 'className' | 'side' | 'align' | 'sideOffset' | 'alignOffset'
  >
  popupProps?: Omit<
    React.ComponentPropsWithoutRef<typeof BasePopover.Popup>,
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
        className={cn('z-50 outline-none', className)}
        {...positionerProps}
      >
        <BasePopover.Popup
          className={cn(
            'rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg',
            'origin-[var(--transform-origin)] transition-[transform,scale,opacity] data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none',
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

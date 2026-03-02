'use client'

import type { Placement } from '@floating-ui/react'
import { Popover as BasePopover } from '@base-ui/react/popover'
import * as React from 'react'
import { cn } from '@/utils/classnames'

function parsePlacement(placement: Placement) {
  const [side, align] = placement.split('-') as [
    'top' | 'bottom' | 'left' | 'right',
    'start' | 'center' | 'end' | undefined,
  ]
  return { side, align: align ?? 'center' as const }
}

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
}

export function PopoverContent({
  children,
  placement = 'bottom',
  sideOffset = 8,
  alignOffset = 0,
  className,
  popupClassName,
}: PopoverContentProps) {
  const { side, align } = parsePlacement(placement)

  return (
    <BasePopover.Portal>
      <BasePopover.Positioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={cn('z-popover outline-none', className)}
      >
        <BasePopover.Popup
          className={cn(
            'rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg',
            'origin-[var(--transform-origin)] transition-[transform,scale,opacity] data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0',
            popupClassName,
          )}
        >
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  )
}

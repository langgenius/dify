'use client'

import type { ReactNode } from 'react'
import type { Placement } from '@/app/components/base/ui/placement'
import { Popover as BasePopover } from '@base-ui/react/popover'
import { cn } from '@langgenius/dify-ui/cn'
import { parsePlacement } from '@/app/components/base/ui/placement'

export const Popover = BasePopover.Root
export const PopoverTrigger = BasePopover.Trigger
export const PopoverClose = BasePopover.Close
/** @public */
export const PopoverTitle = BasePopover.Title
/** @public */
export const PopoverDescription = BasePopover.Description

type PopoverCloseButtonProps = Omit<BasePopover.Close.Props, 'children'>

/** @public */
export function PopoverCloseButton({
  className,
  'aria-label': ariaLabel = 'Close',
  ...props
}: PopoverCloseButtonProps) {
  return (
    <BasePopover.Close
      aria-label={ariaLabel}
      {...props}
      className={cn(
        'absolute top-2 right-2 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded-md hover:bg-state-base-hover focus-visible:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <span aria-hidden="true" className="i-ri-close-line h-4 w-4 text-text-tertiary" />
    </BasePopover.Close>
  )
}

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
        className={cn('z-1002 outline-hidden', className)}
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

'use client'

import type * as React from 'react'
import type { Placement } from '../placement'
import { Popover as BasePopover } from '@base-ui/react/popover'
import { cn } from '../cn'
import { resolveClassName } from '../internals/resolve-class-name'
import { floatingPopupAnimationClassName } from '../overlay-shared'
import { parsePlacement } from '../placement'

const Popover = BasePopover.Root
const PopoverArrow = BasePopover.Arrow
const PopoverPortal = BasePopover.Portal
const PopoverTrigger = BasePopover.Trigger
const PopoverClose = BasePopover.Close
const PopoverTitle = BasePopover.Title
const PopoverDescription = BasePopover.Description
const createPopoverHandle = BasePopover.createHandle

type PopoverProps<Payload = unknown> = BasePopover.Root.Props<Payload>
type PopoverArrowProps = BasePopover.Arrow.Props
type PopoverPortalProps = BasePopover.Portal.Props
type PopoverHandle<Payload = unknown> = BasePopover.Handle<Payload>
type PopoverTriggerProps<Payload = unknown> = BasePopover.Trigger.Props<Payload>
type PopoverCloseProps = BasePopover.Close.Props
type PopoverTitleProps = BasePopover.Title.Props
type PopoverDescriptionProps = BasePopover.Description.Props

type PopoverBackdropProps = BasePopover.Backdrop.Props

function PopoverBackdrop({ className, ...props }: PopoverBackdropProps) {
  return (
    <BasePopover.Backdrop
      className={(state) => cn('fixed inset-0 z-50', resolveClassName(className, state))}
      {...props}
    />
  )
}

type PopoverPositionerProps = Omit<BasePopover.Positioner.Props, 'side' | 'align'> & {
  placement?: Placement
}

function PopoverPositioner({
  className,
  placement = 'bottom',
  sideOffset = 8,
  alignOffset = 0,
  ...props
}: PopoverPositionerProps) {
  const { side, align } = parsePlacement(placement)

  return (
    <BasePopover.Positioner
      side={side}
      align={align}
      sideOffset={sideOffset}
      alignOffset={alignOffset}
      className={(state) => cn('z-50 outline-hidden', resolveClassName(className, state))}
      {...props}
    />
  )
}

type PopoverPopupProps = BasePopover.Popup.Props

function PopoverPopup({ className, ...props }: PopoverPopupProps) {
  return (
    <BasePopover.Popup
      className={(state) =>
        cn(
          'outline-hidden focus:outline-hidden focus-visible:outline-hidden',
          floatingPopupAnimationClassName,
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type PopoverContentProps = Omit<PopoverPopupProps, 'children'> &
  Pick<PopoverPositionerProps, 'alignOffset' | 'placement' | 'sideOffset'> & {
    children: React.ReactNode
  }

function PopoverContent({
  children,
  placement = 'bottom',
  sideOffset = 8,
  alignOffset = 0,
  className,
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPortal>
      <PopoverPositioner placement={placement} sideOffset={sideOffset} alignOffset={alignOffset}>
        <PopoverPopup
          className={(state) =>
            cn(
              'rounded-xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg',
              resolveClassName(className, state),
            )
          }
          {...props}
        >
          {children}
        </PopoverPopup>
      </PopoverPositioner>
    </PopoverPortal>
  )
}

export {
  createPopoverHandle,
  Popover,
  PopoverArrow,
  PopoverBackdrop,
  PopoverClose,
  PopoverContent,
  PopoverDescription,
  PopoverPopup,
  PopoverPortal,
  PopoverPositioner,
  PopoverTitle,
  PopoverTrigger,
}
export type {
  PopoverArrowProps,
  PopoverBackdropProps,
  PopoverCloseProps,
  PopoverContentProps,
  PopoverDescriptionProps,
  PopoverHandle,
  PopoverPopupProps,
  PopoverPortalProps,
  PopoverPositionerProps,
  PopoverProps,
  PopoverTitleProps,
  PopoverTriggerProps,
}

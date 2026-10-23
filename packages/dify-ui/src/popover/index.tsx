'use client'

import type * as React from 'react'
import { Popover as BasePopover } from '@base-ui/react/popover'
import { cn } from '../cn'
import { focusRingClassName } from '../internal/focus'
import { floatingPopupAnimationClassName, positionerClassName } from '../internal/overlay'
import { resolveClassName } from '../internal/resolve-class-name'

const Popover = BasePopover.Root
const PopoverArrow = BasePopover.Arrow
const PopoverPortal = BasePopover.Portal
const PopoverClose = BasePopover.Close
const PopoverTitle = BasePopover.Title
const PopoverDescription = BasePopover.Description
// Transition container for one popup shared by several triggers; unstyled passthrough.
const PopoverViewport = BasePopover.Viewport
const createPopoverHandle = BasePopover.createHandle

type PopoverActions = BasePopover.Root.Actions

type PopoverProps<Payload = unknown> = BasePopover.Root.Props<Payload>
type PopoverChangeEventReason = BasePopover.Root.ChangeEventReason
type PopoverChangeEventDetails = BasePopover.Root.ChangeEventDetails
type PopoverArrowProps = BasePopover.Arrow.Props
type PopoverPortalProps = BasePopover.Portal.Props
type PopoverHandle<Payload = unknown> = BasePopover.Handle<Payload>
type PopoverTriggerProps<Payload = unknown> = BasePopover.Trigger.Props<Payload>

function PopoverTrigger<Payload = unknown>({ className, ...props }: PopoverTriggerProps<Payload>) {
  return (
    <BasePopover.Trigger
      className={(state) => cn(focusRingClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}
type PopoverCloseProps = BasePopover.Close.Props
type PopoverTitleProps = BasePopover.Title.Props
type PopoverDescriptionProps = BasePopover.Description.Props
type PopoverViewportProps = BasePopover.Viewport.Props

type PopoverBackdropProps = BasePopover.Backdrop.Props

function PopoverBackdrop({ className, ...props }: PopoverBackdropProps) {
  return (
    <BasePopover.Backdrop
      className={(state) => cn('fixed inset-0', resolveClassName(className, state))}
      {...props}
    />
  )
}

type PopoverPositionerProps = BasePopover.Positioner.Props

function PopoverPositioner({ className, sideOffset = 8, ...props }: PopoverPositionerProps) {
  return (
    <BasePopover.Positioner
      sideOffset={sideOffset}
      className={(state) => cn(positionerClassName, resolveClassName(className, state))}
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
  Pick<PopoverPositionerProps, 'alignOffset' | 'side' | 'align' | 'sideOffset'> & {
    children: React.ReactNode
  }

function PopoverContent({
  children,
  side = 'bottom',
  align = 'center',
  sideOffset = 8,
  alignOffset = 0,
  className,
  ...props
}: PopoverContentProps) {
  return (
    <PopoverPortal>
      <PopoverPositioner
        side={side}
        align={align}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
      >
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
  PopoverViewport,
}
export type {
  PopoverActions,
  PopoverArrowProps,
  PopoverBackdropProps,
  PopoverChangeEventDetails,
  PopoverChangeEventReason,
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
  PopoverViewportProps,
}

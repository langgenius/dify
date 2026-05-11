'use client'

import type { ReactNode } from 'react'
import { Drawer as BaseDrawer } from '@base-ui/react/drawer'
import { cn } from '../cn'

export const Drawer = BaseDrawer.Root
export const DrawerProvider = BaseDrawer.Provider
export const DrawerIndent = BaseDrawer.Indent
export const DrawerIndentBackground = BaseDrawer.IndentBackground
export const DrawerTrigger = BaseDrawer.Trigger
export const DrawerSwipeArea = BaseDrawer.SwipeArea
export const DrawerPortal = BaseDrawer.Portal
export const DrawerTitle = BaseDrawer.Title
export const DrawerDescription = BaseDrawer.Description
export const DrawerClose = BaseDrawer.Close
export const createDrawerHandle = BaseDrawer.createHandle

export type DrawerRootProps<Payload = unknown> = BaseDrawer.Root.Props<Payload>
export type DrawerRootActions = BaseDrawer.Root.Actions
export type DrawerRootChangeEventDetails = BaseDrawer.Root.ChangeEventDetails
export type DrawerRootChangeEventReason = BaseDrawer.Root.ChangeEventReason
export type DrawerRootSnapPoint = BaseDrawer.Root.SnapPoint
export type DrawerRootSnapPointChangeEventDetails = BaseDrawer.Root.SnapPointChangeEventDetails
export type DrawerRootSnapPointChangeEventReason = BaseDrawer.Root.SnapPointChangeEventReason
export type DrawerTriggerProps<Payload = unknown> = BaseDrawer.Trigger.Props<Payload>

export function DrawerBackdrop({
  className,
  ...props
}: BaseDrawer.Backdrop.Props) {
  return (
    <BaseDrawer.Backdrop
      className={cn(
        'fixed inset-0 z-50 bg-background-overlay opacity-[calc(1-var(--drawer-swipe-progress,0))]',
        'transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0 data-swiping:duration-0 motion-reduce:transition-none',
        className,
      )}
      {...props}
    />
  )
}

export function DrawerViewport({
  className,
  ...props
}: BaseDrawer.Viewport.Props) {
  return (
    <BaseDrawer.Viewport
      className={cn('fixed inset-0 z-50 touch-none overflow-hidden overscroll-contain outline-hidden', className)}
      {...props}
    />
  )
}

export function DrawerPopup({
  className,
  ...props
}: BaseDrawer.Popup.Props) {
  return (
    <BaseDrawer.Popup
      className={cn(
        'fixed z-50 flex min-h-0 flex-col overflow-hidden border-[0.5px] border-components-panel-border bg-components-panel-bg text-text-primary shadow-xl outline-hidden touch-none',
        'transition-[transform,opacity,box-shadow] duration-200 data-swiping:select-none data-swiping:duration-0 motion-reduce:transition-none',
        'data-[swipe-direction=right]:inset-y-0 data-[swipe-direction=right]:right-0 data-[swipe-direction=right]:h-dvh data-[swipe-direction=right]:w-120 data-[swipe-direction=right]:max-w-[calc(100vw-2rem)] data-[swipe-direction=right]:rounded-l-2xl data-[swipe-direction=right]:border-r-0 data-[swipe-direction=right]:transform-[translateX(var(--drawer-swipe-movement-x,0px))]',
        'data-starting-style:data-[swipe-direction=right]:transform-[translateX(calc(100%+2px))] data-ending-style:data-[swipe-direction=right]:transform-[translateX(calc(100%+2px))]',
        'data-[swipe-direction=left]:inset-y-0 data-[swipe-direction=left]:left-0 data-[swipe-direction=left]:h-dvh data-[swipe-direction=left]:w-120 data-[swipe-direction=left]:max-w-[calc(100vw-2rem)] data-[swipe-direction=left]:rounded-r-2xl data-[swipe-direction=left]:border-l-0 data-[swipe-direction=left]:transform-[translateX(var(--drawer-swipe-movement-x,0px))]',
        'data-starting-style:data-[swipe-direction=left]:transform-[translateX(calc(-100%-2px))] data-ending-style:data-[swipe-direction=left]:transform-[translateX(calc(-100%-2px))]',
        'data-[swipe-direction=down]:inset-x-0 data-[swipe-direction=down]:bottom-0 data-[swipe-direction=down]:max-h-[calc(100dvh-2rem)] data-[swipe-direction=down]:w-full data-[swipe-direction=down]:rounded-t-2xl data-[swipe-direction=down]:border-b-0 data-[swipe-direction=down]:transform-[translateY(calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y,0px)))]',
        'data-starting-style:data-[swipe-direction=down]:transform-[translateY(calc(100%+2px))] data-ending-style:data-[swipe-direction=down]:transform-[translateY(calc(100%+2px))]',
        'data-[swipe-direction=up]:inset-x-0 data-[swipe-direction=up]:top-0 data-[swipe-direction=up]:max-h-[calc(100dvh-2rem)] data-[swipe-direction=up]:w-full data-[swipe-direction=up]:rounded-b-2xl data-[swipe-direction=up]:border-t-0 data-[swipe-direction=up]:transform-[translateY(var(--drawer-swipe-movement-y,0px))]',
        'data-starting-style:data-[swipe-direction=up]:transform-[translateY(calc(-100%-2px))] data-ending-style:data-[swipe-direction=up]:transform-[translateY(calc(-100%-2px))]',
        className,
      )}
      {...props}
    />
  )
}

export function DrawerContent({
  className,
  ...props
}: BaseDrawer.Content.Props) {
  return (
    <BaseDrawer.Content
      className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom,0))]', className)}
      {...props}
    />
  )
}

type DrawerCloseButtonProps = Omit<BaseDrawer.Close.Props, 'children'> & {
  children?: ReactNode
}

export function DrawerCloseButton({
  className,
  children,
  type = 'button',
  'aria-label': ariaLabel = 'Close drawer',
  ...props
}: DrawerCloseButtonProps) {
  return (
    <BaseDrawer.Close
      type={type}
      aria-label={ariaLabel}
      className={cn(
        'flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-text-tertiary outline-hidden hover:bg-state-base-hover hover:text-text-secondary focus-visible:bg-state-base-hover focus-visible:ring-1 focus-visible:ring-components-input-border-hover disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children ?? <span aria-hidden="true" className="i-ri-close-line h-4 w-4" />}
    </BaseDrawer.Close>
  )
}

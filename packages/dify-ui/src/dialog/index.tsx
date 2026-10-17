'use client'

import type * as React from 'react'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { cn } from '../cn'
import { IconButton } from '../icon-button'
import { focusRingClassName } from '../internal/focus'
import { modalBackdropClassName, modalPopupAnimationClassName } from '../internal/overlay'
import { resolveClassName } from '../internal/resolve-class-name'

const Dialog = BaseDialog.Root
const DialogPortal = BaseDialog.Portal
const DialogClose = BaseDialog.Close
const createDialogHandle = BaseDialog.createHandle

type DialogActions = BaseDialog.Root.Actions
type DialogChangeEventReason = BaseDialog.Root.ChangeEventReason
type DialogChangeEventDetails = BaseDialog.Root.ChangeEventDetails

type DialogProps<Payload = unknown> = BaseDialog.Root.Props<Payload>
type DialogHandle<Payload = unknown> = BaseDialog.Handle<Payload>
type DialogTriggerProps<Payload = unknown> = BaseDialog.Trigger.Props<Payload>

function DialogTrigger<Payload = unknown>({ className, ...props }: DialogTriggerProps<Payload>) {
  return (
    <BaseDialog.Trigger
      className={(state) => cn(focusRingClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}
type DialogTitleProps = BaseDialog.Title.Props

function DialogTitle({ className, ...props }: DialogTitleProps) {
  return (
    <BaseDialog.Title
      className={(state) =>
        cn(
          // Same look as AlertDialogTitle; change both together.
          'title-2xl-semi-bold wrap-break-word text-text-primary',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type DialogDescriptionProps = BaseDialog.Description.Props

function DialogDescription({ className, ...props }: DialogDescriptionProps) {
  return (
    <BaseDialog.Description
      className={(state) =>
        cn(
          'system-xs-regular wrap-break-word text-text-tertiary',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}
type DialogPortalProps = BaseDialog.Portal.Props
type DialogCloseProps = BaseDialog.Close.Props

type DialogBackdropProps = BaseDialog.Backdrop.Props

function DialogBackdrop({ className, ...props }: DialogBackdropProps) {
  return (
    <BaseDialog.Backdrop
      {...props}
      className={(state) => cn(modalBackdropClassName, resolveClassName(className, state))}
    />
  )
}

type DialogViewportProps = BaseDialog.Viewport.Props

function DialogViewport({ className, ...props }: DialogViewportProps) {
  return (
    <BaseDialog.Viewport
      className={(state) => cn('fixed inset-0', resolveClassName(className, state))}
      {...props}
    />
  )
}

type DialogPopupProps = BaseDialog.Popup.Props

function DialogPopup({ className, ...props }: DialogPopupProps) {
  return (
    <BaseDialog.Popup
      className={(state) =>
        cn(
          // Radius, border and surface match AlertDialogContent; change both together.
          'rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl',
          modalPopupAnimationClassName,
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type DialogContentProps = Omit<DialogPopupProps, 'children'> & {
  children: React.ReactNode
  backdropProps?: DialogBackdropProps
}

function DialogContent({ children, className, backdropProps, ...props }: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogBackdrop {...backdropProps} />
      <DialogPopup
        className={(state) =>
          cn(
            'fixed top-1/2 left-1/2 max-h-[80dvh] w-120 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain',
            resolveClassName(className, state),
          )
        }
        {...props}
      >
        {children}
      </DialogPopup>
    </DialogPortal>
  )
}

type DialogHeaderProps = React.ComponentProps<'div'>

function DialogHeader({ className, ...props }: DialogHeaderProps) {
  return (
    <div
      className={cn(
        'sticky top-0 z-1 flex flex-col gap-1 bg-components-panel-bg ps-6 pe-14 pt-6 pb-3',
        className,
      )}
      {...props}
    />
  )
}

type DialogCloseButtonProps = Omit<DialogCloseProps, 'render' | 'children' | 'className'> & {
  'aria-label': string
}

function DialogCloseButton({ 'aria-label': ariaLabel, ...props }: DialogCloseButtonProps) {
  return (
    <BaseDialog.Close
      {...props}
      render={
        <IconButton aria-label={ariaLabel} size="lg" className="absolute inset-e-5 top-5">
          <span aria-hidden className="i-ri-close-line size-4.5" />
        </IconButton>
      }
    />
  )
}

type DialogBodyProps = React.ComponentProps<'div'>

function DialogBody({ className, ...props }: DialogBodyProps) {
  return <div className={cn('px-6 py-3', className)} {...props} />
}

type DialogFooterProps = React.ComponentProps<'div'>

function DialogFooter({ className, ...props }: DialogFooterProps) {
  return (
    <div
      className={cn(
        'sticky bottom-0 flex items-center justify-end gap-2 bg-components-panel-bg px-6 pt-5 pb-6',
        className,
      )}
      {...props}
    />
  )
}

export {
  createDialogHandle,
  Dialog,
  DialogBackdrop,
  DialogBody,
  DialogClose,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
}

export type {
  DialogActions,
  DialogBackdropProps,
  DialogBodyProps,
  DialogChangeEventDetails,
  DialogChangeEventReason,
  DialogCloseButtonProps,
  DialogCloseProps,
  DialogContentProps,
  DialogDescriptionProps,
  DialogFooterProps,
  DialogHandle,
  DialogHeaderProps,
  DialogPopupProps,
  DialogPortalProps,
  DialogProps,
  DialogTitleProps,
  DialogTriggerProps,
  DialogViewportProps,
}

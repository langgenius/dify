'use client'

import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import * as React from 'react'
import { cn } from '../cn'
import { modalBackdropClassName, modalPopupAnimationClassName } from '../overlay-shared'

const Dialog = BaseDialog.Root
const DialogTrigger = BaseDialog.Trigger
const DialogTitle = BaseDialog.Title
const DialogDescription = BaseDialog.Description
const DialogPortal = BaseDialog.Portal
const DialogClose = BaseDialog.Close
const createDialogHandle = BaseDialog.createHandle

type DialogProps<Payload = unknown> = BaseDialog.Root.Props<Payload>
type DialogHandle<Payload = unknown> = BaseDialog.Handle<Payload>
type DialogTriggerProps<Payload = unknown> = BaseDialog.Trigger.Props<Payload>
type DialogTitleProps = BaseDialog.Title.Props
type DialogDescriptionProps = BaseDialog.Description.Props
type DialogPortalProps = BaseDialog.Portal.Props
type DialogCloseProps = BaseDialog.Close.Props

type DialogBackdropProps = Omit<BaseDialog.Backdrop.Props, 'className'> & {
  className?: string
}

function DialogBackdrop({ className, ...props }: DialogBackdropProps) {
  return <BaseDialog.Backdrop {...props} className={cn(modalBackdropClassName, className)} />
}

type DialogViewportProps = Omit<BaseDialog.Viewport.Props, 'className'> & {
  className?: string
}

function DialogViewport({ className, ...props }: DialogViewportProps) {
  return <BaseDialog.Viewport className={cn('fixed inset-0 z-50', className)} {...props} />
}

type DialogPopupProps = Omit<BaseDialog.Popup.Props, 'className'> & {
  className?: string
}

function DialogPopup({ className, ...props }: DialogPopupProps) {
  return (
    <BaseDialog.Popup
      className={cn(
        'z-50 rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl',
        modalPopupAnimationClassName,
        className,
      )}
      {...props}
    />
  )
}

type DialogContentProps = Omit<DialogPopupProps, 'children' | 'className'> & {
  children: React.ReactNode
  className?: string
  backdropProps?: DialogBackdropProps
}

function DialogContent({ children, className, backdropProps, ...props }: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogBackdrop {...backdropProps} />
      <DialogPopup
        className={cn(
          'fixed top-1/2 left-1/2 max-h-[80dvh] w-120 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain p-6',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPopup>
    </DialogPortal>
  )
}

export {
  createDialogHandle,
  Dialog,
  DialogBackdrop,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
}

export type {
  DialogBackdropProps,
  DialogCloseProps,
  DialogContentProps,
  DialogDescriptionProps,
  DialogHandle,
  DialogPopupProps,
  DialogPortalProps,
  DialogProps,
  DialogTitleProps,
  DialogTriggerProps,
  DialogViewportProps,
}

'use client'

import type * as React from 'react'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { cn } from '../cn'
import { resolveClassName } from '../internals/resolve-class-name'
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
      className={(state) => cn('fixed inset-0 z-50', resolveClassName(className, state))}
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
          'z-50 rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-xl',
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
            'fixed top-1/2 left-1/2 max-h-[80dvh] w-120 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain p-6',
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

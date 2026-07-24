'use client'

import type * as React from 'react'
import { Dialog as BaseDialog } from '@base-ui/react/dialog'
import { cn } from '../cn'
import { modalBackdropClassName, modalPopupAnimationClassName } from '../overlay-shared'

export const Dialog = BaseDialog.Root
export const DialogTrigger = BaseDialog.Trigger
export const DialogTitle = BaseDialog.Title
export const DialogDescription = BaseDialog.Description
export const DialogPortal = BaseDialog.Portal
export const createDialogHandle = BaseDialog.createHandle

type DialogBackdropProps = Omit<BaseDialog.Backdrop.Props, 'className'> & {
  className?: string
}

export function DialogBackdrop({ className, ...props }: DialogBackdropProps) {
  return <BaseDialog.Backdrop {...props} className={cn(modalBackdropClassName, className)} />
}

type DialogViewportProps = Omit<BaseDialog.Viewport.Props, 'className'> & {
  className?: string
}

export function DialogViewport({ className, ...props }: DialogViewportProps) {
  return <BaseDialog.Viewport className={cn('fixed inset-0 z-50', className)} {...props} />
}

type DialogPopupProps = Omit<BaseDialog.Popup.Props, 'className'> & {
  className?: string
}

export function DialogPopup({ className, ...props }: DialogPopupProps) {
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

type DialogCloseButtonProps = Omit<BaseDialog.Close.Props, 'children'>

export function DialogCloseButton({
  className,
  'aria-label': ariaLabel = 'Close',
  ...props
}: DialogCloseButtonProps) {
  return (
    <BaseDialog.Close
      aria-label={ariaLabel}
      {...props}
      className={cn(
        'absolute inset-e-6 top-6 z-10 flex h-5 w-5 cursor-pointer items-center justify-center rounded-2xl hover:bg-state-base-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <span aria-hidden="true" className="i-ri-close-line h-4 w-4 text-text-tertiary" />
    </BaseDialog.Close>
  )
}

type DialogContentProps = {
  children: React.ReactNode
  className?: string
  backdropClassName?: string
  backdropProps?: Omit<BaseDialog.Backdrop.Props, 'className'>
}

export function DialogContent({
  children,
  className,
  backdropClassName,
  backdropProps,
}: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogBackdrop {...backdropProps} className={backdropClassName} />
      <DialogPopup
        className={cn(
          'fixed top-1/2 left-1/2 max-h-[80dvh] w-120 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain p-6',
          className,
        )}
      >
        {children}
      </DialogPopup>
    </DialogPortal>
  )
}

'use client'

import type { ButtonProps } from '../button'
import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog'
import * as React from 'react'
import { Button } from '../button'
import { cn } from '../cn'
import { modalBackdropClassName, modalPopupAnimationClassName } from '../overlay-shared'

const AlertDialog = BaseAlertDialog.Root
const AlertDialogTrigger = BaseAlertDialog.Trigger
const AlertDialogTitle = BaseAlertDialog.Title
const AlertDialogDescription = BaseAlertDialog.Description

type AlertDialogProps<Payload = unknown> = BaseAlertDialog.Root.Props<Payload>
type AlertDialogTriggerProps<Payload = unknown> = BaseAlertDialog.Trigger.Props<Payload>
type AlertDialogTitleProps = BaseAlertDialog.Title.Props
type AlertDialogDescriptionProps = BaseAlertDialog.Description.Props

type AlertDialogBackdropProps = Omit<BaseAlertDialog.Backdrop.Props, 'className'> & {
  className?: string
}

function AlertDialogBackdrop({ className, ...props }: AlertDialogBackdropProps) {
  return <BaseAlertDialog.Backdrop {...props} className={cn(modalBackdropClassName, className)} />
}

type AlertDialogContentProps = Omit<BaseAlertDialog.Popup.Props, 'children' | 'className'> & {
  children: React.ReactNode
  className?: string
  backdropProps?: AlertDialogBackdropProps
}

function AlertDialogContent({
  children,
  className,
  backdropProps,
  ...props
}: AlertDialogContentProps) {
  return (
    <BaseAlertDialog.Portal>
      <AlertDialogBackdrop {...backdropProps} />
      <BaseAlertDialog.Popup
        className={cn(
          'fixed top-1/2 left-1/2 z-50 max-h-[calc(100vh-2rem)] w-120 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg',
          modalPopupAnimationClassName,
          className,
        )}
        {...props}
      >
        {children}
      </BaseAlertDialog.Popup>
    </BaseAlertDialog.Portal>
  )
}

type AlertDialogActionsProps = React.ComponentProps<'div'>

function AlertDialogActions({ className, ...props }: AlertDialogActionsProps) {
  return (
    <div
      className={cn('flex items-start justify-end gap-2 self-stretch p-6', className)}
      {...props}
    />
  )
}

type AlertDialogCancelButtonProps = Omit<ButtonProps, 'children'> & {
  children: React.ReactNode
  closeProps?: Omit<BaseAlertDialog.Close.Props, 'children' | 'render'>
}

function AlertDialogCancelButton({
  children,
  closeProps,
  ...buttonProps
}: AlertDialogCancelButtonProps) {
  return (
    <BaseAlertDialog.Close {...closeProps} render={<Button {...buttonProps} />}>
      {children}
    </BaseAlertDialog.Close>
  )
}

type AlertDialogConfirmButtonProps = ButtonProps

function AlertDialogConfirmButton({
  variant = 'primary',
  tone = 'destructive',
  ...props
}: AlertDialogConfirmButtonProps) {
  return <Button variant={variant} tone={tone} {...props} />
}

export {
  AlertDialog,
  AlertDialogActions,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  AlertDialogTrigger,
}

export type {
  AlertDialogActionsProps,
  AlertDialogCancelButtonProps,
  AlertDialogConfirmButtonProps,
  AlertDialogContentProps,
  AlertDialogDescriptionProps,
  AlertDialogProps,
  AlertDialogTitleProps,
  AlertDialogTriggerProps,
}

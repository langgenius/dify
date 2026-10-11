'use client'

import type * as React from 'react'
import type { ButtonProps } from '../button'
import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog'
import { Button } from '../button'
import { cn } from '../cn'
import { resolveClassName } from '../internals/resolve-class-name'
import {
  modalBackdropClassName,
  modalPopupAnimationClassName,
  triggerFocusClassName,
} from '../overlay-shared'

const AlertDialog = BaseAlertDialog.Root
const AlertDialogTitle = BaseAlertDialog.Title
const AlertDialogDescription = BaseAlertDialog.Description

type AlertDialogActions = BaseAlertDialog.Root.Actions

type AlertDialogProps<Payload = unknown> = BaseAlertDialog.Root.Props<Payload>
type AlertDialogTriggerProps<Payload = unknown> = BaseAlertDialog.Trigger.Props<Payload>

function AlertDialogTrigger<Payload = unknown>({
  className,
  ...props
}: AlertDialogTriggerProps<Payload>) {
  return (
    <BaseAlertDialog.Trigger
      className={(state) => cn(triggerFocusClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}
type AlertDialogTitleProps = BaseAlertDialog.Title.Props
type AlertDialogDescriptionProps = BaseAlertDialog.Description.Props

type AlertDialogBackdropProps = BaseAlertDialog.Backdrop.Props

function AlertDialogBackdrop({ className, ...props }: AlertDialogBackdropProps) {
  return (
    <BaseAlertDialog.Backdrop
      {...props}
      className={(state) => cn(modalBackdropClassName, resolveClassName(className, state))}
    />
  )
}

type AlertDialogContentProps = Omit<BaseAlertDialog.Popup.Props, 'children'> & {
  children: React.ReactNode
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
        className={(state) =>
          cn(
            'fixed top-1/2 left-1/2 z-50 max-h-[calc(100vh-2rem)] w-120 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg',
            modalPopupAnimationClassName,
            resolveClassName(className, state),
          )
        }
        {...props}
      >
        {children}
      </BaseAlertDialog.Popup>
    </BaseAlertDialog.Portal>
  )
}

type AlertDialogFooterProps = React.ComponentProps<'div'>

function AlertDialogFooter({ className, ...props }: AlertDialogFooterProps) {
  return (
    <div
      className={cn('flex items-start justify-end gap-2 self-stretch p-6', className)}
      {...props}
    />
  )
}

type AlertDialogCancelButtonProps = ButtonProps

function AlertDialogCancelButton({ children, ...buttonProps }: AlertDialogCancelButtonProps) {
  return (
    <BaseAlertDialog.Close render={<Button {...buttonProps} />}>{children}</BaseAlertDialog.Close>
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
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
}

export type {
  AlertDialogActions,
  AlertDialogCancelButtonProps,
  AlertDialogConfirmButtonProps,
  AlertDialogContentProps,
  AlertDialogDescriptionProps,
  AlertDialogFooterProps,
  AlertDialogProps,
  AlertDialogTitleProps,
  AlertDialogTriggerProps,
}

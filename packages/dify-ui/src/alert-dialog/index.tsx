'use client'

import type * as React from 'react'
import type { ButtonProps } from '../button'
import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog'
import { Button } from '../button'
import { cn } from '../cn'
import { focusRingClassName } from '../internal/focus'
import {
  modalBackdropClassName,
  modalPopupAnimationClassName,
  modalStackClassName,
  modalSurfaceClassName,
  modalTitleClassName,
} from '../internal/overlay'
import { resolveClassName } from '../internal/resolve-class-name'

const AlertDialog = BaseAlertDialog.Root
const createAlertDialogHandle = BaseAlertDialog.createHandle

type AlertDialogActions = BaseAlertDialog.Root.Actions
type AlertDialogChangeEventReason = BaseAlertDialog.Root.ChangeEventReason
type AlertDialogChangeEventDetails = BaseAlertDialog.Root.ChangeEventDetails

type AlertDialogProps<Payload = unknown> = BaseAlertDialog.Root.Props<Payload>
type AlertDialogHandle<Payload = unknown> = BaseAlertDialog.Handle<Payload>
type AlertDialogTriggerProps<Payload = unknown> = BaseAlertDialog.Trigger.Props<Payload>

function AlertDialogTrigger<Payload = unknown>({
  className,
  ...props
}: AlertDialogTriggerProps<Payload>) {
  return (
    <BaseAlertDialog.Trigger
      className={(state) => cn(focusRingClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}
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
            'fixed top-1/2 left-1/2 flex max-h-[calc(100dvh-2rem)] w-120 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto overscroll-contain',
            modalSurfaceClassName,
            modalStackClassName,
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

type AlertDialogHeaderProps = React.ComponentProps<'div'>

function AlertDialogHeader({ className, ...props }: AlertDialogHeaderProps) {
  return <div className={cn('flex shrink-0 flex-col gap-2 px-6 pt-6 pb-4', className)} {...props} />
}

type AlertDialogTitleProps = BaseAlertDialog.Title.Props

function AlertDialogTitle({ className, ...props }: AlertDialogTitleProps) {
  return (
    <BaseAlertDialog.Title
      className={(state) => cn(modalTitleClassName, resolveClassName(className, state))}
      {...props}
    />
  )
}

type AlertDialogDescriptionProps = BaseAlertDialog.Description.Props

function AlertDialogDescription({ className, ...props }: AlertDialogDescriptionProps) {
  return (
    <BaseAlertDialog.Description
      className={(state) =>
        cn(
          'system-md-regular wrap-break-word whitespace-pre-wrap text-text-secondary',
          resolveClassName(className, state),
        )
      }
      {...props}
    />
  )
}

type AlertDialogBodyProps = React.ComponentProps<'div'>

function AlertDialogBody({ className, ...props }: AlertDialogBodyProps) {
  return <div className={cn('px-6', className)} {...props} />
}

type AlertDialogFooterProps = React.ComponentProps<'div'>

function AlertDialogFooter({ className, ...props }: AlertDialogFooterProps) {
  return (
    <div className={cn('flex shrink-0 items-center justify-end gap-2 p-6', className)} {...props} />
  )
}

type AlertDialogCancelButtonProps = ButtonProps

function AlertDialogCancelButton({
  children,
  className,
  ...buttonProps
}: AlertDialogCancelButtonProps) {
  return (
    <BaseAlertDialog.Close
      render={
        <Button
          className={(state) => cn('min-w-20', resolveClassName(className, state))}
          {...buttonProps}
        />
      }
    >
      {children}
    </BaseAlertDialog.Close>
  )
}

type AlertDialogConfirmButtonProps = ButtonProps

function AlertDialogConfirmButton({
  variant = 'primary',
  tone = 'destructive',
  className,
  ...props
}: AlertDialogConfirmButtonProps) {
  return (
    <Button
      variant={variant}
      tone={tone}
      className={(state) => cn('min-w-20', resolveClassName(className, state))}
      {...props}
    />
  )
}

export {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancelButton,
  AlertDialogConfirmButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  createAlertDialogHandle,
}

export type {
  AlertDialogActions,
  AlertDialogBodyProps,
  AlertDialogCancelButtonProps,
  AlertDialogChangeEventDetails,
  AlertDialogChangeEventReason,
  AlertDialogConfirmButtonProps,
  AlertDialogContentProps,
  AlertDialogDescriptionProps,
  AlertDialogFooterProps,
  AlertDialogHandle,
  AlertDialogHeaderProps,
  AlertDialogProps,
  AlertDialogTitleProps,
  AlertDialogTriggerProps,
}

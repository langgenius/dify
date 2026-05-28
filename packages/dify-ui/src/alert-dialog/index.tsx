'use client'

import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import type { ButtonProps } from '../button'
import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog'
import { Button } from '../button'
import { cn } from '../cn'

export const AlertDialog = BaseAlertDialog.Root
export const AlertDialogTrigger = BaseAlertDialog.Trigger
export const AlertDialogTitle = BaseAlertDialog.Title
export const AlertDialogDescription = BaseAlertDialog.Description

type AlertDialogContentProps = {
  children: ReactNode
  className?: string
  backdropClassName?: string
  backdropProps?: Omit<BaseAlertDialog.Backdrop.Props, 'className'>
}

export function AlertDialogContent({
  children,
  className,
  backdropClassName,
  backdropProps,
}: AlertDialogContentProps) {
  return (
    <BaseAlertDialog.Portal>
      <BaseAlertDialog.Backdrop
        {...backdropProps}
        className={cn(
          'fixed inset-0 z-50 bg-background-overlay',
          'transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none',
          backdropClassName,
        )}
      />
      <BaseAlertDialog.Popup
        className={cn(
          'fixed top-1/2 left-1/2 z-50 max-h-[calc(100vh-2rem)] w-120 max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg',
          'transition-[transform,scale,opacity] duration-150 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0 motion-reduce:transition-none',
          className,
        )}
      >
        {children}
      </BaseAlertDialog.Popup>
    </BaseAlertDialog.Portal>
  )
}

type AlertDialogActionsProps = ComponentPropsWithoutRef<'div'>

export function AlertDialogActions({ className, ...props }: AlertDialogActionsProps) {
  return (
    <div
      className={cn('flex items-start justify-end gap-2 self-stretch p-6', className)}
      {...props}
    />
  )
}

type AlertDialogCancelButtonProps = Omit<ButtonProps, 'children'> & {
  children: ReactNode
  closeProps?: Omit<BaseAlertDialog.Close.Props, 'children' | 'render'>
}

export function AlertDialogCancelButton({
  children,
  closeProps,
  ...buttonProps
}: AlertDialogCancelButtonProps) {
  return (
    <BaseAlertDialog.Close
      {...closeProps}
      render={<Button {...buttonProps} />}
    >
      {children}
    </BaseAlertDialog.Close>
  )
}

type AlertDialogConfirmButtonProps = ButtonProps

export function AlertDialogConfirmButton({
  variant = 'primary',
  tone = 'destructive',
  ...props
}: AlertDialogConfirmButtonProps) {
  return (
    <Button
      variant={variant}
      tone={tone}
      {...props}
    />
  )
}

'use client'

import type { ButtonProps } from '@/app/components/base/button'
import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog'
import * as React from 'react'
import Button from '@/app/components/base/button'
import { cn } from '@/utils/classnames'

export const AlertDialog = BaseAlertDialog.Root
export const AlertDialogTrigger = BaseAlertDialog.Trigger
export const AlertDialogTitle = BaseAlertDialog.Title
export const AlertDialogDescription = BaseAlertDialog.Description
export const AlertDialogClose = BaseAlertDialog.Close

type AlertDialogContentProps = {
  children: React.ReactNode
  className?: string
  overlayClassName?: string
  popupProps?: Omit<React.ComponentPropsWithoutRef<typeof BaseAlertDialog.Popup>, 'children' | 'className'>
  backdropProps?: Omit<React.ComponentPropsWithoutRef<typeof BaseAlertDialog.Backdrop>, 'className'>
}

export function AlertDialogContent({
  children,
  className,
  overlayClassName,
  popupProps,
  backdropProps,
}: AlertDialogContentProps) {
  return (
    <BaseAlertDialog.Portal>
      <BaseAlertDialog.Backdrop
        {...backdropProps}
        className={cn(
          'fixed inset-0 z-[1002] bg-background-overlay',
          'transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none',
          overlayClassName,
        )}
      />
      <BaseAlertDialog.Popup
        {...popupProps}
        className={cn(
          'fixed left-1/2 top-1/2 z-[1002] max-h-[calc(100vh-2rem)] w-[480px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg',
          'transition-[transform,scale,opacity] duration-150 data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none',
          className,
        )}
      >
        {children}
      </BaseAlertDialog.Popup>
    </BaseAlertDialog.Portal>
  )
}

type AlertDialogActionsProps = React.ComponentPropsWithoutRef<'div'>

export function AlertDialogActions({ className, ...props }: AlertDialogActionsProps) {
  return (
    <div
      className={cn('flex items-start justify-end gap-2 self-stretch p-6', className)}
      {...props}
    />
  )
}

type AlertDialogCancelButtonProps = Omit<ButtonProps, 'children'> & {
  children: React.ReactNode
  closeProps?: Omit<React.ComponentPropsWithoutRef<typeof BaseAlertDialog.Close>, 'children' | 'render'>
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
  destructive = true,
  ...props
}: AlertDialogConfirmButtonProps) {
  return (
    <Button
      variant={variant}
      destructive={destructive}
      {...props}
    />
  )
}

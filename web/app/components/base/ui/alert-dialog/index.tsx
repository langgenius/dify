'use client'

// z-index strategy (relies on root `isolation: isolate` in layout.tsx):
//   All overlay primitives (Tooltip / Popover / Dropdown / Select / Dialog / AlertDialog) — z-50
//   Overlays share the same z-index; DOM order handles stacking when multiple are open.
//   This ensures overlays inside an AlertDialog (e.g. a Tooltip on a dialog button) render
//   above the dialog backdrop instead of being clipped by it.
//   Toast — z-[99], always on top (defined in toast component)

import { AlertDialog as BaseAlertDialog } from '@base-ui/react/alert-dialog'
import * as React from 'react'
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
  const restPopupProps = popupProps
  const restBackdropProps = backdropProps

  return (
    <BaseAlertDialog.Portal>
      <BaseAlertDialog.Backdrop
        {...restBackdropProps}
        className={cn(
          'fixed inset-0 z-50 bg-background-overlay',
          'transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none',
          overlayClassName,
        )}
      />
      <BaseAlertDialog.Popup
        {...restPopupProps}
        className={cn(
          'fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[480px] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-2xl border-[0.5px] border-components-panel-border bg-components-panel-bg shadow-lg',
          'transition-[transform,scale,opacity] duration-150 data-[ending-style]:scale-95 data-[starting-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none',
          className,
        )}
      >
        {children}
      </BaseAlertDialog.Popup>
    </BaseAlertDialog.Portal>
  )
}

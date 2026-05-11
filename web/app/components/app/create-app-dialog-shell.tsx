'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'

type CreateAppDialogShellProps = {
  children: ReactNode
  contentClassName?: string
  onClose: () => void
  show: boolean
  title: ReactNode
}

export function CreateAppDialogShell({
  children,
  contentClassName,
  onClose,
  show,
  title,
}: CreateAppDialogShellProps) {
  return (
    <Dialog
      open={show}
      onOpenChange={(nextOpen) => {
        if (!nextOpen)
          onClose()
      }}
    >
      <DialogContent
        backdropClassName="bg-background-overlay-backdrop backdrop-blur-[6px]"
        className="top-0 left-0 h-screen max-h-none w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-none bg-transparent p-4 shadow-none"
      >
        <div className="h-full w-full rounded-2xl border border-effects-highlight bg-background-default-subtle">
          <div className={cn('relative h-full overflow-hidden', contentClassName)}>
            <DialogTitle className="sr-only">{title}</DialogTitle>
            <button
              type="button"
              aria-label="Close"
              className="absolute top-3 right-3 z-50 flex h-9 w-9 cursor-pointer items-center justify-center rounded-[10px] bg-components-button-tertiary-bg hover:bg-components-button-tertiary-bg-hover"
              onClick={onClose}
            >
              <span aria-hidden="true" className="i-ri-close-large-line h-3.5 w-3.5 text-components-button-tertiary-text" />
            </button>
            {children}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

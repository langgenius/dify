'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@langgenius/dify-ui/dialog'
import { useTranslation } from 'react-i18next'

type CreateAppDialogShellProps = {
  children: ReactNode
  contentClassName?: string
  onOpenChange: (open: boolean) => void
  open: boolean
  title: ReactNode
}

export function CreateAppDialogShell({
  children,
  contentClassName,
  onOpenChange,
  open,
  title,
}: CreateAppDialogShellProps) {
  const { t } = useTranslation(['common'])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        backdropProps={{ className: 'bg-background-overlay-backdrop backdrop-blur-[6px]' }}
        className="top-0 left-0 h-screen max-h-none w-screen max-w-none translate-0 overflow-hidden rounded-none border-none bg-transparent p-4 shadow-none"
      >
        <div className="size-full rounded-2xl border border-effects-highlight bg-background-default-subtle">
          <div className={cn('relative h-full overflow-hidden', contentClassName)}>
            <DialogTitle className="sr-only">{title}</DialogTitle>
            <DialogClose
              aria-label={t(($) => $['operation.close'])}
              className="absolute top-3 right-3 z-50 flex h-9 w-9 cursor-pointer items-center justify-center rounded-[10px] bg-components-button-tertiary-bg hover:bg-components-button-tertiary-bg-hover focus-visible:ring-2 focus-visible:ring-state-accent-solid focus-visible:outline-hidden"
            >
              <span
                aria-hidden="true"
                className="i-ri-close-large-line size-3.5 text-components-button-tertiary-text"
              />
            </DialogClose>
            {children}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

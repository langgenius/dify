'use client'

import type { ReactNode } from 'react'
import { cn } from '@langgenius/dify-ui/cn'
import {
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from '@langgenius/dify-ui/dialog'
import { IconButton } from '@langgenius/dify-ui/icon-button'
import { useTranslation } from 'react-i18next'

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
  const { t } = useTranslation(['common'])
  return (
    <Dialog
      open={show}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <DialogPortal>
        <DialogBackdrop className="bg-background-overlay-backdrop backdrop-blur-[6px]" />
        <DialogPopup className="fixed top-0 left-0 h-screen w-screen overflow-hidden overscroll-contain p-4">
          <div className="size-full overflow-hidden rounded-2xl bg-background-default-subtle inset-ring inset-ring-effects-highlight">
            <div className={cn('relative h-full overflow-hidden', contentClassName)}>
              <DialogTitle className="sr-only">{title}</DialogTitle>
              {children}
              <IconButton
                aria-label={t(($) => $['operation.close'], { ns: 'common' })}
                variant="tertiary"
                size="xl"
                className="absolute top-3 right-3"
                onClick={onClose}
              >
                <span
                  aria-hidden="true"
                  className="i-ri-close-large-line size-3.5 text-components-button-tertiary-text"
                />
              </IconButton>
            </div>
          </div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}

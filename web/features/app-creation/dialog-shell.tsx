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
  legacyLayout?: boolean
  onClose: () => void
  show: boolean
  title: ReactNode
}

export function CreateAppDialogShell({
  children,
  contentClassName,
  legacyLayout = false,
  onClose,
  show,
  title,
}: CreateAppDialogShellProps) {
  const { t } = useTranslation(['common'])
  const closeLabel = t(($) => $['operation.close'], { ns: 'common' })
  const closeIcon = (
    <span
      aria-hidden
      className="i-ri-close-large-line size-3.5 text-components-button-tertiary-text"
    />
  )
  const closeButton = legacyLayout ? (
    <button
      type="button"
      aria-label={closeLabel}
      className="absolute inset-e-3 top-3 z-50 flex h-9 w-9 cursor-pointer items-center justify-center rounded-[10px] bg-components-button-tertiary-bg hover:bg-components-button-tertiary-bg-hover"
      onClick={onClose}
    >
      {closeIcon}
    </button>
  ) : (
    <IconButton
      aria-label={closeLabel}
      variant="tertiary"
      size="xl"
      className="absolute inset-e-3 top-3"
      onClick={onClose}
    >
      {closeIcon}
    </IconButton>
  )

  return (
    <Dialog
      open={show}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose()
      }}
    >
      <DialogPortal>
        <DialogBackdrop className="bg-background-overlay-backdrop backdrop-blur-[6px]" />
        <DialogPopup className="fixed inset-s-0 top-0 h-screen w-screen overflow-hidden overscroll-contain p-4">
          <div
            className={cn(
              'size-full rounded-2xl bg-background-default-subtle',
              legacyLayout
                ? 'border border-effects-highlight'
                : 'overflow-hidden inset-ring inset-ring-effects-highlight',
            )}
          >
            <div className={cn('relative h-full overflow-hidden', contentClassName)}>
              <DialogTitle className="sr-only">{title}</DialogTitle>
              {legacyLayout && closeButton}
              {children}
              {!legacyLayout && closeButton}
            </div>
          </div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}
